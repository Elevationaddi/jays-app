import { Inject, Injectable } from '@nestjs/common';
import type { MerchantOrderListQuery, MerchantOrderView, OrderView } from '@jays/contracts';
import type { Db } from '@jays/db';
import type { EmirateCode } from '@jays/domain';
import { type Expression, type SqlBool } from 'kysely';
import { afterCursor, cursorTs, decodeCursor, toPage } from '../common/pagination.js';
import { DB } from '../common/tokens.js';
import { notFound } from '../catalog/product-views.js';

type Localized = { en: string; ar: string };
interface Snapshot {
  title: Localized;
  variantName: Localized;
  sku: string;
}
interface DeliverySnapshot {
  emirate: EmirateCode;
  minDays: number;
  maxDays: number;
}
interface AddressSnapshot {
  emirate: EmirateCode;
  area: string;
  street: string;
  building: string;
  unit: string | null;
}

const itemColumns = [
  'oi.id',
  'oi.merchant_order_id',
  'oi.product_id',
  'oi.variant_id',
  'oi.qty',
  'oi.unit_price_fils',
  'oi.line_total_fils',
  'oi.tax_fils',
  'oi.snapshot',
] as const;

function toItem(i: {
  id: string;
  product_id: string;
  variant_id: string;
  qty: number;
  unit_price_fils: number;
  line_total_fils: number;
  tax_fils: number;
  snapshot: unknown;
}) {
  const s = i.snapshot as Snapshot;
  return {
    id: i.id,
    productId: i.product_id,
    variantId: i.variant_id,
    title: s.title,
    variantName: s.variantName,
    sku: s.sku,
    qty: i.qty,
    unitPriceFils: i.unit_price_fils,
    lineTotalFils: i.line_total_fils,
    taxFils: i.tax_fils,
  };
}

const addressOf = (a: unknown) => {
  const s = a as AddressSnapshot;
  return { emirate: s.emirate, area: s.area, street: s.street, building: s.building, unit: s.unit };
};

/**
 * Order reads. Customers see only their own orders (T03); merchants see only their own suborders
 * and the minimum customer data needed to deliver. Everything comes from the order snapshot, so
 * later price or title changes never alter history (T13).
 */
@Injectable()
export class OrdersService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async listForUser(userId: string, query: { cursor?: string | undefined; limit: number }) {
    const cursor = decodeCursor(query.cursor);
    let q = this.db
      .selectFrom('orders as o')
      .select(['o.id', 'o.status', 'o.total_fils', 'o.created_at'])
      .select(cursorTs('o.created_at').as('cursor_ts'))
      .select((eb) => [
        eb
          .selectFrom('order_items')
          .select((e) => e.fn.sum<string>('qty').as('n'))
          .whereRef('order_id', '=', 'o.id')
          .as('item_count'),
        eb
          .selectFrom('merchant_orders')
          .select((e) => e.fn.countAll<string>().as('n'))
          .whereRef('order_id', '=', 'o.id')
          .as('merchant_count'),
      ])
      .where('o.user_id', '=', userId);
    if (cursor)
      q = q.where(afterCursor('o.created_at', 'o.id', cursor, 'desc') as Expression<SqlBool>);
    const rows = await q
      .orderBy('o.created_at', 'desc')
      .orderBy('o.id', 'desc')
      .limit(query.limit + 1)
      .execute();
    return toPage(rows, query.limit, (r) => ({
      id: r.id,
      status: r.status,
      totalFils: r.total_fils,
      currency: 'AED' as const,
      itemCount: Number(r.item_count ?? 0),
      merchantCount: Number(r.merchant_count ?? 0),
      createdAt: r.created_at.toISOString(),
    }));
  }

  async getForUser(userId: string, orderId: string): Promise<OrderView> {
    const o = await this.db
      .selectFrom('orders as o')
      .leftJoin('payments as pay', 'pay.order_id', 'o.id')
      .selectAll('o')
      .select(['pay.status as payment_status', 'pay.client_secret', 'pay.provider_intent_id'])
      .where('o.id', '=', orderId)
      .where('o.user_id', '=', userId)
      .executeTakeFirst();
    if (!o) throw notFound();
    const [merchants, items] = await Promise.all([
      this.db
        .selectFrom('merchant_orders as mo')
        .leftJoin('storefronts as s', 's.business_id', 'mo.business_id')
        .innerJoin('businesses as b', 'b.id', 'mo.business_id')
        .selectAll('mo')
        .select(['s.live_name', 'b.display_name'])
        .where('mo.order_id', '=', orderId)
        .orderBy('mo.business_id')
        .execute(),
      this.db
        .selectFrom('order_items as oi')
        .select(itemColumns)
        .where('oi.order_id', '=', orderId)
        .orderBy('oi.variant_id')
        .execute(),
    ]);
    const open = o.status === 'pending_payment';
    return {
      id: o.id,
      status: o.status,
      paymentStatus: o.payment_status ?? null,
      paymentExpiresAt: o.payment_expires_at.toISOString(),
      paymentClientSecret: open ? (o.client_secret ?? null) : null,
      paymentIntentId: open ? (o.provider_intent_id ?? null) : null,
      subtotalFils: o.subtotal_fils,
      deliveryFils: o.delivery_fils,
      discountFils: o.discount_fils,
      taxFils: o.tax_fils,
      totalFils: o.total_fils,
      currency: 'AED',
      address: addressOf(o.address_snapshot),
      merchants: merchants.map((m) => {
        const d = m.delivery_snapshot as DeliverySnapshot;
        return {
          id: m.id,
          store: { id: m.business_id, name: (m.live_name ?? m.display_name) as Localized },
          status: m.status,
          cancelReason: m.cancel_reason,
          items: items.filter((i) => i.merchant_order_id === m.id).map(toItem),
          delivery: {
            emirate: d.emirate,
            feeFils: m.delivery_fils,
            minDays: d.minDays,
            maxDays: d.maxDays,
          },
          subtotalFils: m.subtotal_fils,
          deliveryFils: m.delivery_fils,
          discountFils: m.discount_fils,
          taxFils: m.tax_fils,
          totalFils: m.total_fils,
        };
      }),
      createdAt: o.created_at.toISOString(),
      paidAt: o.paid_at?.toISOString() ?? null,
    };
  }

  async listForBusiness(businessId: string, query: MerchantOrderListQuery) {
    const cursor = decodeCursor(query.cursor);
    let q = this.db
      .selectFrom('merchant_orders as mo')
      .select(['mo.id', 'mo.order_id', 'mo.status', 'mo.total_fils', 'mo.created_at'])
      .select(cursorTs('mo.created_at').as('cursor_ts'))
      .select((eb) =>
        eb
          .selectFrom('order_items')
          .select((e) => e.fn.sum<string>('qty').as('n'))
          .whereRef('merchant_order_id', '=', 'mo.id')
          .as('item_count'),
      )
      .where('mo.business_id', '=', businessId);
    if (query.status) q = q.where('mo.status', '=', query.status);
    if (cursor)
      q = q.where(afterCursor('mo.created_at', 'mo.id', cursor, 'desc') as Expression<SqlBool>);
    const rows = await q
      .orderBy('mo.created_at', 'desc')
      .orderBy('mo.id', 'desc')
      .limit(query.limit + 1)
      .execute();
    return toPage(rows, query.limit, (r) => ({
      id: r.id,
      orderId: r.order_id,
      status: r.status,
      itemCount: Number(r.item_count ?? 0),
      totalFils: r.total_fils,
      currency: 'AED' as const,
      createdAt: r.created_at.toISOString(),
    }));
  }

  async getForBusiness(businessId: string, merchantOrderId: string): Promise<MerchantOrderView> {
    const m = await this.db
      .selectFrom('merchant_orders as mo')
      .innerJoin('orders as o', 'o.id', 'mo.order_id')
      .innerJoin('users as u', 'u.id', 'o.user_id')
      .selectAll('mo')
      .select(['o.address_snapshot', 'u.display_name'])
      .where('mo.id', '=', merchantOrderId)
      .where('mo.business_id', '=', businessId)
      .executeTakeFirst();
    if (!m) throw notFound();
    const items = await this.db
      .selectFrom('order_items as oi')
      .select(itemColumns)
      .where('oi.merchant_order_id', '=', m.id)
      .orderBy('oi.variant_id')
      .execute();
    const d = m.delivery_snapshot as DeliverySnapshot;
    return {
      id: m.id,
      orderId: m.order_id,
      status: m.status,
      cancelReason: m.cancel_reason,
      items: items.map(toItem),
      delivery: {
        emirate: d.emirate,
        feeFils: m.delivery_fils,
        minDays: d.minDays,
        maxDays: d.maxDays,
      },
      address: addressOf(m.address_snapshot),
      customerName: m.display_name,
      subtotalFils: m.subtotal_fils,
      deliveryFils: m.delivery_fils,
      discountFils: m.discount_fils,
      taxFils: m.tax_fils,
      totalFils: m.total_fils,
      currency: 'AED',
      createdAt: m.created_at.toISOString(),
    };
  }
}
