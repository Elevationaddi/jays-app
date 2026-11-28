import { HttpStatus } from '@nestjs/common';
import type { Booking, MerchantBooking } from '@jays/contracts';
import type { Database, Db, HomeAddress } from '@jays/db';

type Localized = { en: string; ar: string };
import {
  ACTIVE_BOOKING_STATUSES,
  addDays,
  type AvailabilityInput,
  BookingRuleError,
  canCustomerReschedule,
  cancellationRefund,
  fitsSchedule,
  type Interval,
  localDateOf,
  localToUtc,
  type WeeklyInterval,
} from '@jays/domain';
import { sql, type Transaction } from 'kysely';
import { ApiError } from '../common/error.filter.js';

export type Trx = Transaction<Database>;
export type Conn = Db | Trx;

/** Snapshot stored on a booking (T13): what was booked, unaffected by later edits. */
export interface BookingSnapshot {
  business: { id: string; name: Localized };
  branch: {
    id: string;
    name: Localized;
    emirate: string;
    area: string;
    street: string;
    building: string;
    timezone: string;
  };
  service: {
    id: string;
    title: Localized;
    durationMin: number;
    bufferBeforeMin: number;
    bufferAfterMin: number;
  };
  staff: { id: string; displayName: string };
}

export interface PolicySnapshot {
  cutoffHours: number;
  lateRefundBps: number;
}

/**
 * Buffers are at most 120 minutes each side and travel at most 120 more, so this margin catches
 * every interval touching a day.
 */
const MARGIN_MS = 6 * 3_600_000;

export const hhmm = (time: string) => time.slice(0, 5);

export function isPgError(error: unknown, code: string): boolean {
  return (error as { code?: unknown } | null)?.code === code;
}

export const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found.');

export const slotUnavailable = () =>
  new ApiError(
    HttpStatus.CONFLICT,
    'SLOT_UNAVAILABLE',
    'That time is no longer available. Pick another slot.',
  );

export function ruleError(error: BookingRuleError): ApiError {
  switch (error.code) {
    case 'INVALID_TRANSITION':
      return new ApiError(HttpStatus.CONFLICT, 'INVALID_TRANSITION', error.message);
    case 'TOO_LATE':
      return new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'CANCEL_TOO_LATE', error.message);
    case 'TOO_EARLY':
      return new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'TOO_EARLY', error.message);
  }
}

/** Runs `fn` inside a savepoint; an exclusion violation (23P01) rolls back to it and yields null. */
export async function tryExclusive<T>(trx: Trx, fn: () => Promise<T>): Promise<T | null> {
  await sql`SAVEPOINT booking_attempt`.execute(trx);
  try {
    const result = await fn();
    await sql`RELEASE SAVEPOINT booking_attempt`.execute(trx);
    return result;
  } catch (error) {
    await sql`ROLLBACK TO SAVEPOINT booking_attempt`.execute(trx);
    if (isPgError(error, '23P01')) return null;
    throw error;
  }
}

export async function expireHolds(trx: Trx, now: Date) {
  await sql`SELECT expire_booking_holds(${now}, 100)`.execute(trx);
}

/** The local day as UTC instants, widened by the buffer margin. */
export function dayWindow(date: string, timeZone: string) {
  const start = localToUtc(date, 0, timeZone);
  const end = localToUtc(addDays(date, 1), 0, timeZone);
  return {
    start,
    end,
    from: new Date(start.getTime() - MARGIN_MS),
    to: new Date(end.getTime() + MARGIN_MS),
  };
}

export async function weeklyHours(conn: Conn, branchId: string): Promise<WeeklyInterval[]> {
  const rows = await conn
    .selectFrom('branch_hours')
    .select(['weekday', 'opens_at', 'closes_at'])
    .where('branch_id', '=', branchId)
    .orderBy('weekday')
    .orderBy('opens_at')
    .execute();
  return rows.map((r) => ({ weekday: r.weekday, start: hhmm(r.opens_at), end: hhmm(r.closes_at) }));
}

async function closuresBetween(conn: Conn, branchId: string, from: Date, to: Date) {
  const rows = await conn
    .selectFrom('branch_closures')
    .select(['starts_at', 'ends_at'])
    .where('branch_id', '=', branchId)
    .where('starts_at', '<', to)
    .where('ends_at', '>', from)
    .execute();
  return rows.map((r) => ({ start: r.starts_at, end: r.ends_at }));
}

/**
 * Loads everything availability needs for one branch, service and local date: opening hours,
 * closures, and for each candidate staff member their shifts at the branch, blocks and the
 * occupied intervals of their active bookings (optionally ignoring one booking being moved).
 */
export async function loadDay(
  conn: Conn,
  input: {
    branch: { id: string; timezone: string };
    service: { durationMin: number; bufferBeforeMin: number; bufferAfterMin: number };
    staffIds: string[];
    date: string;
    now: Date;
    excludeBookingId?: string;
  },
): Promise<AvailabilityInput> {
  const { branch, date, staffIds } = input;
  const w = dayWindow(date, branch.timezone);
  const [branchHours, closures] = await Promise.all([
    weeklyHours(conn, branch.id),
    closuresBetween(conn, branch.id, w.from, w.to),
  ]);
  const staff: AvailabilityInput['staff'] = [];
  if (staffIds.length > 0) {
    const [shifts, blocks, busy] = await Promise.all([
      conn
        .selectFrom('shifts')
        .select(['staff_id', 'weekday', 'starts_at', 'ends_at'])
        .where('branch_id', '=', branch.id)
        .where('staff_id', 'in', staffIds)
        .execute(),
      conn
        .selectFrom('schedule_blocks')
        .select(['staff_id', 'starts_at', 'ends_at'])
        .where('staff_id', 'in', staffIds)
        .where('starts_at', '<', w.to)
        .where('ends_at', '>', w.from)
        .execute(),
      (() => {
        let q = conn
          .selectFrom('bookings')
          .select(['staff_id', 'occupied_start', 'occupied_end'])
          .where('staff_id', 'in', staffIds)
          .where('status', 'in', [...ACTIVE_BOOKING_STATUSES])
          .where('occupied_start', '<', w.to)
          .where('occupied_end', '>', w.from);
        if (input.excludeBookingId) q = q.where('id', '<>', input.excludeBookingId);
        return q.execute();
      })(),
    ]);
    for (const id of staffIds) {
      staff.push({
        id,
        shifts: shifts
          .filter((s) => s.staff_id === id)
          .map((s) => ({ weekday: s.weekday, start: hhmm(s.starts_at), end: hhmm(s.ends_at) })),
        blocks: blocks
          .filter((b) => b.staff_id === id)
          .map((b) => ({ start: b.starts_at, end: b.ends_at })),
        busy: busy
          .filter((b) => b.staff_id === id)
          .map((b) => ({ start: b.occupied_start, end: b.occupied_end })),
      });
    }
  }
  return {
    date,
    timeZone: branch.timezone,
    now: input.now,
    service: input.service,
    branchHours,
    closures,
    staff,
  };
}

/** Active staff at a branch who perform a service, in id order. */
export async function qualifiedStaff(
  conn: Conn,
  businessId: string,
  branchId: string,
  serviceId: string,
): Promise<string[]> {
  const rows = await conn
    .selectFrom('staff as s')
    .innerJoin('staff_branches as sb', (j) =>
      j.onRef('sb.staff_id', '=', 's.id').on('sb.branch_id', '=', branchId),
    )
    .innerJoin('staff_services as ss', (j) =>
      j.onRef('ss.staff_id', '=', 's.id').on('ss.service_id', '=', serviceId),
    )
    .select('s.id')
    .where('s.business_id', '=', businessId)
    .where('s.status', '=', 'active')
    .orderBy('s.id')
    .execute();
  return rows.map((r) => r.id);
}

/** Active bookings per staff member on a local day ("any professional" balancing). */
export async function dailyLoads(conn: Conn, staffIds: string[], date: string, timeZone: string) {
  const loads = new Map<string, number>();
  if (staffIds.length === 0) return loads;
  const w = dayWindow(date, timeZone);
  const rows = await conn
    .selectFrom('bookings')
    .select(['staff_id', (eb) => eb.fn.countAll<string>().as('n')])
    .where('staff_id', 'in', staffIds)
    .where('status', 'in', ['held', 'confirmed', 'checked_in', 'completed'])
    .where('start_at', '>=', w.start)
    .where('start_at', '<', w.end)
    .groupBy('staff_id')
    .execute();
  for (const r of rows) loads.set(r.staff_id, Number(r.n));
  return loads;
}

/** Locks rows so schedule changes and allocations never interleave (FOR SHARE vs FOR UPDATE). */
export async function shareLock(trx: Trx, branchId: string, staffIds: string[]) {
  await trx.selectFrom('branches').select('id').where('id', '=', branchId).forShare().execute();
  if (staffIds.length > 0) {
    await trx
      .selectFrom('staff')
      .select('id')
      .where('id', 'in', staffIds)
      .orderBy('id')
      .forShare()
      .execute();
  }
}

/**
 * Re-checks every future active booking touched by a schedule change against the schedule as it
 * now stands (inside the same transaction). Any booking that no longer fits makes the change
 * fail with 409 SCHEDULE_CONFLICT, so confirmed customers are never silently stranded.
 */
export async function assertBookingsStillFit(
  trx: Trx,
  businessId: string,
  scope: { branchId?: string; staffId?: string },
  now: Date,
) {
  let q = trx
    .selectFrom('bookings as b')
    .innerJoin('branches as br', 'br.id', 'b.branch_id')
    .select([
      'b.id',
      'b.branch_id',
      'b.staff_id',
      'b.start_at',
      'b.end_at',
      'b.occupied_start',
      'b.occupied_end',
      'br.timezone',
    ])
    .where('b.business_id', '=', businessId)
    .where('b.status', 'in', [...ACTIVE_BOOKING_STATUSES])
    .where('b.end_at', '>', now);
  if (scope.branchId) q = q.where('b.branch_id', '=', scope.branchId);
  if (scope.staffId) q = q.where('b.staff_id', '=', scope.staffId);
  const bookings = await q.orderBy('b.start_at').limit(1000).execute();
  if (bookings.length === 0) return;

  const hours = new Map<string, WeeklyInterval[]>();
  const closures = new Map<string, Interval[]>();
  const shifts = new Map<string, WeeklyInterval[]>();
  const blocks = new Map<string, Interval[]>();
  const branchIds = [...new Set(bookings.map((b) => b.branch_id))];
  const staffIds = [...new Set(bookings.map((b) => b.staff_id))];
  for (const id of branchIds) hours.set(id, await weeklyHours(trx, id));
  const [closureRows, shiftRows, blockRows] = await Promise.all([
    trx
      .selectFrom('branch_closures')
      .select(['branch_id', 'starts_at', 'ends_at'])
      .where('branch_id', 'in', branchIds)
      .where('ends_at', '>', now)
      .execute(),
    trx
      .selectFrom('shifts')
      .select(['staff_id', 'branch_id', 'weekday', 'starts_at', 'ends_at'])
      .where('staff_id', 'in', staffIds)
      .execute(),
    trx
      .selectFrom('schedule_blocks')
      .select(['staff_id', 'starts_at', 'ends_at'])
      .where('staff_id', 'in', staffIds)
      .where('ends_at', '>', now)
      .execute(),
  ]);
  for (const c of closureRows) {
    closures.set(c.branch_id, [
      ...(closures.get(c.branch_id) ?? []),
      { start: c.starts_at, end: c.ends_at },
    ]);
  }
  for (const s of shiftRows) {
    const key = `${s.staff_id}:${s.branch_id}`;
    shifts.set(key, [
      ...(shifts.get(key) ?? []),
      { weekday: s.weekday, start: hhmm(s.starts_at), end: hhmm(s.ends_at) },
    ]);
  }
  for (const b of blockRows) {
    blocks.set(b.staff_id, [
      ...(blocks.get(b.staff_id) ?? []),
      { start: b.starts_at, end: b.ends_at },
    ]);
  }
  const stranded = bookings.filter(
    (b) =>
      !fitsSchedule({
        booking: {
          start: b.start_at,
          end: b.end_at,
          occupiedStart: b.occupied_start,
          occupiedEnd: b.occupied_end,
        },
        timeZone: b.timezone,
        branchHours: hours.get(b.branch_id) ?? [],
        closures: closures.get(b.branch_id) ?? [],
        shifts: shifts.get(`${b.staff_id}:${b.branch_id}`) ?? [],
        blocks: blocks.get(b.staff_id) ?? [],
      }),
  );
  if (stranded.length > 0) {
    throw new ApiError(
      HttpStatus.CONFLICT,
      'SCHEDULE_CONFLICT',
      `This change would leave ${stranded.length} upcoming booking(s) outside the schedule. Move or cancel them first.`,
      { bookings: stranded.map((b) => b.id) },
    );
  }
}

/** Refuses when future active bookings exist for the given scope (archiving, unassigning). */
export async function assertNoUpcomingBookings(
  trx: Trx,
  businessId: string,
  scope: { branchId?: string; staffId?: string; serviceId?: string },
  now: Date,
) {
  let q = trx
    .selectFrom('bookings')
    .select('id')
    .where('business_id', '=', businessId)
    .where('status', 'in', [...ACTIVE_BOOKING_STATUSES])
    .where('end_at', '>', now);
  if (scope.branchId) q = q.where('branch_id', '=', scope.branchId);
  if (scope.staffId) q = q.where('staff_id', '=', scope.staffId);
  if (scope.serviceId) q = q.where('service_id', '=', scope.serviceId);
  const rows = await q.limit(50).execute();
  if (rows.length > 0) {
    throw new ApiError(
      HttpStatus.CONFLICT,
      'SCHEDULE_CONFLICT',
      'There are upcoming bookings that depend on this. Move or cancel them first.',
      { bookings: rows.map((r) => r.id) },
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Views

export const BOOKING_COLUMNS = [
  'b.id',
  'b.user_id',
  'b.business_id',
  'b.status',
  'b.start_at',
  'b.end_at',
  'b.hold_expires_at',
  'b.source',
  'b.payment_mode',
  'b.price_fils',
  'b.tax_fils',
  'b.snapshot',
  'b.policy_snapshot',
  'b.customer_name',
  'b.customer_phone',
  'b.note',
  'b.canceled_by',
  'b.cancel_reason',
  'b.refund_fils',
  'b.rescheduled_count',
  'b.version',
  'b.created_at',
  'b.location_type',
  'b.home_address',
  'b.travel_fee_fils',
] as const;

export interface BookingRow {
  id: string;
  user_id: string | null;
  business_id: string;
  status: Booking['status'];
  start_at: Date;
  end_at: Date;
  hold_expires_at: Date | null;
  source: 'customer' | 'manual';
  payment_mode: 'prepaid' | 'pay_at_venue';
  price_fils: number;
  tax_fils: number;
  snapshot: unknown;
  policy_snapshot: unknown;
  customer_name: string | null;
  customer_phone: string | null;
  note: string | null;
  canceled_by: 'customer' | 'business' | 'system' | null;
  cancel_reason: string | null;
  refund_fils: number | null;
  rescheduled_count: number;
  version: number;
  created_at: Date;
  location_type: 'venue' | 'home';
  home_address: HomeAddress | null;
  travel_fee_fils: number;
}

function core(row: BookingRow) {
  const snap = row.snapshot as BookingSnapshot;
  const policy = row.policy_snapshot as PolicySnapshot;
  return {
    id: row.id,
    status: row.status,
    startAt: row.start_at.toISOString(),
    endAt: row.end_at.toISOString(),
    timeZone: snap.branch.timezone,
    holdExpiresAt: row.status === 'held' ? (row.hold_expires_at?.toISOString() ?? null) : null,
    business: snap.business,
    branch: {
      id: snap.branch.id,
      name: snap.branch.name,
      emirate: snap.branch.emirate as Booking['branch']['emirate'],
      area: snap.branch.area,
      street: snap.branch.street,
      building: snap.branch.building,
    },
    service: {
      id: snap.service.id,
      title: snap.service.title,
      durationMin: snap.service.durationMin,
    },
    staff: snap.staff,
    location: row.location_type,
    homeAddress: row.home_address
      ? {
          ...row.home_address,
          emirate: row.home_address.emirate as Booking['branch']['emirate'],
        }
      : null,
    travelFeeFils: row.travel_fee_fils,
    priceFils: row.price_fils,
    taxFils: row.tax_fils,
    currency: 'AED' as const,
    policy,
    refundFils: row.refund_fils,
    canceledBy: row.canceled_by,
    rescheduledCount: row.rescheduled_count,
    version: row.version,
    createdAt: row.created_at.toISOString(),
  };
}

export function customerBookingView(
  row: BookingRow,
  now: Date,
  payment: {
    status: string;
    provider_intent_id: string | null;
    client_secret: string | null;
  } | null,
): Booking {
  const policy = row.policy_snapshot as PolicySnapshot;
  let cancelRefundFils: number | null = null;
  if (row.status === 'held') cancelRefundFils = 0;
  if (row.status === 'confirmed') {
    try {
      cancelRefundFils = cancellationRefund({
        priceFils: row.price_fils,
        startAt: row.start_at,
        now,
        policy,
        by: 'customer',
      }).refundFils;
    } catch (error) {
      if (!(error instanceof BookingRuleError)) throw error;
    }
  }
  const open = row.status === 'held' && payment?.status === 'requires_payment';
  return {
    ...core(row),
    cancelRefundFils,
    canReschedule: canCustomerReschedule({
      status: row.status,
      startAt: row.start_at,
      now,
      policy,
    }),
    payment: payment
      ? {
          status: payment.status,
          paymentIntentId: open ? payment.provider_intent_id : null,
          paymentClientSecret: open ? payment.client_secret : null,
        }
      : null,
  };
}

export function merchantBookingView(
  row: BookingRow,
  paymentStatus: string | null,
): MerchantBooking {
  return {
    ...core(row),
    source: row.source,
    paymentMode: row.payment_mode,
    paymentStatus,
    customer: { name: row.customer_name, phone: row.customer_phone },
    note: row.note,
    cancelReason: row.cancel_reason,
  };
}

export { localDateOf };
