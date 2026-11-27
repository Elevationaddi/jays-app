import { applyBasisPoints, fils } from './money.js';
import { DEFAULT_HOLD_MINUTES, DEFAULT_SLOT_GRID_MINUTES } from './time.js';

/**
 * Booking rules (docs/05-workflows.md, Appointment). Pure functions: the API loads the data,
 * these decide. The database still has the last word on overlaps (exclusion constraint).
 */

export const BOOKING_STATUSES = [
  'held',
  'confirmed',
  'checked_in',
  'completed',
  'canceled',
  'no_show',
  'expired',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Statuses that occupy the staff member's time (the exclusion constraint's predicate). */
export const ACTIVE_BOOKING_STATUSES = ['held', 'confirmed', 'checked_in'] as const;

export const BLOCK_KINDS = ['break', 'leave', 'other'] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

export const BOOKING_HOLD_MINUTES = DEFAULT_HOLD_MINUTES;
export const SLOT_GRID_MINUTES = DEFAULT_SLOT_GRID_MINUTES;
/** Staff can mark a no-show only this long after the start (configurable later). */
export const NO_SHOW_GRACE_MINUTES = 15;
/** Check-in opens this long before the start. */
export const CHECK_IN_EARLY_MINUTES = 60;
/** How far ahead customers can book. */
export const BOOKING_HORIZON_DAYS = 60;
/** Unpaid holds one customer may keep at once, so nobody can block a calendar. */
export const MAX_ACTIVE_HOLDS_PER_USER = 2;

export const BUSINESS_BOOKING_TRANSITIONS = ['check_in', 'complete', 'no_show', 'cancel'] as const;
export type BusinessBookingTransition = (typeof BUSINESS_BOOKING_TRANSITIONS)[number];

// ---------------------------------------------------------------------------------------------
// Local dates and times. Branch hours and shifts are wall-clock times in the branch's timezone;
// everything else is a UTC instant.

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

export function isLocalDate(value: string): boolean {
  const m = DATE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === value;
}

/** Minutes after midnight for "HH:MM" or "HH:MM:SS". */
export function minutesOfDay(time: string): number {
  const m = TIME.exec(time);
  if (!m) throw new RangeError(`not a time: ${time}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Day of week of a local date, 0 = Sunday. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The timezone's offset from UTC at an instant, in minutes (Asia/Dubai: +240). */
export function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

/** The UTC instant of a local wall-clock time (minutes after local midnight) on a local date. */
export function localToUtc(date: string, minutes: number, timeZone: string): Date {
  const naive = Date.parse(`${date}T00:00:00Z`) + minutes * 60_000;
  // Two passes settle the offset even across a daylight-saving change.
  let guess = naive - offsetMinutes(new Date(naive), timeZone) * 60_000;
  guess = naive - offsetMinutes(new Date(guess), timeZone) * 60_000;
  return new Date(guess);
}

/** The local calendar date of an instant in a timezone. */
export function localDateOf(instant: Date, timeZone: string): string {
  return new Date(instant.getTime() + offsetMinutes(instant, timeZone) * 60_000)
    .toISOString()
    .slice(0, 10);
}

// ---------------------------------------------------------------------------------------------
// Availability

export interface Interval {
  start: Date;
  end: Date;
}

export interface WeeklyInterval {
  weekday: number;
  /** "HH:MM" or "HH:MM:SS", local time. */
  start: string;
  end: string;
}

export interface AvailabilityInput {
  date: string;
  timeZone: string;
  now: Date;
  gridMinutes?: number;
  service: { durationMin: number; bufferBeforeMin: number; bufferAfterMin: number };
  branchHours: WeeklyInterval[];
  closures: Interval[];
  staff: {
    id: string;
    shifts: WeeklyInterval[];
    /** Breaks, leave and other blocks. */
    blocks: Interval[];
    /** Occupied intervals of this staff member's active bookings, buffers included. */
    busy: Interval[];
  }[];
}

export interface Slot {
  startAt: Date;
  endAt: Date;
  /** Qualified staff free for the whole interval, in id order. */
  staffIds: string[];
}

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;
const within = (inner: Interval, outer: Interval) =>
  inner.start >= outer.start && inner.end <= outer.end;

function dayIntervals(date: string, timeZone: string, weekly: WeeklyInterval[]): Interval[] {
  const weekday = weekdayOf(date);
  return weekly
    .filter((w) => w.weekday === weekday)
    .map((w) => ({
      start: localToUtc(date, minutesOfDay(w.start), timeZone),
      end: localToUtc(date, minutesOfDay(w.end), timeZone),
    }));
}

/**
 * Bookable start times on a local date. A start qualifies for a staff member when the
 * appointment lies inside the branch's opening hours and outside closures, and the occupied
 * interval (appointment plus buffers) lies inside one of their shifts and clear of their blocks
 * and other bookings. Starts are on the grid from local midnight and strictly in the future.
 */
export function availableSlots(input: AvailabilityInput): Slot[] {
  const grid = input.gridMinutes ?? SLOT_GRID_MINUTES;
  const { durationMin, bufferBeforeMin, bufferAfterMin } = input.service;
  const open = dayIntervals(input.date, input.timeZone, input.branchHours);
  if (open.length === 0) return [];
  const staff = input.staff.map((s) => ({
    id: s.id,
    shifts: dayIntervals(input.date, input.timeZone, s.shifts),
    taken: [...s.blocks, ...s.busy],
  }));
  const slots: Slot[] = [];
  const dayStart = localToUtc(input.date, 0, input.timeZone).getTime();
  const dayEnd = localToUtc(addDays(input.date, 1), 0, input.timeZone).getTime();
  for (let t = dayStart; t < dayEnd; t += grid * 60_000) {
    const appointment = { start: new Date(t), end: new Date(t + durationMin * 60_000) };
    if (appointment.start <= input.now) continue;
    if (!open.some((o) => within(appointment, o))) continue;
    if (input.closures.some((c) => overlaps(appointment, c))) continue;
    const occupied = {
      start: new Date(t - bufferBeforeMin * 60_000),
      end: new Date(appointment.end.getTime() + bufferAfterMin * 60_000),
    };
    const staffIds = staff
      .filter(
        (s) =>
          s.shifts.some((shift) => within(occupied, shift)) &&
          !s.taken.some((x) => overlaps(occupied, x)),
      )
      .map((s) => s.id)
      .sort();
    if (staffIds.length > 0)
      slots.push({ startAt: appointment.start, endAt: appointment.end, staffIds });
  }
  return slots;
}

/**
 * Whether an existing booking still fits a (changed) schedule: the appointment inside opening
 * hours and clear of closures, the occupied interval inside one of the staff member's shifts and
 * clear of their blocks. Schedule changes that would strand a booking are refused (409).
 */
export function fitsSchedule(input: {
  booking: { start: Date; end: Date; occupiedStart: Date; occupiedEnd: Date };
  timeZone: string;
  branchHours: WeeklyInterval[];
  closures: Interval[];
  shifts: WeeklyInterval[];
  blocks: Interval[];
}): boolean {
  const { booking, timeZone } = input;
  const appointment = { start: booking.start, end: booking.end };
  const occupied = { start: booking.occupiedStart, end: booking.occupiedEnd };
  const date = localDateOf(booking.start, timeZone);
  return (
    dayIntervals(date, timeZone, input.branchHours).some((o) => within(appointment, o)) &&
    !input.closures.some((c) => overlaps(appointment, c)) &&
    dayIntervals(date, timeZone, input.shifts).some((s) => within(occupied, s)) &&
    !input.blocks.some((b) => overlaps(occupied, b))
  );
}

/**
 * "Any professional": the candidate with the fewest active bookings that day, then the lowest
 * id. Deterministic, so the same request always tries staff in the same order.
 */
export function rankStaff(candidates: readonly string[], loads: ReadonlyMap<string, number>) {
  return [...candidates].sort(
    (a, b) => (loads.get(a) ?? 0) - (loads.get(b) ?? 0) || (a < b ? -1 : a > b ? 1 : 0),
  );
}

// ---------------------------------------------------------------------------------------------
// Cancellation and transitions

export interface CancellationPolicy {
  /** Free cancellation until this many hours before the start. */
  cutoffHours: number;
  /** Share refunded for a customer cancellation inside the cutoff, in basis points. */
  lateRefundBps: number;
}

export class BookingRuleError extends Error {
  constructor(
    readonly code: 'TOO_LATE' | 'INVALID_TRANSITION' | 'TOO_EARLY',
    message: string,
  ) {
    super(message);
    this.name = 'BookingRuleError';
  }
}

/**
 * What a cancellation refunds. A business cancellation refunds in full. A customer cancellation
 * refunds in full up to and including the exact cutoff instant, then the policy's late share
 * (rounded down to whole fils), and is not possible once the appointment has started.
 */
export function cancellationRefund(input: {
  priceFils: number;
  startAt: Date;
  now: Date;
  policy: CancellationPolicy;
  by: 'customer' | 'business';
}): { refundFils: number; late: boolean } {
  if (input.by === 'business') return { refundFils: input.priceFils, late: false };
  if (input.now >= input.startAt) {
    throw new BookingRuleError('TOO_LATE', 'The appointment has already started.');
  }
  const cutoff = input.startAt.getTime() - input.policy.cutoffHours * 3_600_000;
  if (input.now.getTime() <= cutoff) return { refundFils: input.priceFils, late: false };
  return {
    refundFils: applyBasisPoints(fils(input.priceFils), input.policy.lateRefundBps, 'down'),
    late: true,
  };
}

/** A customer may reschedule a confirmed booking until the free-cancellation cutoff. */
export function canCustomerReschedule(input: {
  status: BookingStatus;
  startAt: Date;
  now: Date;
  policy: CancellationPolicy;
}): boolean {
  return (
    input.status === 'confirmed' &&
    input.now.getTime() <= input.startAt.getTime() - input.policy.cutoffHours * 3_600_000
  );
}

/** The status a business transition leads to, or a rule error explaining why it cannot. */
export function businessTransition(
  status: BookingStatus,
  transition: BusinessBookingTransition,
  times: { now: Date; startAt: Date },
): BookingStatus {
  const minutesToStart = (times.startAt.getTime() - times.now.getTime()) / 60_000;
  switch (transition) {
    case 'check_in':
      if (status !== 'confirmed') break;
      if (minutesToStart > CHECK_IN_EARLY_MINUTES) {
        throw new BookingRuleError('TOO_EARLY', 'Check-in opens an hour before the start.');
      }
      return 'checked_in';
    case 'complete':
      if (status !== 'checked_in') break;
      return 'completed';
    case 'no_show':
      if (status !== 'confirmed') break;
      if (-minutesToStart < NO_SHOW_GRACE_MINUTES) {
        throw new BookingRuleError(
          'TOO_EARLY',
          `A no-show can be recorded ${NO_SHOW_GRACE_MINUTES} minutes after the start.`,
        );
      }
      return 'no_show';
    case 'cancel':
      if (status !== 'confirmed') break;
      return 'canceled';
  }
  throw new BookingRuleError('INVALID_TRANSITION', `Cannot ${transition} a ${status} booking.`);
}
