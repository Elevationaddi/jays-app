import {
  bookingPriceParts,
  allocateRefund,
  commissionFor,
  commissionVatFor,
  feeRuleFor,
  type FeeRule,
  type FinanceMode,
  type FinanceSettingKey,
  type LedgerLine,
  postings,
  settingAt,
} from '@jays/domain';
import type {
  CommissionDetailLine,
  Database,
  Db,
  LedgerKind,
  LedgerSourceType,
  TaxDocumentLine,
} from '@jays/db';
import { sql, type Transaction } from 'kysely';

type Localized = { en: string; ar: string };
import { issueCaptureDocuments, issueCreditNotes } from './tax-documents.js';

/**
 * Ledger and earnings helpers shared by payments, refunds, disputes and payouts (ADR-0015).
 * Every function runs inside the caller's transaction. Postings are idempotent per
 * (kind, source): a replayed webhook or a retried job never posts twice (T06).
 */
export type Trx = Transaction<Database>;
type Conn = Db | Trx;

/** Posts one balanced ledger transaction. Returns false if it was already posted. */
export async function post(
  trx: Trx,
  tx: {
    kind: LedgerKind;
    sourceType: LedgerSourceType;
    sourceId: string;
    businessId: string | null;
    occurredAt: Date;
    memo?: string;
  },
  lines: LedgerLine[],
): Promise<boolean> {
  const row = await trx
    .insertInto('ledger_transactions')
    .values({
      kind: tx.kind,
      source_type: tx.sourceType,
      source_id: tx.sourceId,
      business_id: tx.businessId,
      memo: tx.memo ?? null,
      occurred_at: tx.occurredAt,
    })
    .onConflict((oc) => oc.columns(['kind', 'source_type', 'source_id']).doNothing())
    .returning('id')
    .executeTakeFirst();
  if (!row) return false;
  await trx
    .insertInto('ledger_entries')
    .values(
      lines.map((l) => ({
        transaction_id: row.id,
        account: l.account,
        business_id: l.businessId,
        debit_fils: l.debitFils,
        credit_fils: l.creditFils,
      })),
    )
    .execute();
  return true;
}

/** Balance a business is owed (credits minus debits on merchant_payable). Can be negative. */
export async function payableBalance(db: Conn, businessId: string): Promise<number> {
  const row = await db
    .selectFrom('ledger_entries')
    .select(sql<string>`coalesce(sum(credit_fils - debit_fils), 0)`.as('balance'))
    .where('account', '=', 'merchant_payable')
    .where('business_id', '=', businessId)
    .executeTakeFirstOrThrow();
  return Number(row.balance);
}

export async function feeRules(
  db: Conn,
  mode: FinanceMode,
  businessId: string,
  at: Date,
  categoryPath: readonly string[] = [],
) {
  const rows = await db
    .selectFrom('fee_rules')
    .select(['id', 'mode', 'business_id', 'category_id', 'commission_bps', 'effective_at'])
    .where('mode', '=', mode)
    .where((eb) => eb.or([eb('business_id', 'is', null), eb('business_id', '=', businessId)]))
    .where((eb) =>
      categoryPath.length > 0
        ? eb.or([eb('category_id', 'is', null), eb('category_id', 'in', [...categoryPath])])
        : eb('category_id', 'is', null),
    )
    .where('effective_at', '<=', at)
    .execute();
  const rules: FeeRule[] = rows.map((r) => ({
    id: r.id,
    mode: r.mode,
    businessId: r.business_id,
    categoryId: r.category_id,
    commissionBps: r.commission_bps,
    effectiveAt: r.effective_at,
  }));
  return feeRuleFor(rules, mode, businessId, at, categoryPath);
}

/** A category and its ancestors, nearest first (the tree is at most three levels deep). */
export async function categoryPath(db: Conn, categoryId: string | null): Promise<string[]> {
  if (!categoryId) return [];
  const { rows } = await sql<{ id: string }>`
    WITH RECURSIVE up AS (
      SELECT id, parent_id, 0 AS depth FROM categories WHERE id = ${categoryId}
      UNION ALL
      SELECT c.id, c.parent_id, up.depth + 1 FROM categories c JOIN up ON c.id = up.parent_id
    )
    SELECT id FROM up ORDER BY depth`.execute(db);
  return rows.map((r) => r.id);
}

export async function setting(db: Conn, key: FinanceSettingKey, at: Date): Promise<number> {
  const rows = await db
    .selectFrom('finance_settings')
    .select(['key', 'value', 'effective_at'])
    .where('key', '=', key)
    .where('effective_at', '<=', at)
    .execute();
  return settingAt(
    rows.map((r) => ({ key: r.key, value: r.value, effectiveAt: r.effective_at })),
    key,
    at,
  );
}

/** One commissionable line: its amount before VAT and the category it sold in. */
interface CommissionLine {
  ref: string;
  categoryId: string | null;
  baseFils: number;
}

/**
 * Records what a merchant earned from a captured payment, posts the capture and issues the
 * invoices. Commission (D2) is worked out per line on the amount before VAT, never on delivery,
 * using the most specific rule in force at capture; the result is copied onto the earning (T13:
 * later rule changes never touch it). VAT on commission (D4) applies only once the platform is
 * registered. Idempotent: one earning per suborder or booking.
 */
async function recordEarning(
  trx: Trx,
  input: {
    businessId: string;
    mode: FinanceMode;
    paymentId: string;
    grossFils: number;
    /** Travel or delivery charge (VAT included): no commission, none returned on its refund. */
    nonCommissionableFils?: number;
    lines: CommissionLine[];
    source: { merchantOrderId: string } | { bookingId: string };
    documents: {
      customerUserId: string | null;
      lines: TaxDocumentLine[];
      vatFils: number;
      reference: string;
    };
  },
  now: Date,
) {
  const detail: CommissionDetailLine[] = [];
  for (const line of input.lines) {
    const path = await categoryPath(trx, line.categoryId);
    const rule = await feeRules(trx, input.mode, input.businessId, now, path);
    const bps = rule?.commissionBps ?? 0;
    detail.push({
      ref: line.ref,
      categoryId: line.categoryId,
      feeRuleId: rule?.id ?? null,
      commissionBps: bps,
      baseFils: line.baseFils,
      commissionFils: commissionFor(line.baseFils, bps),
    });
  }
  const base = detail.reduce((t, d) => t + d.baseFils, 0);
  const commission = detail.reduce((t, d) => t + d.commissionFils, 0);
  const ruleIds = [...new Set(detail.map((d) => d.feeRuleId))];
  const registered = (await setting(trx, 'platform_vat_registered', now)) === 1;
  const vatBps = registered ? await setting(trx, 'commission_vat_bps', now) : 0;
  const vat = commissionVatFor(commission, vatBps, registered);
  const earning = await trx
    .insertInto('merchant_earnings')
    .values({
      business_id: input.businessId,
      source_type: 'merchantOrderId' in input.source ? 'merchant_order' : 'booking',
      merchant_order_id: 'merchantOrderId' in input.source ? input.source.merchantOrderId : null,
      booking_id: 'bookingId' in input.source ? input.source.bookingId : null,
      payment_id: input.paymentId,
      mode: input.mode,
      gross_fils: input.grossFils,
      non_commissionable_fils: input.nonCommissionableFils ?? 0,
      commission_base_fils: base,
      // One rule: its rate. Several: the blended rate, with each line in commission_detail.
      commission_bps:
        ruleIds.length === 1 ? (detail[0]?.commissionBps ?? 0) : blendedBps(commission, base),
      fee_rule_id: ruleIds.length === 1 ? (ruleIds[0] ?? null) : null,
      commission_fils: commission,
      commission_vat_bps: vatBps,
      commission_vat_fils: vat,
      commission_detail: JSON.stringify(detail),
    })
    .onConflict((oc) => oc.doNothing())
    .returning('id')
    .executeTakeFirst();
  if (!earning) return;
  await post(
    trx,
    {
      kind: 'capture',
      sourceType: 'merchant_earning',
      sourceId: earning.id,
      businessId: input.businessId,
      occurredAt: now,
    },
    postings.capture(input.businessId, input.grossFils, commission, vat),
  );
  await issueCaptureDocuments(trx, {
    earningId: earning.id,
    businessId: input.businessId,
    customerUserId: input.documents.customerUserId,
    lines: input.documents.lines,
    totalFils: input.grossFils,
    vatFils: input.documents.vatFils,
    commissionFils: commission,
    commissionVatFils: vat,
    commissionVatBps: vatBps,
    platformRegistered: registered,
    reference: input.documents.reference,
    at: now,
  });
}

function blendedBps(commission: number, base: number) {
  return base > 0 ? Math.min(10_000, Math.round((commission * 10_000) / base)) : 0;
}

/**
 * A paid order: one earning per seller. Commission is on goods before VAT; delivery goes to the
 * seller with no commission (D2).
 */
export async function recordOrderCapture(trx: Trx, orderId: string, paymentId: string, now: Date) {
  const order = await trx
    .selectFrom('orders')
    .select(['user_id'])
    .where('id', '=', orderId)
    .executeTakeFirstOrThrow();
  const suborders = await trx
    .selectFrom('merchant_orders')
    .select(['id', 'business_id', 'delivery_fils', 'tax_fils', 'total_fils', 'delivery_snapshot'])
    .where('order_id', '=', orderId)
    .orderBy('id')
    .execute();
  for (const mo of suborders) {
    const items = await trx
      .selectFrom('order_items as i')
      .innerJoin('products as p', 'p.id', 'i.product_id')
      .select([
        'i.id',
        'i.qty',
        'i.line_total_fils',
        'i.discount_fils',
        'i.tax_rate_bps',
        'i.tax_fils',
        'i.snapshot',
        'p.live_category_id',
      ])
      .where('i.merchant_order_id', '=', mo.id)
      .orderBy('i.id')
      .execute();
    const deliveryTax = Number(
      (mo.delivery_snapshot as { deliveryTaxFils?: number }).deliveryTaxFils ?? 0,
    );
    const docLines: TaxDocumentLine[] = items.map((i) => {
      const snap = i.snapshot as { title: Localized; variantName?: Localized };
      return {
        description: snap.variantName
          ? {
              en: `${snap.title.en} (${snap.variantName.en})`,
              ar: `${snap.title.ar} (${snap.variantName.ar})`,
            }
          : snap.title,
        qty: i.qty,
        totalFils: i.line_total_fils - i.discount_fils,
        vatRateBps: i.tax_rate_bps,
        vatFils: i.tax_fils,
      };
    });
    if (mo.delivery_fils > 0) {
      docLines.push({
        description: { en: 'Delivery', ar: 'التوصيل' },
        qty: 1,
        totalFils: mo.delivery_fils,
        vatRateBps:
          deliveryTax > 0
            ? Math.round((deliveryTax * 10_000) / (mo.delivery_fils - deliveryTax))
            : 0,
        vatFils: deliveryTax,
      });
    }
    await recordEarning(
      trx,
      {
        businessId: mo.business_id,
        mode: 'shop',
        paymentId,
        grossFils: mo.total_fils,
        nonCommissionableFils: mo.delivery_fils,
        lines: items.map((i) => ({
          ref: i.id,
          categoryId: i.live_category_id,
          baseFils: Math.max(0, i.line_total_fils - i.discount_fils - i.tax_fils),
        })),
        source: { merchantOrderId: mo.id },
        documents: {
          customerUserId: order.user_id,
          lines: docLines,
          vatFils: mo.tax_fils,
          reference: `order ${mo.id.slice(0, 8).toUpperCase()}`,
        },
      },
      now,
    );
  }
}

export async function recordBookingCapture(
  trx: Trx,
  booking: { id: string; businessId: string; priceFils: number },
  paymentId: string,
  now: Date,
) {
  const b = await trx
    .selectFrom('bookings as b')
    .innerJoin('services as s', 's.id', 'b.service_id')
    .select([
      'b.user_id',
      'b.tax_fils',
      'b.snapshot',
      'b.travel_fee_fils',
      'b.addons',
      'b.addons_fils',
      's.category_id',
      's.tax_class',
    ])
    .where('b.id', '=', booking.id)
    .executeTakeFirstOrThrow();
  const snap = b.snapshot as { service: { title: Localized } };
  const rate =
    b.tax_fils > 0 ? Math.round((b.tax_fils * 10_000) / (booking.priceFils - b.tax_fils)) : 0;
  // The service, each add-on and a home visit's travel fee are separate lines; the VAT splits in
  // proportion (phase 8.7, bookingPriceParts).
  const parts = bookingPriceParts({
    priceFils: booking.priceFils,
    taxFils: b.tax_fils,
    addonsFils: b.addons_fils,
    travelFeeFils: b.travel_fee_fils,
  });
  const travel = parts.travelFeeFils;
  const travelVat = parts.travelVatFils;
  const addonVats = b.addons.map((x) =>
    b.addons_fils > 0 ? Math.floor((parts.addonsVatFils * x.priceFils) / b.addons_fils) : 0,
  );
  if (addonVats.length > 0) {
    addonVats[0]! += parts.addonsVatFils - addonVats.reduce((sum, v) => sum + v, 0);
  }
  const documentLines = [
    {
      description: snap.service.title,
      qty: 1,
      totalFils: parts.serviceFils,
      vatRateBps: rate,
      vatFils: parts.serviceVatFils,
    },
    ...b.addons.map((x, i) => ({
      description: x.title,
      qty: 1,
      totalFils: x.priceFils,
      vatRateBps: rate,
      vatFils: addonVats[i]!,
    })),
    ...(travel > 0
      ? [
          {
            description: { en: 'Travel fee', ar: 'رسوم الانتقال' },
            qty: 1,
            totalFils: travel,
            vatRateBps: rate,
            vatFils: travelVat,
          },
        ]
      : []),
  ];
  await recordEarning(
    trx,
    {
      businessId: booking.businessId,
      mode: 'services',
      paymentId,
      grossFils: booking.priceFils,
      nonCommissionableFils: travel,
      lines: [
        {
          ref: booking.id,
          categoryId: b.category_id,
          // Commission applies to the service and its add-ons: a separately itemised travel fee
          // is the merchant's in full (founder decision, 2026-11-28; ADR-0025).
          baseFils: Math.max(0, booking.priceFils - travel - (b.tax_fils - travelVat)),
        },
      ],
      source: { bookingId: booking.id },
      documents: {
        customerUserId: b.user_id,
        lines: documentLines,
        vatFils: b.tax_fils,
        reference: `appointment ${booking.id.slice(0, 8).toUpperCase()}`,
      },
    },
    now,
  );
}

/** The earning a refund comes out of, locked. Bookings have one; orders name the suborder. */
export async function earningForRefund(
  trx: Trx,
  target: { bookingId: string | null; merchantOrderId: string | null },
) {
  let q = trx
    .selectFrom('merchant_earnings')
    .select([
      'id',
      'business_id',
      'gross_fils',
      'commission_fils',
      'refunded_fils',
      'commission_refunded_fils',
      'commission_vat_fils',
      'commission_vat_refunded_fils',
      'non_commissionable_fils',
      'non_commissionable_refunded_fils',
      'status',
    ])
    .forUpdate();
  if (target.bookingId) q = q.where('booking_id', '=', target.bookingId);
  else if (target.merchantOrderId) q = q.where('merchant_order_id', '=', target.merchantOrderId);
  else return undefined;
  return q.executeTakeFirst();
}

/**
 * Takes a refund (or lost dispute) out of an earning: the merchant's share and the commission
 * share in proportion, posted once per source.
 */
export async function reverseEarning(
  trx: Trx,
  earning: NonNullable<Awaited<ReturnType<typeof earningForRefund>>>,
  amountFils: number,
  source: { kind: 'refund' | 'chargeback'; type: 'refund' | 'dispute'; id: string },
  now: Date,
  /** The travel or delivery part of the refund, which returns no commission (ADR-0027). */
  nonCommissionableFils: number | null = null,
) {
  const split = allocateRefund(
    {
      grossFils: earning.gross_fils,
      commissionFils: earning.commission_fils,
      refundedFils: earning.refunded_fils,
      commissionRefundedFils: earning.commission_refunded_fils,
      commissionVatFils: earning.commission_vat_fils,
      commissionVatRefundedFils: earning.commission_vat_refunded_fils,
      nonCommissionableFils: earning.non_commissionable_fils,
      nonCommissionableRefundedFils: earning.non_commissionable_refunded_fils,
    },
    amountFils,
    { nonCommissionableFils },
  );
  const posted = await post(
    trx,
    {
      kind: source.kind,
      sourceType: source.type,
      sourceId: source.id,
      businessId: earning.business_id,
      occurredAt: now,
    },
    postings.reversal(earning.business_id, split),
  );
  if (!posted) return;
  await trx
    .updateTable('merchant_earnings')
    .set({
      refunded_fils: earning.refunded_fils + amountFils,
      commission_refunded_fils: earning.commission_refunded_fils + split.commissionFils,
      commission_vat_refunded_fils: earning.commission_vat_refunded_fils + split.vatFils,
      non_commissionable_refunded_fils:
        earning.non_commissionable_refunded_fils + split.nonCommissionableFils,
    })
    .where('id', '=', earning.id)
    .execute();
  await issueCreditNotes(trx, {
    earningId: earning.id,
    businessId: earning.business_id,
    source: { type: source.type, id: source.id },
    amountFils,
    commissionFils: split.commissionFils,
    commissionVatFils: split.vatFils,
    at: now,
  });
}
