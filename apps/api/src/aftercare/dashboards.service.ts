import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AdminDashboard, BusinessDashboard, DashboardRange } from '@jays/contracts';
import type { Db } from '@jays/db';
import { sql } from 'kysely';
import { CLOCK, type Clock } from '../common/clock.js';
import { ApiError } from '../common/error.filter.js';
import { DB } from '../common/tokens.js';

type Localized = { en: string; ar: string };

const DAY_MS = 86_400_000;
const DUBAI_OFFSET_MS = 4 * 3_600_000; // UTC+4, no daylight saving.

export const dubaiDate = (d: Date) =>
  new Date(d.getTime() + DUBAI_OFFSET_MS).toISOString().slice(0, 10);

/** Inclusive local (Asia/Dubai) dates to a half-open UTC range. At most 366 days. */
export function resolveRange(range: { from?: string; to?: string }, now: Date) {
  const to = range.to ?? dubaiDate(now);
  const from = range.from ?? dubaiDate(new Date(Date.parse(`${to}T00:00:00Z`) - 29 * DAY_MS));
  const start = new Date(Date.parse(`${from}T00:00:00Z`) - DUBAI_OFFSET_MS);
  const end = new Date(Date.parse(`${to}T00:00:00Z`) - DUBAI_OFFSET_MS + DAY_MS);
  const days = Math.round((end.getTime() - start.getTime()) / DAY_MS);
  if (Number.isNaN(days) || days < 1 || days > 366) {
    throw new ApiError(
      HttpStatus.BAD_REQUEST,
      'VALIDATION_FAILED',
      'Pick a range of 1 to 366 days, with the start before the end.',
      { from: ['must be on or before to, at most 366 days apart'] },
    );
  }
  const dates = Array.from({ length: days }, (_, i) =>
    new Date(Date.parse(`${from}T00:00:00Z`) + i * DAY_MS).toISOString().slice(0, 10),
  );
  return { from, to, start, end, dates };
}

const local = (column: string) =>
  sql<string>`to_char(${sql.ref(column)} AT TIME ZONE 'Asia/Dubai', 'YYYY-MM-DD')`;
const num = (v: unknown) => Number(v ?? 0);

/**
 * Dashboards (docs/03-business.md and docs/04-admin.md; metric definitions in ADR-0016). All
 * figures come from the operational and finance tables at query time; nothing is cached, so a
 * figure is never staler than the data behind it.
 */
@Injectable()
export class DashboardsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async business(businessId: string, query: DashboardRange): Promise<BusinessDashboard> {
    const r = resolveRange(query, this.clock.now());
    const modes = await this.db
      .selectFrom('business_modes')
      .select('mode')
      .where('business_id', '=', businessId)
      .where('status', '=', 'active')
      .execute();
    const has = (m: string) => modes.some((x) => x.mode === m);
    const [shop, services] = await Promise.all([
      has('shop') ? this.shop(businessId, r) : null,
      has('services') ? this.services(businessId, query.branchId, r) : null,
    ]);
    return { from: r.from, to: r.to, shop, services };
  }

  /**
   * Gross sales: suborder totals (items, delivery, VAT, after discounts) of orders paid in the
   * range. Refunds: refunds the provider confirmed in the range for this business's suborders.
   * Net: gross minus refunds. Status counts are the current status of the suborders paid in range.
   */
  private async shop(businessId: string, r: ReturnType<typeof resolveRange>) {
    const paid = this.db
      .selectFrom('merchant_orders as mo')
      .innerJoin('orders as o', 'o.id', 'mo.order_id')
      .where('mo.business_id', '=', businessId)
      .where('o.paid_at', '>=', r.start)
      .where('o.paid_at', '<', r.end);
    const [byStatus, daily, refunds, openReturns, lowStock] = await Promise.all([
      paid
        .select([
          'mo.status',
          (eb) => eb.fn.countAll<string>().as('n'),
          (eb) => eb.fn.sum<string>('mo.total_fils').as('fils'),
        ])
        .groupBy('mo.status')
        .execute(),
      paid
        .select([
          local('o.paid_at').as('day'),
          (eb) => eb.fn.sum<string>('mo.total_fils').as('fils'),
        ])
        .groupBy('day')
        .execute(),
      this.db
        .selectFrom('refunds as rf')
        .innerJoin('merchant_orders as mo', 'mo.id', 'rf.merchant_order_id')
        .select((eb) => eb.fn.sum<string>('rf.amount_fils').as('fils'))
        .where('mo.business_id', '=', businessId)
        .where('rf.status', '=', 'succeeded')
        .where('rf.updated_at', '>=', r.start)
        .where('rf.updated_at', '<', r.end)
        .executeTakeFirstOrThrow(),
      this.db
        .selectFrom('return_requests')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('business_id', '=', businessId)
        .where('status', 'in', ['requested', 'approved', 'received', 'refund_pending'])
        .executeTakeFirstOrThrow(),
      this.db
        .selectFrom('variants as v')
        .innerJoin('products as p', 'p.id', 'v.product_id')
        .select([
          'v.id',
          'v.sku',
          'p.title',
          sql<number>`v.stock_on_hand - v.stock_reserved`.as('available'),
        ])
        .where('v.business_id', '=', businessId)
        .where('v.status', '=', 'active')
        .where('p.status', '<>', 'archived')
        .where(sql<boolean>`v.stock_on_hand - v.stock_reserved <= v.low_stock_threshold`)
        .orderBy('available')
        .orderBy('v.sku')
        .limit(20)
        .execute(),
    ]);
    const count = (s: string) => num(byStatus.find((b) => b.status === s)?.n);
    const gross = byStatus.reduce((t, b) => t + num(b.fils), 0);
    const refundsFils = num(refunds.fils);
    const perDay = new Map(daily.map((d) => [d.day, num(d.fils)]));
    return {
      grossSalesFils: gross,
      netSalesFils: gross - refundsFils,
      refundsFils,
      orders: {
        paid: count('paid'),
        processing: count('processing'),
        shipped: count('shipped'),
        delivered: count('delivered'),
        canceled: count('canceled'),
      },
      openReturns: num(openReturns.n),
      lowStock: lowStock.map((v) => ({
        variantId: v.id,
        title: v.title as unknown as Localized,
        sku: v.sku,
        available: num(v.available),
      })),
      daily: r.dates.map((date) => ({ date, value: perDay.get(date) ?? 0 })),
    };
  }

  /**
   * Bookings whose appointment falls in the range (held and expired holds excluded). Revenue: the
   * price of completed appointments. Occupancy: minutes booked (confirmed, checked in, completed
   * or no-show) over minutes of staff shifts on those dates; null when no shifts are scheduled.
   */
  private async services(
    businessId: string,
    branchId: string | undefined,
    r: ReturnType<typeof resolveRange>,
  ) {
    let q = this.db
      .selectFrom('bookings as b')
      .where('b.business_id', '=', businessId)
      .where('b.start_at', '>=', r.start)
      .where('b.start_at', '<', r.end)
      .where('b.status', 'not in', ['held', 'expired']);
    if (branchId) q = q.where('b.branch_id', '=', branchId);
    const [byStatus, daily, booked, scheduled] = await Promise.all([
      q
        .select([
          'b.status',
          (eb) => eb.fn.countAll<string>().as('n'),
          (eb) => eb.fn.sum<string>('b.price_fils').as('fils'),
        ])
        .groupBy('b.status')
        .execute(),
      q
        .select([
          local('b.start_at').as('day'),
          (eb) => eb.fn.sum<string>('b.price_fils').as('fils'),
        ])
        .where('b.status', '=', 'completed')
        .groupBy('day')
        .execute(),
      q
        .select(
          sql<string>`coalesce(sum(extract(epoch from (b.occupied_end - b.occupied_start)) / 60), 0)`.as(
            'minutes',
          ),
        )
        .where('b.status', 'in', ['confirmed', 'checked_in', 'completed', 'no_show'])
        .executeTakeFirstOrThrow(),
      sql<{ minutes: string | null }>`
        SELECT sum(extract(epoch from (s.ends_at::time - s.starts_at::time)) / 60) AS minutes
        FROM shifts s
        JOIN generate_series(${r.from}::date, ${r.to}::date, interval '1 day') AS d(day)
          ON extract(dow from d.day) = s.weekday
        WHERE s.business_id = ${businessId}
          ${branchId ? sql`AND s.branch_id = ${branchId}` : sql``}
      `.execute(this.db),
    ]);
    const count = (...s: string[]) =>
      byStatus.filter((b) => s.includes(b.status)).reduce((t, b) => t + num(b.n), 0);
    const perDay = new Map(daily.map((d) => [d.day, num(d.fils)]));
    const scheduledMinutes = num(scheduled.rows[0]?.minutes);
    return {
      bookings: count('confirmed', 'checked_in', 'completed', 'canceled', 'no_show'),
      completed: count('completed'),
      canceled: count('canceled'),
      noShows: count('no_show'),
      revenueFils: num(byStatus.find((b) => b.status === 'completed')?.fils),
      occupancy:
        scheduledMinutes > 0
          ? Math.round(Math.min(1, num(booked.minutes) / scheduledMinutes) * 1000) / 1000
          : null,
      daily: r.dates.map((date) => ({ date, value: perDay.get(date) ?? 0 })),
    };
  }

  async admin(query: DashboardRange): Promise<AdminDashboard> {
    const now = this.clock.now();
    const r = resolveRange(query, now);
    const inRange = <T extends string>(column: T) =>
      sql<boolean>`${sql.ref(column)} >= ${r.start} AND ${sql.ref(column)} < ${r.end}`;
    const [payments, daily, refunds, commission, counts, open] = await Promise.all([
      this.db
        .selectFrom('payments')
        .select(['target_type', (eb) => eb.fn.sum<string>('amount_fils').as('fils')])
        .where('succeeded_at', 'is not', null)
        .where(inRange('succeeded_at'))
        .groupBy('target_type')
        .execute(),
      this.db
        .selectFrom('payments')
        .select([
          'target_type',
          local('succeeded_at').as('day'),
          (eb) => eb.fn.sum<string>('amount_fils').as('fils'),
        ])
        .where('succeeded_at', 'is not', null)
        .where(inRange('succeeded_at'))
        .groupBy(['target_type', 'day'])
        .execute(),
      this.db
        .selectFrom('refunds')
        .select((eb) => eb.fn.sum<string>('amount_fils').as('fils'))
        .where('status', '=', 'succeeded')
        .where(inRange('updated_at'))
        .executeTakeFirstOrThrow(),
      this.db
        .selectFrom('merchant_earnings')
        .select(
          sql<string>`coalesce(sum(commission_fils - commission_refunded_fils), 0)`.as('fils'),
        )
        .where(inRange('created_at'))
        .executeTakeFirstOrThrow(),
      sql<Record<string, string>>`
        SELECT
          (SELECT count(*) FROM orders WHERE paid_at >= ${r.start} AND paid_at < ${r.end}) AS orders,
          (SELECT count(*) FROM bookings WHERE created_at >= ${r.start} AND created_at < ${r.end}
             AND status NOT IN ('held', 'expired')) AS bookings,
          (SELECT count(DISTINCT business_id) FROM merchant_earnings
             WHERE created_at >= ${r.start} AND created_at < ${r.end}) AS active_merchants,
          (SELECT count(*) FROM users WHERE created_at >= ${r.start} AND created_at < ${r.end}) AS new_customers
      `.execute(this.db),
      sql<Record<string, string>>`
        SELECT
          (SELECT count(*) FROM businesses WHERE status IN ('submitted', 'under_review')) AS pending_verification,
          (SELECT count(*) FROM disputes WHERE status = 'open') AS open_disputes,
          (SELECT count(*) FROM payouts WHERE status = 'failed' OR needs_attention) AS payout_exceptions,
          (SELECT count(*) FROM support_tickets WHERE status <> 'resolved') AS open_tickets,
          (SELECT count(*) FROM support_tickets WHERE status IN ('open', 'assigned', 'reopened')
             AND sla_due_at < ${now}) AS overdue_tickets,
          (SELECT count(*) FROM review_reports WHERE resolved_at IS NULL) AS reported_reviews,
          (SELECT count(*) FROM outbox WHERE status = 'failed') AS failed_notifications
      `.execute(this.db),
    ]);
    const c = counts.rows[0] ?? {};
    const o = open.rows[0] ?? {};
    const gmv = (t: string) => num(payments.find((p) => p.target_type === t)?.fils);
    const day = (t: string, d: string) =>
      num(daily.find((x) => x.target_type === t && x.day === d)?.fils);
    return {
      from: r.from,
      to: r.to,
      gmvFils: { shop: gmv('order'), services: gmv('booking') },
      refundsFils: num(refunds.fils),
      commissionFils: num(commission.fils),
      orders: num(c.orders),
      bookings: num(c.bookings),
      activeMerchants: num(c.active_merchants),
      newCustomers: num(c.new_customers),
      pendingVerification: num(o.pending_verification),
      openDisputes: num(o.open_disputes),
      payoutExceptions: num(o.payout_exceptions),
      openTickets: num(o.open_tickets),
      overdueTickets: num(o.overdue_tickets),
      reportedReviews: num(o.reported_reviews),
      failedNotifications: num(o.failed_notifications),
      daily: r.dates.map((date) => ({
        date,
        shop: day('order', date),
        services: day('booking', date),
      })),
    };
  }
}
