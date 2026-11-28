import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { ProductListQuery, PublicProduct, PublicProductListItem } from '@jays/contracts';
import type { Database, Db } from '@jays/db';
import { availableStock, DOWNLOAD_URL_TTL_SECONDS, type EmirateCode } from '@jays/domain';
import { type ExpressionBuilder, sql, type SqlBool, type Transaction } from 'kysely';
import { z } from 'zod';
import { API_ENV, type ApiEnv } from '../config.js';
import { addSeconds, CLOCK, type Clock } from '../common/clock.js';
import { ApiError } from '../common/error.filter.js';
import { DB } from '../common/tokens.js';
import { OBJECT_STORAGE, type ObjectStorage } from '../storage/storage.js';
import { notFound } from './product-views.js';

type Localized = { en: string; ar: string };
type Conn = Db | Transaction<Database>;
type Eb = ExpressionBuilder<
  Database & { p: Database['products']; b: Database['businesses'] },
  'p' | 'b'
>;

/**
 * The single visibility rule for products (T02, docs/01-product.md "no public listing before
 * approval"): the listing is active (approved, not suspended or archived), the seller is approved
 * with a published storefront and an active shop mode. Only live_* content is ever returned.
 */
export function productVisible(eb: Eb) {
  return eb.and([
    eb('p.status', '=', 'active'),
    // An admin can switch a category (or its parent) off for everyone (D10, D11).
    sql<SqlBool>`category_is_live(${eb.ref('p.live_category_id')})`,
    eb('b.status', '=', 'approved'),
    eb.exists(
      eb
        .selectFrom('storefronts as sf')
        .select('sf.id')
        .whereRef('sf.business_id', '=', 'b.id')
        .where('sf.published_at', 'is not', null),
    ),
    eb.exists(
      eb
        .selectFrom('business_modes as bm')
        .select('bm.id')
        .whereRef('bm.business_id', '=', 'b.id')
        .where('bm.mode', '=', 'shop')
        .where('bm.status', '=', 'active'),
    ),
  ]);
}

/** Variant ids (of `ids`) that can be bought right now, with what checkout needs to price them. */
export async function purchasableVariants(db: Conn, ids: readonly string[]) {
  if (ids.length === 0) return [];
  return db
    .selectFrom('variants as v')
    .innerJoin('products as p', 'p.id', 'v.product_id')
    .innerJoin('businesses as b', 'b.id', 'p.business_id')
    .select([
      'v.id',
      'v.product_id',
      'v.business_id',
      'v.sku',
      'v.name',
      'v.price_fils',
      'v.tax_class',
      'v.stock_on_hand',
      'v.stock_reserved',
      'p.live_title',
      'p.live_media_ids',
    ])
    .where('v.id', 'in', [...ids])
    .where('v.status', '=', 'active')
    .where((eb) => productVisible(eb as unknown as Eb))
    .execute();
}

const cursorShape = z.tuple([z.union([z.string().max(40), z.number().int()]), z.uuid()]);
function decodeProductCursor(cursor: string | undefined): [string | number, string] | undefined {
  if (cursor === undefined) return undefined;
  try {
    return cursorShape.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString()));
  } catch {
    throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'The cursor is not valid.', {
      cursor: ['is not valid'],
    });
  }
}
const encodeProductCursor = (key: string | number, id: string) =>
  Buffer.from(JSON.stringify([key, id])).toString('base64url');

@Injectable()
export class PublicProductsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  mediaUrl(id: string | null | undefined): string | null {
    return id ? `${this.env.API_PUBLIC_URL.replace(/\/$/, '')}/media/${id}` : null;
  }

  private visibleBase() {
    const agg = this.db
      .selectFrom('variants')
      .select([
        'product_id',
        sql<number>`min(price_fils)::int`.as('price_from'),
        sql<number>`max(price_fils)::int`.as('price_to'),
        sql<boolean>`bool_or(stock_on_hand > stock_reserved)`.as('in_stock'),
      ])
      .where('status', '=', 'active')
      .groupBy('product_id')
      .as('va');
    return this.db
      .selectFrom('products as p')
      .innerJoin('businesses as b', 'b.id', 'p.business_id')
      .innerJoin('storefronts as s', 's.business_id', 'b.id')
      .innerJoin(agg, 'va.product_id', 'p.id')
      .leftJoin('brands as br', 'br.id', 'p.live_brand_id')
      .where((eb) => productVisible(eb as unknown as Eb))
      .select([
        'p.id',
        'p.live_title',
        'p.live_description',
        'p.live_details',
        'p.live_category_id',
        'p.live_brand_id',
        'p.live_media_ids',
        'p.live_return_eligible',
        'p.published_at',
        'b.id as business_id',
        's.live_name as store_name',
        'br.name as brand_name',
        'va.price_from',
        'va.price_to',
        'va.in_stock',
      ])
      .select(
        sql<string>`to_char(p.published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as(
          'published_ts',
        ),
      );
  }

  async list(query: ProductListQuery) {
    const cursor = decodeProductCursor(query.cursor);
    let q = this.visibleBase();
    if (query.store) q = q.where('p.business_id', '=', query.store);
    if (query.brand) q = q.where('p.live_brand_id', '=', query.brand);
    if (query.category) {
      const root = query.category;
      // The category and its descendants (the tree has at most three levels).
      q = q.where('p.live_category_id', 'in', (eb) =>
        eb
          .selectFrom('categories as c')
          .leftJoin('categories as c1', 'c1.id', 'c.parent_id')
          .select('c.id')
          .where((w) =>
            w.or([w('c.id', '=', root), w('c.parent_id', '=', root), w('c1.parent_id', '=', root)]),
          ),
      );
    }
    if (query.minPriceFils !== undefined) q = q.where('va.price_from', '>=', query.minPriceFils);
    if (query.maxPriceFils !== undefined) q = q.where('va.price_from', '<=', query.maxPriceFils);
    if (query.availability === 'in_stock') q = q.where('va.in_stock', '=', true);
    if (query.q) {
      const like = `%${query.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      q = q.where((eb) =>
        eb.or([
          eb(sql`p.live_title->>'en'`, 'ilike', like),
          eb(sql`p.live_title->>'ar'`, 'ilike', like),
        ]),
      );
    }
    if (query.sort === 'newest') {
      if (cursor) {
        q = q.where(
          sql<boolean>`(p.published_at, p.id) < (${String(cursor[0])}::timestamptz, ${cursor[1]}::uuid)`,
        );
      }
      q = q.orderBy('p.published_at', 'desc').orderBy('p.id', 'desc');
    } else {
      const asc = query.sort === 'price_asc';
      if (cursor) {
        const op = asc ? sql`>` : sql`<`;
        q = q.where(
          sql<boolean>`(va.price_from, p.id) ${op} (${Number(cursor[0])}::int, ${cursor[1]}::uuid)`,
        );
      }
      q = q.orderBy('va.price_from', asc ? 'asc' : 'desc').orderBy('p.id', asc ? 'asc' : 'desc');
    }
    const rows = await q.limit(query.limit + 1).execute();
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((r): PublicProductListItem => ({
        id: r.id,
        title: r.live_title as Localized,
        brand: r.live_brand_id && r.brand_name ? { id: r.live_brand_id, name: r.brand_name } : null,
        store: { id: r.business_id, name: r.store_name as Localized },
        categoryId: r.live_category_id as string,
        imageUrl: this.mediaUrl(r.live_media_ids[0]),
        priceFromFils: r.price_from,
        priceToFils: r.price_to,
        currency: 'AED',
        inStock: r.in_stock,
        publishedAt: (r.published_at as Date).toISOString(),
      })),
      nextCursor:
        rows.length > query.limit && last
          ? encodeProductCursor(
              query.sort === 'newest' ? last.published_ts : last.price_from,
              last.id,
            )
          : null,
    };
  }

  async get(productId: string): Promise<PublicProduct> {
    const r = await this.visibleBase().where('p.id', '=', productId).executeTakeFirst();
    if (!r) throw notFound();
    const [variants, zones] = await Promise.all([
      this.db
        .selectFrom('variants')
        .select([
          'id',
          'name',
          'sku',
          'price_fils',
          'stock_on_hand',
          'stock_reserved',
          'low_stock_threshold',
        ])
        .where('product_id', '=', productId)
        .where('status', '=', 'active')
        .orderBy('sort_order')
        .orderBy('created_at')
        .orderBy('id')
        .execute(),
      this.db
        .selectFrom('delivery_zones as z')
        .innerJoin('emirates as e', 'e.code', 'z.emirate_code')
        .select(['z.emirate_code', 'z.fee_fils', 'z.free_over_fils', 'z.min_days', 'z.max_days'])
        .where('z.business_id', '=', r.business_id)
        .where('e.enabled', '=', true)
        .orderBy('e.sort_order')
        .execute(),
    ]);
    return {
      id: r.id,
      title: r.live_title as Localized,
      description: r.live_description as Localized,
      details: r.live_details,
      brand: r.live_brand_id && r.brand_name ? { id: r.live_brand_id, name: r.brand_name } : null,
      store: { id: r.business_id, name: r.store_name as Localized },
      categoryId: r.live_category_id as string,
      images: r.live_media_ids.map((id) => this.mediaUrl(id) as string),
      returnEligible: r.live_return_eligible as boolean,
      currency: 'AED',
      variants: variants.map((v) => {
        const available = availableStock({ onHand: v.stock_on_hand, reserved: v.stock_reserved });
        return {
          id: v.id,
          name: v.name,
          sku: v.sku,
          priceFils: v.price_fils,
          inStock: available > 0,
          lowStock: available > 0 && available <= v.low_stock_threshold,
        };
      }),
      delivery: zones.map((z) => ({
        emirate: z.emirate_code as EmirateCode,
        feeFils: z.fee_fils,
        freeOverFils: z.free_over_fils,
        minDays: z.min_days,
        maxDays: z.max_days,
      })),
      inStock: r.in_stock,
      publishedAt: (r.published_at as Date).toISOString(),
    };
  }

  /** Signed URL for a live image of a visible product; null when not public. */
  async mediaRedirect(mediaId: string): Promise<string | null> {
    const row = await this.db
      .selectFrom('products as p')
      .innerJoin('businesses as b', 'b.id', 'p.business_id')
      .innerJoin('media as md', (join) => join.onRef('md.business_id', '=', 'p.business_id'))
      .select('md.object_key')
      .where('md.id', '=', mediaId)
      .where('md.status', '=', 'ready')
      .where(sql<boolean>`md.id = ANY(p.live_media_ids)`)
      .where((eb) => productVisible(eb as unknown as Eb))
      .executeTakeFirst();
    if (!row) return null;
    return this.storage.signDownload(row.object_key, {
      expiresAt: addSeconds(this.clock.now(), DOWNLOAD_URL_TTL_SECONDS),
      disposition: 'inline',
    }).url;
  }
}
