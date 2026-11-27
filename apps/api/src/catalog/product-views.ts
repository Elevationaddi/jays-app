import { HttpStatus } from '@nestjs/common';
import type { MerchantProduct, MerchantVariant } from '@jays/contracts';
import type { Database, Db } from '@jays/db';
import { availableStock, DOWNLOAD_URL_TTL_SECONDS } from '@jays/domain';
import type { Transaction } from 'kysely';
import { addSeconds } from '../common/clock.js';
import { ApiError } from '../common/error.filter.js';
import type { ObjectStorage } from '../storage/storage.js';

type Localized = { en: string; ar: string };
type Conn = Db | Transaction<Database>;

export const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found.');
export const policy = (code: string, message: string, fieldErrors?: Record<string, string[]>) =>
  new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, code, message, fieldErrors);
export const conflict = (code: string, message: string, fieldErrors?: Record<string, string[]>) =>
  new ApiError(HttpStatus.CONFLICT, code, message, fieldErrors);

export const VARIANT_COLUMNS = [
  'id',
  'sku',
  'name',
  'price_fils',
  'tax_class',
  'barcode',
  'weight_grams',
  'low_stock_threshold',
  'stock_on_hand',
  'stock_reserved',
  'status',
] as const;

export function toMerchantVariant(v: {
  id: string;
  sku: string;
  name: Localized;
  price_fils: number;
  tax_class: MerchantVariant['taxClass'];
  barcode: string | null;
  weight_grams: number | null;
  low_stock_threshold: number;
  stock_on_hand: number;
  stock_reserved: number;
  status: 'active' | 'archived';
}): MerchantVariant {
  return {
    id: v.id,
    sku: v.sku,
    name: v.name,
    priceFils: v.price_fils,
    taxClass: v.tax_class,
    barcode: v.barcode,
    weightGrams: v.weight_grams,
    lowStockThreshold: v.low_stock_threshold,
    stockOnHand: v.stock_on_hand,
    stockReserved: v.stock_reserved,
    stockAvailable: availableStock({ onHand: v.stock_on_hand, reserved: v.stock_reserved }),
    status: v.status,
  };
}

/** Short-lived signed URLs for a list of media ids, keeping their order; unknown ids are dropped. */
export async function signedMediaUrls(
  db: Conn,
  storage: ObjectStorage,
  now: Date,
  ids: readonly string[],
): Promise<{ id: string; url: string | null }[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .selectFrom('media')
    .select(['id', 'object_key', 'status'])
    .where('id', 'in', [...ids])
    .execute();
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids
    .filter((id) => byId.has(id))
    .map((id) => {
      const r = byId.get(id) as (typeof rows)[number];
      return {
        id,
        url:
          r.status === 'ready'
            ? storage.signDownload(r.object_key, {
                expiresAt: addSeconds(now, DOWNLOAD_URL_TTL_SECONDS),
                disposition: 'inline',
              }).url
            : null,
      };
    });
}

export async function loadProductRow(db: Conn, productId: string, businessId?: string) {
  let q = db.selectFrom('products').selectAll().where('id', '=', productId);
  if (businessId) q = q.where('business_id', '=', businessId);
  return q.executeTakeFirst();
}

export async function draftMediaIds(db: Conn, productId: string): Promise<string[]> {
  const rows = await db
    .selectFrom('product_media')
    .select('media_id')
    .where('product_id', '=', productId)
    .orderBy('sort_order')
    .execute();
  return rows.map((r) => r.media_id);
}

/** The merchant's (and the reviewer's) view: draft, live copy, variants with stock. */
export async function merchantProductView(
  db: Conn,
  storage: ObjectStorage,
  now: Date,
  productId: string,
  businessId?: string,
): Promise<MerchantProduct> {
  const p = await loadProductRow(db, productId, businessId);
  if (!p) throw notFound();
  const [mediaIds, variants] = await Promise.all([
    draftMediaIds(db, productId),
    db
      .selectFrom('variants')
      .select(VARIANT_COLUMNS)
      .where('product_id', '=', productId)
      .orderBy('sort_order')
      .orderBy('created_at')
      .orderBy('id')
      .execute(),
  ]);
  const [draftImages, liveImages] = await Promise.all([
    signedMediaUrls(db, storage, now, mediaIds),
    signedMediaUrls(db, storage, now, p.live_media_ids),
  ]);
  return {
    id: p.id,
    status: p.status,
    draft: {
      categoryId: p.category_id,
      brandId: p.brand_id,
      title: p.title,
      description: p.description,
      details: p.details,
      returnEligible: p.return_eligible,
      images: draftImages,
    },
    live: p.published_at
      ? {
          categoryId: p.live_category_id as string,
          brandId: p.live_brand_id,
          title: p.live_title as Localized,
          description: p.live_description as Localized,
          details: p.live_details,
          returnEligible: p.live_return_eligible as boolean,
          images: liveImages,
        }
      : null,
    changesPending: p.changes_submitted_at !== null,
    reviewReason: p.review_reason,
    suspensionReason: p.suspension_reason,
    submittedAt: p.submitted_at?.toISOString() ?? null,
    publishedAt: p.published_at?.toISOString() ?? null,
    version: p.version,
    variants: variants.map(toMerchantVariant),
    createdAt: p.created_at.toISOString(),
    updatedAt: p.updated_at.toISOString(),
  };
}
