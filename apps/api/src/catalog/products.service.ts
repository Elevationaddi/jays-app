import { Inject, Injectable } from '@nestjs/common';
import type {
  CreateProductRequest,
  MerchantProduct,
  MerchantProductListItem,
  MerchantProductListQuery,
  MerchantVariant,
  UpdateProductRequest,
  UpdateVariantRequest,
  VariantInput,
} from '@jays/contracts';
import type { Database, Db } from '@jays/db';
import { canEditProduct, canSubmitProduct } from '@jays/domain';
import { type Expression, type SqlBool, sql, type Transaction } from 'kysely';
import type { BusinessContext } from '../businesses/business-access.guard.js';
import { writeAudit } from '../common/audit.js';
import { CLOCK, type Clock } from '../common/clock.js';
import { afterCursor, cursorTs, decodeCursor, toPage } from '../common/pagination.js';
import type { RequestMeta } from '../common/request-context.js';
import { DB } from '../common/tokens.js';
import { OBJECT_STORAGE, type ObjectStorage } from '../storage/storage.js';
import {
  conflict,
  merchantProductView,
  notFound,
  policy,
  signedMediaUrls,
  toMerchantVariant,
  VARIANT_COLUMNS,
} from './product-views.js';

type Trx = Transaction<Database>;

function isUniqueViolation(error: unknown, constraint: string): boolean {
  const e = error as { code?: string; constraint?: string };
  return e?.code === '23505' && e.constraint === constraint;
}

const skuTaken = (sku: string) =>
  conflict('SKU_TAKEN', `SKU ${sku} is already used in this business.`, {
    sku: ['is already used in this business'],
  });

/**
 * Merchant catalog (docs/03-business.md: /business/shop/products). Listings go live only through
 * admin approval; after approval, content edits wait for review while the live copy stays public.
 * Prices and stock are operational and apply at once. Deleting means archiving.
 */
@Injectable()
export class ProductsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  view(businessId: string, productId: string): Promise<MerchantProduct> {
    return merchantProductView(this.db, this.storage, this.clock.now(), productId, businessId);
  }

  async list(businessId: string, query: MerchantProductListQuery) {
    const cursor = decodeCursor(query.cursor);
    let q = this.db
      .selectFrom('products as p')
      .select([
        'p.id',
        'p.status',
        'p.title',
        'p.changes_submitted_at',
        'p.updated_at',
        'p.created_at',
      ])
      .select(cursorTs('p.created_at').as('cursor_ts'))
      .select((eb) => [
        eb
          .selectFrom('variants as v')
          .select(eb.fn.countAll<string>().as('n'))
          .whereRef('v.product_id', '=', 'p.id')
          .where('v.status', '=', 'active')
          .as('variant_count'),
        eb
          .selectFrom('variants as v')
          .select(sql<number | null>`min(v.price_fils)`.as('m'))
          .whereRef('v.product_id', '=', 'p.id')
          .where('v.status', '=', 'active')
          .as('price_from'),
        eb
          .selectFrom('variants as v')
          .select(sql<string>`coalesce(sum(v.stock_on_hand - v.stock_reserved), 0)`.as('s'))
          .whereRef('v.product_id', '=', 'p.id')
          .where('v.status', '=', 'active')
          .as('available'),
        eb
          .selectFrom('product_media as pm')
          .select('pm.media_id')
          .whereRef('pm.product_id', '=', 'p.id')
          .orderBy('pm.sort_order')
          .limit(1)
          .as('first_media'),
      ])
      .where('p.business_id', '=', businessId);
    if (query.status) q = q.where('p.status', '=', query.status);
    if (query.q) {
      const like = `%${query.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      q = q.where((eb) =>
        eb.or([
          eb(sql`p.title->>'en'`, 'ilike', like),
          eb(sql`p.title->>'ar'`, 'ilike', like),
          eb.exists(
            eb
              .selectFrom('variants as v2')
              .select('v2.id')
              .whereRef('v2.product_id', '=', 'p.id')
              .where('v2.sku', 'ilike', like),
          ),
        ]),
      );
    }
    if (cursor) {
      q = q.where(afterCursor('p.created_at', 'p.id', cursor, 'desc') as Expression<SqlBool>);
    }
    const rows = await q
      .orderBy('p.created_at', 'desc')
      .orderBy('p.id', 'desc')
      .limit(query.limit + 1)
      .execute();
    const now = this.clock.now();
    const images = await signedMediaUrls(
      this.db,
      this.storage,
      now,
      rows.map((r) => r.first_media).filter((id): id is string => !!id),
    );
    const urlOf = new Map(images.map((i) => [i.id, i.url]));
    return toPage(rows, query.limit, (r): MerchantProductListItem => ({
      id: r.id,
      status: r.status,
      title: r.title,
      changesPending: r.changes_submitted_at !== null,
      variantCount: Number(r.variant_count ?? 0),
      priceFromFils: r.price_from === null ? null : Number(r.price_from),
      stockAvailable: Number(r.available ?? 0),
      imageUrl: r.first_media ? (urlOf.get(r.first_media) ?? null) : null,
      updatedAt: r.updated_at.toISOString(),
    }));
  }

  private async checkContent(
    trx: Trx,
    businessId: string,
    body: { categoryId?: string; brandId?: string | null; mediaIds?: string[] },
  ) {
    if (body.categoryId) {
      const category = await trx
        .selectFrom('categories')
        .select('id')
        .where('id', '=', body.categoryId)
        .where('mode', '=', 'shop')
        .where('status', '=', 'active')
        .executeTakeFirst();
      if (!category) {
        throw policy('INVALID_CATEGORY', 'Choose an active product category.', {
          categoryId: ['is not an active product category'],
        });
      }
    }
    if (body.brandId) {
      const brand = await trx
        .selectFrom('brands')
        .select('id')
        .where('id', '=', body.brandId)
        .where('status', '=', 'active')
        .executeTakeFirst();
      if (!brand) {
        throw policy('INVALID_BRAND', 'Choose an active brand.', {
          brandId: ['is not an active brand'],
        });
      }
    }
    if (body.mediaIds && body.mediaIds.length > 0) {
      if (new Set(body.mediaIds).size !== body.mediaIds.length) {
        throw policy('INVALID_MEDIA', 'An image is listed twice.', {
          mediaIds: ['has duplicates'],
        });
      }
      // Only this business's ready product images (tenant isolation, validated media).
      const ok = await trx
        .selectFrom('media')
        .select('id')
        .where('id', 'in', body.mediaIds)
        .where('business_id', '=', businessId)
        .where('purpose', '=', 'product_image')
        .where('status', '=', 'ready')
        .execute();
      if (ok.length !== body.mediaIds.length) {
        throw policy('INVALID_MEDIA', 'Use product images uploaded to this business.', {
          mediaIds: ['must be ready product images of this business'],
        });
      }
    }
  }

  private async setMedia(trx: Trx, productId: string, businessId: string, mediaIds: string[]) {
    await trx.deleteFrom('product_media').where('product_id', '=', productId).execute();
    if (mediaIds.length === 0) return;
    await trx
      .insertInto('product_media')
      .values(
        mediaIds.map((media_id, sort_order) => ({
          product_id: productId,
          business_id: businessId,
          media_id,
          sort_order,
        })),
      )
      .execute();
  }

  private variantValues(businessId: string, productId: string, v: VariantInput, sort: number) {
    return {
      product_id: productId,
      business_id: businessId,
      sku: v.sku,
      name: JSON.stringify(v.name),
      price_fils: v.priceFils,
      tax_class: v.taxClass,
      barcode: v.barcode ?? null,
      weight_grams: v.weightGrams ?? null,
      ...(v.lowStockThreshold === undefined ? {} : { low_stock_threshold: v.lowStockThreshold }),
      sort_order: sort,
    };
  }

  async create(
    ctx: BusinessContext,
    userId: string,
    body: CreateProductRequest,
    meta: RequestMeta,
  ): Promise<MerchantProduct> {
    const skus = body.variants.map((v) => v.sku.toLowerCase());
    if (new Set(skus).size !== skus.length) {
      throw policy('DUPLICATE_SKU', 'Each variant needs its own SKU.', {
        variants: ['have duplicate SKUs'],
      });
    }
    let productId = '';
    try {
      await this.db.transaction().execute(async (trx) => {
        await this.checkContent(trx, ctx.businessId, body);
        const row = await trx
          .insertInto('products')
          .values({
            business_id: ctx.businessId,
            category_id: body.categoryId,
            brand_id: body.brandId ?? null,
            title: JSON.stringify(body.title),
            description: JSON.stringify(body.description),
            details: body.details ? JSON.stringify(body.details) : null,
            return_eligible: body.returnEligible,
            created_by: userId,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        productId = row.id;
        await this.setMedia(trx, productId, ctx.businessId, body.mediaIds);
        await trx
          .insertInto('variants')
          .values(body.variants.map((v, i) => this.variantValues(ctx.businessId, productId, v, i)))
          .execute();
        await writeAudit(trx, {
          actorType: 'user',
          actorId: userId,
          action: 'product.created',
          targetType: 'product',
          targetId: productId,
          businessId: ctx.businessId,
          diff: { variants: body.variants.map((v) => v.sku) },
          requestId: meta.requestId,
        });
      });
    } catch (error) {
      if (isUniqueViolation(error, 'variants_business_id_sku_key')) {
        throw conflict('SKU_TAKEN', 'One of these SKUs is already used in this business.', {
          variants: ['contain a SKU already used in this business'],
        });
      }
      throw error;
    }
    return this.view(ctx.businessId, productId);
  }

  private async lockProduct(trx: Trx, businessId: string, productId: string) {
    const p = await trx
      .selectFrom('products')
      .select(['id', 'status', 'published_at'])
      .where('id', '=', productId)
      .where('business_id', '=', businessId)
      .forUpdate()
      .executeTakeFirst();
    if (!p) throw notFound();
    return p;
  }

  async update(
    ctx: BusinessContext,
    userId: string,
    productId: string,
    body: UpdateProductRequest,
    meta: RequestMeta,
  ): Promise<MerchantProduct> {
    const now = this.clock.now();
    await this.db.transaction().execute(async (trx) => {
      const p = await this.lockProduct(trx, ctx.businessId, productId);
      if (!canEditProduct(p.status)) {
        throw conflict(
          p.status === 'submitted' ? 'PRODUCT_IN_REVIEW' : 'INVALID_TRANSITION',
          p.status === 'submitted'
            ? 'This product is waiting for review and cannot be edited until it is decided.'
            : 'Archived products cannot be edited.',
        );
      }
      await this.checkContent(trx, ctx.businessId, body);
      const set: Record<string, unknown> = {};
      if (body.categoryId !== undefined) set['category_id'] = body.categoryId;
      if (body.brandId !== undefined) set['brand_id'] = body.brandId;
      if (body.title !== undefined) set['title'] = JSON.stringify(body.title);
      if (body.description !== undefined) set['description'] = JSON.stringify(body.description);
      if (body.details !== undefined) {
        set['details'] = body.details === null ? null : JSON.stringify(body.details);
      }
      if (body.returnEligible !== undefined) set['return_eligible'] = body.returnEligible;
      // Edits to a published listing are material changes: they wait for review while the live
      // copy stays public (same rule as storefronts). A rejected draft goes back to draft.
      if (p.published_at) set['changes_submitted_at'] = now;
      if (p.status === 'rejected') set['status'] = 'draft';
      await trx
        .updateTable('products')
        .set({ ...set, version: sql<number>`version + 1` } as never)
        .where('id', '=', productId)
        .execute();
      if (body.mediaIds !== undefined) {
        await this.setMedia(trx, productId, ctx.businessId, body.mediaIds);
      }
      await writeAudit(trx, {
        actorType: 'user',
        actorId: userId,
        action: 'product.updated',
        targetType: 'product',
        targetId: productId,
        businessId: ctx.businessId,
        diff: { fields: Object.keys(body), changesPending: p.published_at !== null },
        requestId: meta.requestId,
      });
    });
    return this.view(ctx.businessId, productId);
  }

  async submit(
    ctx: BusinessContext,
    userId: string,
    productId: string,
    meta: RequestMeta,
  ): Promise<MerchantProduct> {
    const now = this.clock.now();
    await this.db.transaction().execute(async (trx) => {
      const p = await this.lockProduct(trx, ctx.businessId, productId);
      if (!canSubmitProduct(p.status)) {
        throw conflict(
          'INVALID_TRANSITION',
          `A product that is ${p.status} cannot be submitted. Published products are reviewed automatically when edited.`,
        );
      }
      const [variants, images] = await Promise.all([
        trx
          .selectFrom('variants')
          .select('id')
          .where('product_id', '=', productId)
          .where('status', '=', 'active')
          .execute(),
        trx
          .selectFrom('product_media')
          .select('media_id')
          .where('product_id', '=', productId)
          .execute(),
      ]);
      const missing: string[] = [];
      if (variants.length === 0) missing.push('variant');
      if (images.length === 0) missing.push('image');
      if (missing.length > 0) {
        throw policy('PRODUCT_INCOMPLETE', 'Add at least one active variant and one image.', {
          checklist: missing,
        });
      }
      await trx
        .updateTable('products')
        .set({
          status: 'submitted',
          submitted_at: now,
          review_reason: null,
          version: sql<number>`version + 1`,
        } as never)
        .where('id', '=', productId)
        .execute();
      await writeAudit(trx, {
        actorType: 'user',
        actorId: userId,
        action: 'product.submitted',
        targetType: 'product',
        targetId: productId,
        businessId: ctx.businessId,
        diff: { status: { before: p.status, after: 'submitted' } },
        requestId: meta.requestId,
      });
    });
    return this.view(ctx.businessId, productId);
  }

  /** Archive keeps the product and its history; it disappears from the shop and carts. */
  async archive(
    ctx: BusinessContext,
    userId: string,
    productId: string,
    meta: RequestMeta,
  ): Promise<MerchantProduct> {
    const now = this.clock.now();
    await this.db.transaction().execute(async (trx) => {
      const p = await this.lockProduct(trx, ctx.businessId, productId);
      if (p.status === 'archived') return;
      await trx
        .updateTable('products')
        .set({
          status: 'archived',
          archived_at: now,
          suspension_reason: null,
          changes_submitted_at: null,
          version: sql<number>`version + 1`,
        } as never)
        .where('id', '=', productId)
        .execute();
      await writeAudit(trx, {
        actorType: 'user',
        actorId: userId,
        action: 'product.archived',
        targetType: 'product',
        targetId: productId,
        businessId: ctx.businessId,
        diff: { status: { before: p.status, after: 'archived' } },
        requestId: meta.requestId,
      });
    });
    return this.view(ctx.businessId, productId);
  }

  async addVariant(
    ctx: BusinessContext,
    userId: string,
    productId: string,
    body: VariantInput,
    meta: RequestMeta,
  ): Promise<MerchantVariant> {
    try {
      const id = await this.db.transaction().execute(async (trx) => {
        const p = await this.lockProduct(trx, ctx.businessId, productId);
        if (p.status === 'archived') {
          throw conflict('INVALID_TRANSITION', 'Archived products cannot get new variants.');
        }
        const count = await trx
          .selectFrom('variants')
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .where('product_id', '=', productId)
          .executeTakeFirstOrThrow();
        if (Number(count.n) >= 50)
          throw policy('TOO_MANY_VARIANTS', 'A product can have 50 variants.');
        const row = await trx
          .insertInto('variants')
          .values(this.variantValues(ctx.businessId, productId, body, Number(count.n)))
          .returning('id')
          .executeTakeFirstOrThrow();
        await writeAudit(trx, {
          actorType: 'user',
          actorId: userId,
          action: 'variant.created',
          targetType: 'variant',
          targetId: row.id,
          businessId: ctx.businessId,
          diff: { productId, sku: body.sku, priceFils: body.priceFils },
          requestId: meta.requestId,
        });
        return row.id;
      });
      return this.variant(ctx.businessId, id);
    } catch (error) {
      if (isUniqueViolation(error, 'variants_business_id_sku_key')) throw skuTaken(body.sku);
      throw error;
    }
  }

  private async variant(businessId: string, variantId: string): Promise<MerchantVariant> {
    const v = await this.db
      .selectFrom('variants')
      .select(VARIANT_COLUMNS)
      .where('id', '=', variantId)
      .where('business_id', '=', businessId)
      .executeTakeFirst();
    if (!v) throw notFound();
    return toMerchantVariant(v);
  }

  /** Price, tax class and details apply at once; existing orders keep their snapshot (T13). */
  async updateVariant(
    ctx: BusinessContext,
    userId: string,
    variantId: string,
    body: UpdateVariantRequest,
    meta: RequestMeta,
  ): Promise<MerchantVariant> {
    await this.db.transaction().execute(async (trx) => {
      const v = await trx
        .selectFrom('variants as v')
        .innerJoin('products as p', 'p.id', 'v.product_id')
        .select(['v.id', 'v.product_id', 'v.price_fils', 'v.status', 'p.status as product_status'])
        .where('v.id', '=', variantId)
        .where('v.business_id', '=', ctx.businessId)
        .forUpdate('v')
        .executeTakeFirst();
      if (!v) throw notFound();
      if (v.product_status === 'archived') {
        throw conflict('INVALID_TRANSITION', 'Variants of archived products cannot change.');
      }
      if (body.status === 'archived' && v.status === 'active') {
        const others = await trx
          .selectFrom('variants')
          .select('id')
          .where('product_id', '=', v.product_id)
          .where('id', '<>', variantId)
          .where('status', '=', 'active')
          .execute();
        if (
          others.length === 0 &&
          v.product_status !== 'draft' &&
          v.product_status !== 'rejected'
        ) {
          throw policy('LAST_VARIANT', 'A listed product needs at least one active variant.');
        }
      }
      const set: Record<string, unknown> = {};
      if (body.name !== undefined) set['name'] = JSON.stringify(body.name);
      if (body.priceFils !== undefined) set['price_fils'] = body.priceFils;
      if (body.taxClass !== undefined) set['tax_class'] = body.taxClass;
      if (body.barcode !== undefined) set['barcode'] = body.barcode;
      if (body.weightGrams !== undefined) set['weight_grams'] = body.weightGrams;
      if (body.lowStockThreshold !== undefined) set['low_stock_threshold'] = body.lowStockThreshold;
      if (body.status !== undefined) set['status'] = body.status;
      await trx.updateTable('variants').set(set).where('id', '=', variantId).execute();
      await writeAudit(trx, {
        actorType: 'user',
        actorId: userId,
        action: 'variant.updated',
        targetType: 'variant',
        targetId: variantId,
        businessId: ctx.businessId,
        diff: {
          fields: Object.keys(body),
          ...(body.priceFils !== undefined
            ? { priceFils: { before: v.price_fils, after: body.priceFils } }
            : {}),
        },
        requestId: meta.requestId,
      });
    });
    return this.variant(ctx.businessId, variantId);
  }
}
