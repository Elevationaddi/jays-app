import {
  allocateRefund,
  commissionFor,
  feeRuleFor,
  type FeeRule,
  type FinanceMode,
  type FinanceSettingKey,
  type LedgerLine,
  postings,
  settingAt,
} from '@jays/domain';
import type { Database, Db, LedgerKind, LedgerSourceType } from '@jays/db';
import { sql, type Transaction } from 'kysely';

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

export async function feeRules(db: Conn, mode: FinanceMode, businessId: string, at: Date) {
  const rows = await db
    .selectFrom('fee_rules')
    .select(['id', 'mode', 'business_id', 'commission_bps', 'effective_at'])
    .where('mode', '=', mode)
    .where((eb) => eb.or([eb('business_id', 'is', null), eb('business_id', '=', businessId)]))
    .where('effective_at', '<=', at)
    .execute();
  const rules: FeeRule[] = rows.map((r) => ({
    id: r.id,
    mode: r.mode,
    businessId: r.business_id,
    commissionBps: r.commission_bps,
    effectiveAt: r.effective_at,
  }));
  return feeRuleFor(rules, mode, businessId, at);
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

/**
 * Records what a merchant earned from a captured payment and posts the capture. Commission uses
 * the rule in force at capture time and is copied onto the earning (T13: later rule changes
 * never touch it). Idempotent: one earning per suborder or booking.
 */
async function recordEarning(
  trx: Trx,
  input: {
    businessId: string;
    mode: FinanceMode;
    paymentId: string;
    grossFils: number;
    commissionBaseFils: number;
    source: { merchantOrderId: string } | { bookingId: string };
  },
  now: Date,
) {
  const rule = await feeRules(trx, input.mode, input.businessId, now);
  const bps = rule?.commissionBps ?? 0;
  const commission = commissionFor(input.commissionBaseFils, bps);
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
      commission_base_fils: input.commissionBaseFils,
      commission_bps: bps,
      fee_rule_id: rule?.id ?? null,
      commission_fils: commission,
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
    postings.capture(input.businessId, input.grossFils, commission),
  );
}

/** A paid order: one earning per seller. Commission is on goods only; delivery goes to the seller. */
export async function recordOrderCapture(trx: Trx, orderId: string, paymentId: string, now: Date) {
  const suborders = await trx
    .selectFrom('merchant_orders')
    .select(['id', 'business_id', 'subtotal_fils', 'discount_fils', 'total_fils'])
    .where('order_id', '=', orderId)
    .orderBy('id')
    .execute();
  for (const mo of suborders) {
    await recordEarning(
      trx,
      {
        businessId: mo.business_id,
        mode: 'shop',
        paymentId,
        grossFils: mo.total_fils,
        commissionBaseFils: Math.max(0, mo.subtotal_fils - mo.discount_fils),
        source: { merchantOrderId: mo.id },
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
  await recordEarning(
    trx,
    {
      businessId: booking.businessId,
      mode: 'services',
      paymentId,
      grossFils: booking.priceFils,
      commissionBaseFils: booking.priceFils,
      source: { bookingId: booking.id },
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
) {
  const split = allocateRefund(
    {
      grossFils: earning.gross_fils,
      commissionFils: earning.commission_fils,
      refundedFils: earning.refunded_fils,
      commissionRefundedFils: earning.commission_refunded_fils,
    },
    amountFils,
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
    })
    .where('id', '=', earning.id)
    .execute();
}
