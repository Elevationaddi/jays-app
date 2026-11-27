import type { EarningView, PayoutView } from '@jays/contracts';
import { netOf } from '@jays/domain';
import type { Database, Db } from '@jays/db';
import { type ExpressionBuilder, sql, type Transaction } from 'kysely';

type Conn = Db | Transaction<Database>;
export type Localized = { en: string; ar: string };

export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Public name of a business: its live storefront name, else the name it registered with. */
export function businessName(live: Localized | null | undefined, display: Localized): Localized {
  return live ?? display;
}

/** Selects `{business_id}`'s display name columns; join `businesses as b` and `storefronts as sf`. */
export const nameColumns = ['b.display_name', 'sf.live_name'] as const;

export async function adminNames(db: Conn, ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((v): v is string => !!v))];
  if (unique.length === 0) return new Map<string, string>();
  const rows = await db
    .selectFrom('admin_accounts')
    .select(['id', 'display_name'])
    .where('id', 'in', unique)
    .execute();
  return new Map(rows.map((r) => [r.id, r.display_name]));
}

export const actorOf = (names: Map<string, string>, id: string | null | undefined) =>
  id ? { id, name: names.get(id) ?? '' } : null;

/** Net still owed on earnings, as SQL. */
export const netSql = sql<string>`coalesce(sum(e.gross_fils - e.commission_fils - (e.refunded_fils - e.commission_refunded_fils)), 0)`;

export const EARNING_COLUMNS = [
  'e.id',
  'e.business_id',
  'e.source_type',
  'e.merchant_order_id',
  'e.booking_id',
  'e.mode',
  'e.gross_fils',
  'e.commission_bps',
  'e.commission_fils',
  'e.refunded_fils',
  'e.commission_refunded_fils',
  'e.status',
  'e.eligible_at',
  'e.payout_id',
  'e.created_at',
  'mo.order_id',
] as const;

export const openDisputeExists = (
  eb: ExpressionBuilder<Database & { e: Database['merchant_earnings'] }, 'e'>,
) =>
  eb.exists(
    eb
      .selectFrom('disputes as d')
      .select('d.id')
      .whereRef('d.earning_id', '=', 'e.id')
      .where('d.status', '=', 'open'),
  );

export interface EarningRow {
  id: string;
  business_id: string;
  source_type: 'merchant_order' | 'booking';
  merchant_order_id: string | null;
  booking_id: string | null;
  mode: 'shop' | 'services';
  gross_fils: number;
  commission_bps: number;
  commission_fils: number;
  refunded_fils: number;
  commission_refunded_fils: number;
  status: 'pending' | 'eligible' | 'in_payout' | 'paid_out';
  eligible_at: Date | null;
  payout_id: string | null;
  created_at: Date;
  order_id: string | null;
  disputed: boolean;
}

export function earningView(r: EarningRow): EarningView {
  return {
    id: r.id,
    sourceType: r.source_type,
    merchantOrderId: r.merchant_order_id,
    orderId: r.order_id,
    bookingId: r.booking_id,
    mode: r.mode,
    grossFils: r.gross_fils,
    commissionBps: r.commission_bps,
    commissionFils: r.commission_fils,
    refundedFils: r.refunded_fils,
    netFils: netOf({
      grossFils: r.gross_fils,
      commissionFils: r.commission_fils,
      refundedFils: r.refunded_fils,
      commissionRefundedFils: r.commission_refunded_fils,
    }),
    status: r.status,
    eligibleAt: iso(r.eligible_at),
    payoutId: r.payout_id,
    disputed: r.disputed,
    createdAt: r.created_at.toISOString(),
  };
}

export interface PayoutRow {
  id: string;
  business_id: string;
  display_name: Localized;
  live_name: Localized | null;
  amount_fils: number;
  status: 'pending' | 'paid' | 'failed';
  provider_ref: string | null;
  failure_code: string | null;
  needs_attention: boolean;
  earning_count: string | number | null;
  created_at: Date;
  paid_at: Date | null;
  failed_at: Date | null;
}

export function payoutView(r: PayoutRow): PayoutView {
  return {
    id: r.id,
    business: { id: r.business_id, name: businessName(r.live_name, r.display_name) },
    amountFils: r.amount_fils,
    currency: 'AED',
    status: r.status,
    providerRef: r.provider_ref,
    failureCode: r.failure_code,
    needsAttention: r.needs_attention,
    earningCount: Number(r.earning_count),
    createdAt: r.created_at.toISOString(),
    paidAt: iso(r.paid_at),
    failedAt: iso(r.failed_at),
  };
}

/** Payouts with business names and how many earnings each settled. */
export function payoutQuery(db: Conn) {
  return db
    .selectFrom('payouts as p')
    .innerJoin('businesses as b', 'b.id', 'p.business_id')
    .leftJoin('storefronts as sf', 'sf.business_id', 'b.id')
    .select((eb) => [
      'p.id',
      'p.business_id',
      'b.display_name',
      'sf.live_name',
      'p.amount_fils',
      'p.status',
      'p.provider_ref',
      'p.failure_code',
      'p.needs_attention',
      'p.created_at',
      'p.paid_at',
      'p.failed_at',
      eb
        .selectFrom('merchant_earnings as me')
        .select((e) => e.fn.countAll<string>().as('n'))
        .whereRef('me.payout_id', '=', 'p.id')
        .as('earning_count'),
    ]);
}
