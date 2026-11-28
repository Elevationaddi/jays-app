import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { CreateOrderResponse, QuoteView } from '@jays/contracts';
import type { Database, Db } from '@jays/db';
import {
  availableStock,
  chooseDeliveryMethod,
  type DeliveryMethod,
  type DeliveryZoneRule,
  type EmirateCode,
  PAYMENT_WINDOW_SECONDS,
  priceOrder,
  type PricedOrder,
  PricingError,
  type PricingLine,
  QUOTE_TTL_SECONDS,
  type TaxClass,
} from '@jays/domain';
import { sql, type Transaction } from 'kysely';
import { writeAudit } from '../common/audit.js';
import { addSeconds, CLOCK, type Clock } from '../common/clock.js';
import { ApiError } from '../common/error.filter.js';
import { idempotent } from '../common/idempotency.js';
import type { RequestMeta } from '../common/request-context.js';
import { DB } from '../common/tokens.js';
import { conflict, notFound, policy } from '../catalog/product-views.js';
import { purchasableVariants } from '../catalog/public-products.service.js';
import { nonReturnableCategoryIds } from '../catalog/returnability.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from '../payments/provider.js';

type Trx = Transaction<Database>;
type Conn = Db | Trx;
type Localized = { en: string; ar: string };

/** What a quote stores per line, beyond the pricing inputs: the snapshot the order keeps (T13). */
interface QuoteLine extends PricingLine {
  lineTotalFils: number;
  taxRateBps: number;
  taxFils: number;
  title: Localized;
  variantName: Localized;
  sku: string;
  imageMediaId: string | null;
}
interface QuoteGroup {
  businessId: string;
  storeName: Localized;
  lines: QuoteLine[];
  /** method is absent on quotes made before ADR-0029: standard. */
  delivery: DeliveryZoneRule & { emirate: EmirateCode; method?: DeliveryMethod };
  deliveryOptions?: DeliveryOption[];
  subtotalFils: number;
  deliveryFils: number;
  deliveryTaxFils: number;
  discountFils: number;
  taxFils: number;
  totalFils: number;
}
interface DeliveryOption extends DeliveryZoneRule {
  method: DeliveryMethod;
}
interface AddressSnapshot {
  emirate: EmirateCode;
  area: string;
  street: string;
  building: string;
  unit: string | null;
  directions: string | null;
  label: string | null;
}

/** Current tax rate per class (latest effective rate). */
export async function currentTaxRates(conn: Conn, now: Date): Promise<Record<TaxClass, number>> {
  const rows = await conn
    .selectFrom('tax_rates')
    .select(['tax_class', 'rate_bps'])
    .distinctOn('tax_class')
    .where('effective_at', '<=', now)
    .orderBy('tax_class')
    .orderBy('effective_at', 'desc')
    .execute();
  const rates = Object.fromEntries(rows.map((r) => [r.tax_class, r.rate_bps])) as Partial<
    Record<TaxClass, number>
  >;
  if (
    rates.standard === undefined ||
    rates.zero_rated === undefined ||
    rates.exempt === undefined
  ) {
    throw new Error('tax rates are not configured');
  }
  return rates as Record<TaxClass, number>;
}

/**
 * Quote and checkout (docs/05-workflows.md, product checkout steps 1–3). The server prices
 * everything; an order is created only from an unexpired quote whose prices, delivery fees and
 * stock still hold, under row locks on the variants taken in ascending id order. Payment is
 * confirmed later, only by a verified webhook.
 */
@Injectable()
export class CheckoutService {
  private readonly log = new Logger(CheckoutService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  /** D4: the sellers that charge VAT. */
  private async vatRegistered(conn: Conn, businessIds: string[]): Promise<Set<string>> {
    if (businessIds.length === 0) return new Set();
    const rows = await conn
      .selectFrom('businesses')
      .select('id')
      .where('id', 'in', businessIds)
      .where('tax_registered', '=', true)
      .execute();
    return new Set(rows.map((r) => r.id));
  }

  /**
   * Each seller's delivery to the emirate: every method it offers, and the one this order uses
   * (the customer's choice, else standard, else the cheapest; ADR-0029). A seller with no zone is
   * left out, and pricing refuses it. Asking for a method a seller does not offer is refused.
   */
  private async zonesFor(
    conn: Conn,
    businessIds: string[],
    emirate: string,
    requested: Readonly<Record<string, DeliveryMethod>> = {},
  ) {
    const chosen = new Map<string, DeliveryOption>();
    const options = new Map<string, DeliveryOption[]>();
    if (businessIds.length === 0) return { chosen, options };
    const rows = await conn
      .selectFrom('delivery_zones')
      .select(['business_id', 'method', 'fee_fils', 'free_over_fils', 'min_days', 'max_days'])
      .where('business_id', 'in', businessIds)
      .where('emirate_code', '=', emirate)
      .execute();
    for (const z of rows) {
      const list = options.get(z.business_id) ?? [];
      list.push({
        method: z.method,
        feeFils: z.fee_fils,
        freeOverFils: z.free_over_fils,
        minDays: z.min_days,
        maxDays: z.max_days,
      });
      options.set(z.business_id, list);
    }
    const unavailable: string[] = [];
    for (const [businessId, list] of options) {
      list.sort((a, b) => (a.method === b.method ? 0 : a.method === 'standard' ? -1 : 1));
      const pick = chooseDeliveryMethod(list, requested[businessId]);
      if (pick) chosen.set(businessId, pick);
      else unavailable.push(businessId);
    }
    if (unavailable.length > 0) {
      throw policy('DELIVERY_METHOD_UNAVAILABLE', 'A seller does not offer that delivery method.', {
        stores: unavailable,
      });
    }
    return { chosen, options };
  }

  private price(
    lines: PricingLine[],
    zones: Map<string, DeliveryZoneRule>,
    rates: Record<TaxClass, number>,
    vatRegistered: ReadonlySet<string>,
  ): PricedOrder {
    try {
      return priceOrder(lines, zones, rates, undefined, vatRegistered);
    } catch (error) {
      if (error instanceof PricingError && error.code === 'NO_DELIVERY_ZONE') {
        throw policy('DELIVERY_UNAVAILABLE', 'Some sellers do not deliver to this address.', {
          stores: error.businessIds,
        });
      }
      throw error;
    }
  }

  async quote(
    userId: string,
    addressId: string,
    deliveryMethods: Readonly<Record<string, DeliveryMethod>> = {},
  ): Promise<QuoteView> {
    const now = this.clock.now();
    const address = await this.db
      .selectFrom('addresses')
      .select(['id', 'emirate_code', 'area', 'street', 'building', 'unit', 'directions', 'label'])
      .where('id', '=', addressId)
      .where('user_id', '=', userId)
      .where('archived_at', 'is', null)
      .executeTakeFirst();
    if (!address) throw notFound();
    // D11: an emirate switched off by operations takes no new deliveries.
    const emirateOn = await this.db
      .selectFrom('emirates')
      .select('enabled')
      .where('code', '=', address.emirate_code)
      .executeTakeFirst();
    if (!emirateOn?.enabled) {
      throw policy('EMIRATE_NOT_AVAILABLE', 'Delivery to this emirate is not available yet.');
    }
    const cart = await this.db
      .selectFrom('carts')
      .select('id')
      .where('user_id', '=', userId)
      .where('status', '=', 'active')
      .executeTakeFirst();
    const items = cart
      ? await this.db
          .selectFrom('cart_items')
          .select(['variant_id', 'qty'])
          .where('cart_id', '=', cart.id)
          .execute()
      : [];
    if (!cart || items.length === 0) throw policy('CART_EMPTY', 'Your cart is empty.');
    const variants = new Map(
      (
        await purchasableVariants(
          this.db,
          items.map((i) => i.variant_id),
        )
      ).map((v) => [v.id, v]),
    );
    const problems: Record<string, string[]> = {};
    for (const item of items) {
      const v = variants.get(item.variant_id);
      if (!v) problems[item.variant_id] = ['unavailable'];
      else {
        const available = availableStock({ onHand: v.stock_on_hand, reserved: v.stock_reserved });
        if (available < item.qty)
          problems[item.variant_id] = [available === 0 ? 'out_of_stock' : 'insufficient_stock'];
      }
    }
    if (Object.keys(problems).length > 0) {
      throw conflict(
        'CART_NOT_READY',
        'Some items are unavailable or short of stock. Review your cart.',
        problems,
      );
    }
    const lines: PricingLine[] = items.map((item) => {
      const v = variants.get(item.variant_id) as NonNullable<ReturnType<typeof variants.get>>;
      return {
        variantId: v.id,
        productId: v.product_id,
        businessId: v.business_id,
        qty: item.qty,
        unitPriceFils: v.price_fils,
        taxClass: v.tax_class,
      };
    });
    const businessIds = [...new Set(lines.map((l) => l.businessId))];
    const [zones, rates, stores, vatRegistered] = await Promise.all([
      this.zonesFor(this.db, businessIds, address.emirate_code, deliveryMethods),
      currentTaxRates(this.db, now),
      this.db
        .selectFrom('storefronts')
        .select(['business_id', 'live_name'])
        .where('business_id', 'in', businessIds)
        .execute(),
      this.vatRegistered(this.db, businessIds),
    ]);
    const priced = this.price(lines, zones.chosen, rates, vatRegistered);
    const storeName = new Map(stores.map((s) => [s.business_id, s.live_name as Localized]));
    const emirate = address.emirate_code as EmirateCode;
    const groups: QuoteGroup[] = priced.groups.map((g) => ({
      businessId: g.businessId,
      storeName: storeName.get(g.businessId) as Localized,
      lines: g.lines.map((l) => {
        const v = variants.get(l.variantId) as NonNullable<ReturnType<typeof variants.get>>;
        return {
          ...l,
          title: v.live_title as Localized,
          variantName: v.name,
          sku: v.sku,
          imageMediaId: v.live_media_ids[0] ?? null,
        };
      }),
      delivery: {
        ...g.delivery,
        emirate,
        method: (zones.chosen.get(g.businessId) as DeliveryOption).method,
      },
      deliveryOptions: zones.options.get(g.businessId) ?? [],
      subtotalFils: g.subtotalFils,
      deliveryFils: g.deliveryFils,
      deliveryTaxFils: g.deliveryTaxFils,
      discountFils: g.discountFils,
      taxFils: g.taxFils,
      totalFils: g.totalFils,
    }));
    const snapshot: AddressSnapshot = {
      emirate,
      area: address.area,
      street: address.street,
      building: address.building,
      unit: address.unit,
      directions: address.directions,
      label: address.label,
    };
    const expiresAt = addSeconds(now, QUOTE_TTL_SECONDS);
    const row = await this.db
      .insertInto('quotes')
      .values({
        user_id: userId,
        cart_id: cart.id,
        address_id: address.id,
        address_snapshot: JSON.stringify(snapshot),
        breakdown: JSON.stringify(groups),
        subtotal_fils: priced.subtotalFils,
        delivery_fils: priced.deliveryFils,
        tax_fils: priced.taxFils,
        total_fils: priced.totalFils,
        expires_at: expiresAt,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return {
      quoteId: row.id,
      expiresAt: expiresAt.toISOString(),
      subtotalFils: priced.subtotalFils,
      deliveryFils: priced.deliveryFils,
      discountFils: priced.discountFils,
      taxFils: priced.taxFils,
      totalFils: priced.totalFils,
      currency: 'AED',
      groups: groups.map((g) => ({
        store: { id: g.businessId, name: g.storeName },
        lines: g.lines.map((l) => ({
          variantId: l.variantId,
          productId: l.productId,
          title: l.title,
          variantName: l.variantName,
          sku: l.sku,
          qty: l.qty,
          unitPriceFils: l.unitPriceFils,
          lineTotalFils: l.lineTotalFils,
          taxFils: l.taxFils,
        })),
        delivery: {
          emirate: g.delivery.emirate,
          method: g.delivery.method ?? 'standard',
          feeFils: g.deliveryFils,
          minDays: g.delivery.minDays,
          maxDays: g.delivery.maxDays,
        },
        deliveryOptions: (g.deliveryOptions ?? []).map((o) => ({
          method: o.method,
          feeFils: o.freeOverFils !== null && g.subtotalFils >= o.freeOverFils ? 0 : o.feeFils,
          minDays: o.minDays,
          maxDays: o.maxDays,
        })),
        subtotalFils: g.subtotalFils,
        deliveryFils: g.deliveryFils,
        discountFils: g.discountFils,
        taxFils: g.taxFils,
        totalFils: g.totalFils,
      })),
    };
  }

  /**
   * POST /orders. Idempotent twice over: by Idempotency-Key (identical retry returns the stored
   * response) and by quote (one order per quote, so a duplicate checkout returns the same order).
   */
  createOrder(
    userId: string,
    quoteId: string,
    idempotencyKey: string | undefined,
    meta: RequestMeta,
  ): Promise<CreateOrderResponse> {
    return idempotent(
      this.db,
      { actorType: 'user', actorId: userId, route: 'POST /orders' },
      idempotencyKey,
      { quoteId },
      () => this.placeOrder(userId, quoteId, meta),
    );
  }

  private async placeOrder(
    userId: string,
    quoteId: string,
    meta: RequestMeta,
  ): Promise<CreateOrderResponse> {
    const now = this.clock.now();
    // Release stale holds first so an expired, unpaid order never blocks this sale.
    await sql`SELECT expire_unpaid_orders(${now}, 50)`.execute(this.db);
    const quote = await this.db
      .selectFrom('quotes')
      .selectAll()
      .where('id', '=', quoteId)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (!quote) throw notFound();
    const existing = await this.db
      .selectFrom('orders')
      .select('id')
      .where('quote_id', '=', quoteId)
      .executeTakeFirst();
    if (existing) return this.ensurePayment(existing.id);
    if (quote.expires_at.getTime() <= now.getTime()) {
      throw conflict(
        'QUOTE_EXPIRED',
        'The prices in this quote have expired. Review your order again.',
      );
    }
    const groups = quote.breakdown as QuoteGroup[];
    const address = quote.address_snapshot as AddressSnapshot;
    const lines = groups.flatMap((g) => g.lines);
    const orderId = await this.db.transaction().execute(async (trx) => {
      const ids = [...new Set(lines.map((l) => l.variantId))].sort();
      // Lock order: variant rows in ascending id order (see migration 0004).
      const locked = await trx
        .selectFrom('variants')
        .select(['id', 'stock_on_hand', 'stock_reserved'])
        .where('id', 'in', ids)
        .orderBy('id')
        .forUpdate()
        .execute();
      const stock = new Map(locked.map((v) => [v.id, v]));
      const current = new Map((await purchasableVariants(trx, ids)).map((v) => [v.id, v]));
      const short: Record<string, string[]> = {};
      let stale = false;
      for (const l of lines) {
        const v = current.get(l.variantId);
        const s = stock.get(l.variantId);
        if (!v || !s) {
          stale = true;
          continue;
        }
        if (v.price_fils !== l.unitPriceFils || v.tax_class !== l.taxClass) stale = true;
        const available = availableStock({ onHand: s.stock_on_hand, reserved: s.stock_reserved });
        if (available < l.qty) short[l.variantId] = [`only ${available} available`];
      }
      if (Object.keys(short).length > 0) {
        throw conflict('OUT_OF_STOCK', 'Some items sold out while you were checking out.', short);
      }
      // Delivery fees and tax rates must still produce exactly the quoted totals.
      const repriced = this.price(
        lines,
        (
          await this.zonesFor(
            trx,
            groups.map((g) => g.businessId),
            address.emirate,
            Object.fromEntries(groups.map((g) => [g.businessId, g.delivery.method ?? 'standard'])),
          ).catch((error: unknown) => {
            // A method withdrawn since the quote: the customer must review the order again.
            if (error instanceof ApiError && error.code === 'DELIVERY_METHOD_UNAVAILABLE') {
              throw conflict('QUOTE_STALE', 'Delivery options changed. Review your order again.');
            }
            throw error;
          })
        ).chosen,
        await currentTaxRates(trx, now),
        await this.vatRegistered(
          trx,
          groups.map((g) => g.businessId),
        ),
      );
      if (stale || repriced.totalFils !== quote.total_fils || repriced.taxFils !== quote.tax_fils) {
        throw conflict('QUOTE_STALE', 'Prices or delivery fees changed. Review your order again.');
      }
      const paymentExpiresAt = addSeconds(now, PAYMENT_WINDOW_SECONDS);
      const order = await trx
        .insertInto('orders')
        .values({
          user_id: userId,
          quote_id: quote.id,
          cart_id: quote.cart_id,
          subtotal_fils: quote.subtotal_fils,
          delivery_fils: quote.delivery_fils,
          discount_fils: quote.discount_fils,
          tax_fils: quote.tax_fils,
          total_fils: quote.total_fils,
          address_snapshot: JSON.stringify(address),
          payment_expires_at: paymentExpiresAt,
        })
        .onConflict((oc) => oc.column('quote_id').doNothing())
        .returning('id')
        .executeTakeFirst();
      if (!order) return null; // a concurrent request with the same quote won
      // The return policy in force now is copied onto the order (ADR-0029, T13).
      const [windows, products, excluded] = await Promise.all([
        trx
          .selectFrom('businesses')
          .select(['id', 'return_window_days'])
          .where(
            'id',
            'in',
            groups.map((g) => g.businessId),
          )
          .execute(),
        trx
          .selectFrom('products')
          .select(['id', 'live_return_eligible', 'live_category_id'])
          .where('id', 'in', [...new Set(lines.map((l) => l.productId))])
          .execute(),
        nonReturnableCategoryIds(trx),
      ]);
      const windowOf = new Map(windows.map((w) => [w.id, w.return_window_days]));
      const returnable = new Map(
        products.map((p) => [
          p.id,
          p.live_return_eligible !== false &&
            !(p.live_category_id && excluded.has(p.live_category_id)),
        ]),
      );
      for (const g of groups) {
        const mo = await trx
          .insertInto('merchant_orders')
          .values({
            order_id: order.id,
            business_id: g.businessId,
            subtotal_fils: g.subtotalFils,
            delivery_fils: g.deliveryFils,
            discount_fils: g.discountFils,
            tax_fils: g.taxFils,
            total_fils: g.totalFils,
            delivery_snapshot: JSON.stringify({
              ...g.delivery,
              method: g.delivery.method ?? 'standard',
              deliveryTaxFils: g.deliveryTaxFils,
            }),
            return_window_days: windowOf.get(g.businessId) ?? null,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await trx
          .insertInto('order_items')
          .values(
            g.lines.map((l) => ({
              order_id: order.id,
              merchant_order_id: mo.id,
              business_id: g.businessId,
              product_id: l.productId,
              variant_id: l.variantId,
              qty: l.qty,
              unit_price_fils: l.unitPriceFils,
              line_total_fils: l.lineTotalFils,
              tax_class: l.taxClass,
              tax_rate_bps: l.taxRateBps,
              tax_fils: l.taxFils,
              returnable: returnable.get(l.productId) ?? true,
              snapshot: JSON.stringify({
                title: l.title,
                variantName: l.variantName,
                sku: l.sku,
                imageMediaId: l.imageMediaId,
              }),
            })),
          )
          .execute();
      }
      await trx
        .insertInto('reservations')
        .values(
          lines.map((l) => ({
            order_id: order.id,
            variant_id: l.variantId,
            business_id: l.businessId,
            qty: l.qty,
            expires_at: paymentExpiresAt,
          })),
        )
        .execute();
      for (const l of [...lines].sort((a, b) => (a.variantId < b.variantId ? -1 : 1))) {
        await trx
          .updateTable('variants')
          .set({ stock_reserved: sql<number>`stock_reserved + ${l.qty}` })
          .where('id', '=', l.variantId)
          .execute();
      }
      await trx
        .insertInto('payments')
        .values({
          target_type: 'order',
          order_id: order.id,
          provider: this.provider.name,
          idempotency_key: `order-${order.id}`,
          amount_fils: quote.total_fils,
        })
        .execute();
      await writeAudit(trx, {
        actorType: 'user',
        actorId: userId,
        action: 'order.created',
        targetType: 'order',
        targetId: order.id,
        diff: { totalFils: quote.total_fils, merchants: groups.map((g) => g.businessId) },
        requestId: meta.requestId,
      });
      return order.id;
    });
    if (orderId === null) {
      const winner = await this.db
        .selectFrom('orders')
        .select('id')
        .where('quote_id', '=', quoteId)
        .executeTakeFirstOrThrow();
      return this.ensurePayment(winner.id);
    }
    return this.ensurePayment(orderId);
  }

  /** Creates the provider intent if it is still missing (step 3), then describes the order. */
  async ensurePayment(orderId: string): Promise<CreateOrderResponse> {
    const row = await this.db
      .selectFrom('orders as o')
      .innerJoin('payments as pay', 'pay.order_id', 'o.id')
      .select([
        'o.id',
        'o.status',
        'o.total_fils',
        'o.payment_expires_at',
        'pay.id as payment_id',
        'pay.provider_intent_id',
        'pay.client_secret',
        'pay.idempotency_key',
        'pay.amount_fils',
      ])
      .where('o.id', '=', orderId)
      .executeTakeFirstOrThrow();
    let intentId = row.provider_intent_id;
    let secret = row.client_secret;
    if (!intentId && row.status === 'pending_payment') {
      try {
        const intent = await this.provider.createIntent({
          amountFils: row.amount_fils,
          currency: 'AED',
          idempotencyKey: row.idempotency_key,
          metadata: { orderId },
        });
        await this.db
          .updateTable('payments')
          .set({ provider_intent_id: intent.intentId, client_secret: intent.clientSecret })
          .where('id', '=', row.payment_id)
          .where('provider_intent_id', 'is', null)
          .execute();
        intentId = intent.intentId;
        secret = intent.clientSecret;
      } catch (error) {
        this.log.warn({ err: error, orderId }, 'payment intent creation failed');
        throw new ApiError(
          HttpStatus.SERVICE_UNAVAILABLE,
          'PAYMENT_PROVIDER_UNAVAILABLE',
          'Payment is unavailable right now. Your items are held; try again in a moment.',
        );
      }
    }
    const open = row.status === 'pending_payment';
    return {
      orderId: row.id,
      status: row.status,
      totalFils: row.total_fils,
      currency: 'AED',
      paymentExpiresAt: row.payment_expires_at.toISOString(),
      paymentClientSecret: open ? secret : null,
      paymentIntentId: open ? intentId : null,
    };
  }
}
