import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  DeliveryZone,
  InventoryItem,
  InventoryListQuery,
  PutDeliveryZonesRequest,
  PutReturnPolicyRequest,
  ReturnPolicyView,
  StockAdjustRequest,
} from '@jays/contracts';
import type { Db } from '@jays/db';
import { availableStock, checkStockAdjustment, type EmirateCode } from '@jays/domain';
import { type Expression, type SqlBool, sql } from 'kysely';
import type { BusinessContext } from '../businesses/business-access.guard.js';
import { writeAudit } from '../common/audit.js';
import { ApiError } from '../common/error.filter.js';
import { idempotent } from '../common/idempotency.js';
import { afterCursor, cursorTs, decodeCursor, toPage } from '../common/pagination.js';
import type { RequestMeta } from '../common/request-context.js';
import { DB } from '../common/tokens.js';
import { notFound } from './product-views.js';

type Localized = { en: string; ar: string };

/**
 * Inventory (docs/03-business.md: /business/shop/inventory) and delivery zones. Every stock
 * change runs under a row lock on the variant, is checked against reserved stock, and writes an
 * append-only movement and an audit entry in the same transaction.
 */
@Injectable()
export class InventoryService {
  constructor(@Inject(DB) private readonly db: Db) {}

  private base(businessId: string) {
    return this.db
      .selectFrom('variants as v')
      .innerJoin('products as p', 'p.id', 'v.product_id')
      .select([
        'v.id',
        'v.product_id',
        'p.title',
        'p.status as product_status',
        'v.name',
        'v.sku',
        'v.stock_on_hand',
        'v.stock_reserved',
        'v.low_stock_threshold',
        'v.status',
        'v.created_at',
      ])
      .where('v.business_id', '=', businessId);
  }

  private toItem(r: {
    id: string;
    product_id: string;
    title: Localized;
    product_status: InventoryItem['productStatus'];
    name: Localized;
    sku: string;
    stock_on_hand: number;
    stock_reserved: number;
    low_stock_threshold: number;
    status: 'active' | 'archived';
  }): InventoryItem {
    const available = availableStock({ onHand: r.stock_on_hand, reserved: r.stock_reserved });
    return {
      variantId: r.id,
      productId: r.product_id,
      productTitle: r.title,
      productStatus: r.product_status,
      variantName: r.name,
      sku: r.sku,
      stockOnHand: r.stock_on_hand,
      stockReserved: r.stock_reserved,
      stockAvailable: available,
      lowStockThreshold: r.low_stock_threshold,
      lowStock: r.status === 'active' && available <= r.low_stock_threshold,
      status: r.status,
    };
  }

  async list(businessId: string, query: InventoryListQuery) {
    const cursor = decodeCursor(query.cursor);
    let q = this.base(businessId)
      .select(cursorTs('v.created_at').as('cursor_ts'))
      .where('p.status', '<>', 'archived');
    if (query.lowStock === 'true') {
      q = q
        .where('v.status', '=', 'active')
        .where(sql<boolean>`v.stock_on_hand - v.stock_reserved <= v.low_stock_threshold`);
    }
    if (query.q) {
      const like = `%${query.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      q = q.where((eb) =>
        eb.or([
          eb('v.sku', 'ilike', like),
          eb(sql`p.title->>'en'`, 'ilike', like),
          eb(sql`p.title->>'ar'`, 'ilike', like),
        ]),
      );
    }
    if (cursor) q = q.where(afterCursor('v.created_at', 'v.id', cursor) as Expression<SqlBool>);
    const rows = await q
      .orderBy('v.created_at')
      .orderBy('v.id')
      .limit(query.limit + 1)
      .execute();
    return toPage(rows, query.limit, (r) => this.toItem(r));
  }

  async item(businessId: string, variantId: string): Promise<InventoryItem> {
    const row = await this.base(businessId).where('v.id', '=', variantId).executeTakeFirst();
    if (!row) throw notFound();
    return this.toItem(row);
  }

  /** Idempotent stock adjustment (docs/07-api.md: Idempotency-Key required). */
  adjust(
    ctx: BusinessContext,
    userId: string,
    body: StockAdjustRequest,
    idempotencyKey: string | undefined,
    meta: RequestMeta,
  ): Promise<InventoryItem> {
    return idempotent(
      this.db,
      {
        actorType: 'user',
        actorId: userId,
        route: `POST /businesses/${ctx.businessId}/inventory/adjust`,
      },
      idempotencyKey,
      body,
      async () => {
        await this.db.transaction().execute(async (trx) => {
          const v = await trx
            .selectFrom('variants')
            .select(['id', 'stock_on_hand', 'stock_reserved', 'status'])
            .where('id', '=', body.variantId)
            .where('business_id', '=', ctx.businessId)
            .forUpdate()
            .executeTakeFirst();
          if (!v) throw notFound();
          const check = checkStockAdjustment(
            { onHand: v.stock_on_hand, reserved: v.stock_reserved },
            body.delta,
            body.reason,
          );
          if (!check.ok) {
            throw new ApiError(
              check.code === 'INSUFFICIENT_STOCK'
                ? HttpStatus.CONFLICT
                : HttpStatus.UNPROCESSABLE_ENTITY,
              check.code,
              check.message,
              { delta: [check.message] },
            );
          }
          await trx
            .updateTable('variants')
            .set({ stock_on_hand: check.onHandAfter })
            .where('id', '=', v.id)
            .execute();
          await trx
            .insertInto('stock_movements')
            .values({
              variant_id: v.id,
              business_id: ctx.businessId,
              delta: body.delta,
              reason: body.reason,
              note: body.note ?? null,
              actor_type: 'user',
              actor_id: userId,
              on_hand_after: check.onHandAfter,
            })
            .execute();
          await writeAudit(trx, {
            actorType: 'user',
            actorId: userId,
            action: 'inventory.adjusted',
            targetType: 'variant',
            targetId: v.id,
            businessId: ctx.businessId,
            reason: body.note ?? null,
            diff: {
              reason: body.reason,
              onHand: { before: v.stock_on_hand, after: check.onHandAfter },
            },
            requestId: meta.requestId,
          });
        });
        return this.item(ctx.businessId, body.variantId);
      },
      200,
    );
  }

  async movements(
    businessId: string,
    variantId: string,
    query: { cursor?: string | undefined; limit: number },
  ) {
    await this.item(businessId, variantId);
    const cursor = decodeCursor(query.cursor);
    let q = this.db
      .selectFrom('stock_movements')
      .selectAll()
      .select(cursorTs('created_at').as('cursor_ts'))
      .where('variant_id', '=', variantId)
      .where('business_id', '=', businessId);
    if (cursor) q = q.where(afterCursor('created_at', 'id', cursor, 'desc') as Expression<SqlBool>);
    const rows = await q
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(query.limit + 1)
      .execute();
    return toPage(rows, query.limit, (r) => ({
      id: r.id,
      delta: r.delta,
      reason: r.reason,
      note: r.note,
      orderId: r.order_id,
      actorType: r.actor_type,
      onHandAfter: r.on_hand_after,
      createdAt: r.created_at.toISOString(),
    }));
  }

  async zones(businessId: string): Promise<{ items: DeliveryZone[] }> {
    const rows = await this.db
      .selectFrom('delivery_zones as z')
      .innerJoin('emirates as e', 'e.code', 'z.emirate_code')
      .select([
        'z.emirate_code',
        'z.method',
        'z.fee_fils',
        'z.free_over_fils',
        'z.min_days',
        'z.max_days',
      ])
      .where('z.business_id', '=', businessId)
      .orderBy('e.sort_order')
      .orderBy('z.method', 'desc')
      .execute();
    return {
      items: rows.map((z) => ({
        emirate: z.emirate_code as EmirateCode,
        method: z.method,
        feeFils: z.fee_fils,
        freeOverFils: z.free_over_fils,
        minDays: z.min_days,
        maxDays: z.max_days,
      })),
    };
  }

  /** Replaces the business's delivery zones. Quotes already issued keep their own fees. */
  async putZones(
    ctx: BusinessContext,
    userId: string,
    body: PutDeliveryZonesRequest,
    meta: RequestMeta,
  ): Promise<{ items: DeliveryZone[] }> {
    await this.db.transaction().execute(async (trx) => {
      await trx
        .selectFrom('businesses')
        .select('id')
        .where('id', '=', ctx.businessId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      await trx.deleteFrom('delivery_zones').where('business_id', '=', ctx.businessId).execute();
      if (body.zones.length > 0) {
        await trx
          .insertInto('delivery_zones')
          .values(
            body.zones.map((z) => ({
              business_id: ctx.businessId,
              emirate_code: z.emirate,
              method: z.method,
              fee_fils: z.feeFils,
              free_over_fils: z.freeOverFils ?? null,
              min_days: z.minDays,
              max_days: z.maxDays,
            })),
          )
          .execute();
      }
      await writeAudit(trx, {
        actorType: 'user',
        actorId: userId,
        action: 'delivery_zones.updated',
        targetType: 'business',
        targetId: ctx.businessId,
        businessId: ctx.businessId,
        diff: {
          zones: body.zones.map((z) => ({
            emirate: z.emirate,
            method: z.method,
            feeFils: z.feeFils,
          })),
        },
        requestId: meta.requestId,
      });
    });
    return this.zones(ctx.businessId);
  }

  /** The business's return policy (ADR-0029). */
  async returnPolicy(businessId: string): Promise<ReturnPolicyView> {
    const b = await this.db
      .selectFrom('businesses')
      .select(['return_window_days', 'return_policy_note'])
      .where('id', '=', businessId)
      .executeTakeFirstOrThrow();
    return { windowDays: b.return_window_days, note: b.return_policy_note };
  }

  /** Changes the return policy. Orders already placed keep the policy they were placed under. */
  async putReturnPolicy(
    ctx: BusinessContext,
    userId: string,
    body: PutReturnPolicyRequest,
    meta: RequestMeta,
  ): Promise<ReturnPolicyView> {
    const note = body.note && (body.note.en || body.note.ar) ? body.note : null;
    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('businesses')
        .set({
          return_window_days: body.windowDays,
          return_policy_note: note ? JSON.stringify(note) : null,
        })
        .where('id', '=', ctx.businessId)
        .execute();
      await writeAudit(trx, {
        actorType: 'user',
        actorId: userId,
        action: 'return_policy.updated',
        targetType: 'business',
        targetId: ctx.businessId,
        businessId: ctx.businessId,
        diff: { windowDays: body.windowDays, note: note !== null },
        requestId: meta.requestId,
      });
    });
    return this.returnPolicy(ctx.businessId);
  }
}
