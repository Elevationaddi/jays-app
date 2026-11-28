import { describe, expect, it } from 'vitest';
import {
  addDays,
  availableSlots,
  type AvailabilityInput,
  BookingRuleError,
  businessTransition,
  canCustomerReschedule,
  fitsSchedule,
  cancellationRefund,
  noShowRefund,
  travelTransition,
  isLocalDate,
  localDateOf,
  localToUtc,
  minutesOfDay,
  offsetMinutes,
  rankStaff,
  weekdayOf,
} from './booking.js';

const TZ = 'Asia/Dubai';
// 2026-12-07 is a Monday.
const DATE = '2026-12-07';
const at = (hhmm: string, date = DATE) => localToUtc(date, minutesOfDay(hhmm), TZ);

const base = (over: Partial<AvailabilityInput> = {}): AvailabilityInput => ({
  date: DATE,
  timeZone: TZ,
  now: new Date('2026-12-01T00:00:00Z'),
  service: { durationMin: 60, bufferBeforeMin: 0, bufferAfterMin: 0 },
  branchHours: [{ weekday: 1, start: '09:00', end: '18:00' }],
  closures: [],
  staff: [
    { id: 'a', shifts: [{ weekday: 1, start: '09:00', end: '13:00' }], blocks: [], busy: [] },
  ],
  ...over,
});
const starts = (input: AvailabilityInput) =>
  availableSlots(input).map((s) => s.startAt.toISOString());

describe('local time helpers', () => {
  it('validates dates and parses times', () => {
    expect(isLocalDate('2026-02-28')).toBe(true);
    expect(isLocalDate('2026-02-30')).toBe(false);
    expect(isLocalDate('2026-2-3')).toBe(false);
    expect(minutesOfDay('09:30')).toBe(570);
    expect(minutesOfDay('23:45:00')).toBe(1425);
    expect(() => minutesOfDay('9am')).toThrow(RangeError);
    expect(weekdayOf(DATE)).toBe(1);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('converts Dubai wall-clock times to UTC (T14)', () => {
    expect(offsetMinutes(new Date('2026-12-07T00:00:00Z'), TZ)).toBe(240);
    expect(at('09:00').toISOString()).toBe('2026-12-07T05:00:00.000Z');
    // Local midnight is the previous UTC day.
    expect(at('00:00').toISOString()).toBe('2026-12-06T20:00:00.000Z');
    expect(localDateOf(new Date('2026-12-06T20:00:00Z'), TZ)).toBe('2026-12-07');
    expect(localDateOf(new Date('2026-12-06T19:59:59Z'), TZ)).toBe('2026-12-06');
  });

  it('handles a daylight-saving zone', () => {
    // London switches to BST on 2026-03-29 at 01:00 UTC.
    expect(localToUtc('2026-03-29', 12 * 60, 'Europe/London').toISOString()).toBe(
      '2026-03-29T11:00:00.000Z',
    );
    expect(localToUtc('2026-03-28', 12 * 60, 'Europe/London').toISOString()).toBe(
      '2026-03-28T12:00:00.000Z',
    );
  });
});

describe('availableSlots', () => {
  it('offers grid starts where the appointment fits inside the shift', () => {
    const result = starts(base());
    expect(result[0]).toBe(at('09:00').toISOString());
    expect(result.at(-1)).toBe(at('12:00').toISOString());
    expect(result).toHaveLength(13); // 09:00 .. 12:00 every 15 minutes
  });

  it('needs the buffers inside the shift but not inside opening hours', () => {
    const result = starts(
      base({ service: { durationMin: 60, bufferBeforeMin: 15, bufferAfterMin: 15 } }),
    );
    expect(result[0]).toBe(at('09:15').toISOString());
    expect(result.at(-1)).toBe(at('11:45').toISOString());
  });

  it('keeps the appointment inside opening hours even if the shift is longer', () => {
    const result = starts(
      base({
        branchHours: [{ weekday: 1, start: '10:00', end: '12:00' }],
        staff: [
          { id: 'a', shifts: [{ weekday: 1, start: '08:00', end: '20:00' }], blocks: [], busy: [] },
        ],
      }),
    );
    expect(result[0]).toBe(at('10:00').toISOString());
    expect(result.at(-1)).toBe(at('11:00').toISOString());
  });

  it('skips blocks, bookings, closures and the past', () => {
    const result = starts(
      base({
        now: at('09:20'),
        closures: [{ start: at('12:30'), end: at('13:00') }],
        staff: [
          {
            id: 'a',
            shifts: [{ weekday: 1, start: '09:00', end: '13:00' }],
            blocks: [{ start: at('10:00'), end: at('10:30') }],
            busy: [{ start: at('11:00'), end: at('11:30') }],
          },
        ],
      }),
    );
    // 11:30 starts exactly when the booking ends and ends exactly when the closure starts ('[)').
    expect(result).toEqual([at('11:30').toISOString()]);
  });

  it('returns nothing on a closed weekday', () => {
    expect(availableSlots(base({ date: '2026-12-08' }))).toEqual([]);
  });

  it('lists every free staff member in id order', () => {
    const slots = availableSlots(
      base({
        staff: [
          { id: 'z', shifts: [{ weekday: 1, start: '09:00', end: '11:00' }], blocks: [], busy: [] },
          {
            id: 'b',
            shifts: [{ weekday: 1, start: '09:00', end: '11:00' }],
            blocks: [],
            busy: [{ start: at('09:00'), end: at('10:00') }],
          },
        ],
      }),
    );
    expect(slots[0]).toMatchObject({ staffIds: ['z'] });
    expect(slots.find((s) => s.startAt.getTime() === at('10:00').getTime())?.staffIds).toEqual([
      'b',
      'z',
    ]);
  });

  it('covers a full local day across the UTC date boundary (T14)', () => {
    const slots = availableSlots(
      base({
        service: { durationMin: 30, bufferBeforeMin: 0, bufferAfterMin: 0 },
        branchHours: [{ weekday: 1, start: '00:00', end: '23:59' }],
        staff: [
          { id: 'a', shifts: [{ weekday: 1, start: '00:00', end: '02:00' }], blocks: [], busy: [] },
        ],
      }),
    );
    expect(slots[0]?.startAt.toISOString()).toBe('2026-12-06T20:00:00.000Z');
    expect(slots.every((s) => localDateOf(s.startAt, TZ) === DATE)).toBe(true);
  });
});

describe('rankStaff', () => {
  it('prefers the lightest load, then the lowest id', () => {
    expect(
      rankStaff(
        ['c', 'a', 'b'],
        new Map([
          ['a', 2],
          ['b', 1],
        ]),
      ),
    ).toEqual(['c', 'b', 'a']);
    expect(rankStaff(['b', 'a'], new Map())).toEqual(['a', 'b']);
  });
});

describe('cancellationRefund (T09)', () => {
  const startAt = new Date('2026-12-10T10:00:00Z');
  const policy = { cutoffHours: 24, lateRefundBps: 5_000 };
  const cancel = (now: string, by: 'customer' | 'business' = 'customer') =>
    cancellationRefund({ priceFils: 10_001, startAt, now: new Date(now), policy, by });

  it('refunds in full up to and including the cutoff instant', () => {
    expect(cancel('2026-12-09T10:00:00Z')).toEqual({
      refundFils: 10_001,
      travelFils: 0,
      late: false,
    });
  });

  it('refunds the late share rounded down after the cutoff', () => {
    expect(cancel('2026-12-09T10:00:00.001Z')).toEqual({
      refundFils: 5_000,
      travelFils: 0,
      late: true,
    });
  });

  it('refuses after the start, unless the business cancels', () => {
    expect(() => cancel('2026-12-10T10:00:00Z')).toThrow(BookingRuleError);
    expect(cancel('2026-12-10T11:00:00Z', 'business')).toEqual({
      refundFils: 10_001,
      travelFils: 0,
      late: false,
    });
  });

  it('refunds the travel fee in full until travel starts (ADR-0025)', () => {
    const home = (travelStarted: boolean, by: 'customer' | 'business' = 'customer') =>
      cancellationRefund({
        priceFils: 12_000,
        travelFeeFils: 2_000,
        travelStarted,
        startAt,
        now: new Date('2026-12-10T08:00:00Z'),
        policy,
        by,
      });
    expect(home(false)).toEqual({ refundFils: 7_000, travelFils: 2_000, late: true });
    expect(home(true)).toEqual({ refundFils: 6_000, travelFils: 1_000, late: true });
    expect(home(true, 'business')).toEqual({ refundFils: 12_000, travelFils: 2_000, late: false });
  });

  it('refunds the no-show share, nothing for older policies', () => {
    expect(noShowRefund({ priceFils: 10_001, policy })).toEqual({
      refundFils: 0,
      travelFils: 0,
      late: true,
    });
    expect(
      noShowRefund({
        priceFils: 12_000,
        travelFeeFils: 2_000,
        policy: { ...policy, noShowRefundBps: 2_500 },
      }),
    ).toEqual({ refundFils: 3_000, travelFils: 500, late: true });
  });

  it('moves travel forward one step, "on the way" from 3 hours before', () => {
    const at = (minutes: number) => new Date(startAt.getTime() - minutes * 60_000);
    const base = { bookingStatus: 'confirmed' as const, startAt };
    expect(() =>
      travelTransition({ ...base, current: 'not_started', next: 'on_the_way', now: at(180) }),
    ).not.toThrow();
    expect(() =>
      travelTransition({ ...base, current: 'not_started', next: 'on_the_way', now: at(181) }),
    ).toThrow(/3 hours/);
    expect(() =>
      travelTransition({ ...base, current: 'not_started', next: 'arrived', now: at(10) }),
    ).toThrow(BookingRuleError);
    expect(() =>
      travelTransition({ ...base, current: 'arrived', next: 'on_the_way', now: at(10) }),
    ).toThrow(BookingRuleError);
    expect(() =>
      travelTransition({
        ...base,
        bookingStatus: 'canceled',
        current: 'not_started',
        next: 'on_the_way',
        now: at(10),
      }),
    ).toThrow(BookingRuleError);
  });

  it('allows customer rescheduling only before the cutoff', () => {
    const input = { status: 'confirmed' as const, startAt, policy };
    expect(canCustomerReschedule({ ...input, now: new Date('2026-12-09T09:59:00Z') })).toBe(true);
    expect(canCustomerReschedule({ ...input, now: new Date('2026-12-09T10:01:00Z') })).toBe(false);
    expect(
      canCustomerReschedule({ ...input, status: 'held', now: new Date('2026-12-01T00:00:00Z') }),
    ).toBe(false);
  });
});

describe('businessTransition', () => {
  const startAt = new Date('2026-12-10T10:00:00Z');
  const t = (minutes: number) => ({ startAt, now: new Date(startAt.getTime() + minutes * 60_000) });

  it('checks in from an hour before the start', () => {
    expect(businessTransition('confirmed', 'check_in', t(-60))).toBe('checked_in');
    expect(() => businessTransition('confirmed', 'check_in', t(-61))).toThrow(/an hour/);
  });

  it('completes only checked-in bookings', () => {
    expect(businessTransition('checked_in', 'complete', t(30))).toBe('completed');
    expect(() => businessTransition('confirmed', 'complete', t(30))).toThrow(BookingRuleError);
  });

  it('records a no-show after the grace period', () => {
    expect(businessTransition('confirmed', 'no_show', t(15))).toBe('no_show');
    expect(() => businessTransition('confirmed', 'no_show', t(14))).toThrow(/15 minutes/);
  });

  it('cancels confirmed bookings only', () => {
    expect(businessTransition('confirmed', 'cancel', t(-500))).toBe('canceled');
    for (const status of ['held', 'completed', 'canceled', 'expired'] as const) {
      expect(() => businessTransition(status, 'cancel', t(0))).toThrow(/Cannot cancel/);
    }
  });
});

describe('fitsSchedule', () => {
  const booking = {
    start: at('10:00'),
    end: at('11:00'),
    occupiedStart: at('09:45'),
    occupiedEnd: at('11:15'),
  };
  const schedule = {
    booking,
    timeZone: TZ,
    branchHours: [{ weekday: 1, start: '10:00', end: '18:00' }],
    closures: [],
    shifts: [{ weekday: 1, start: '09:30', end: '12:00' }],
    blocks: [],
  };

  it('accepts a booking inside hours and a shift (buffers may sit outside opening hours)', () => {
    expect(fitsSchedule(schedule)).toBe(true);
  });

  it('rejects a booking stranded by a shorter shift, a block or a closure', () => {
    expect(
      fitsSchedule({ ...schedule, shifts: [{ weekday: 1, start: '10:00', end: '12:00' }] }),
    ).toBe(false);
    expect(fitsSchedule({ ...schedule, blocks: [{ start: at('11:10'), end: at('11:30') }] })).toBe(
      false,
    );
    expect(
      fitsSchedule({ ...schedule, closures: [{ start: at('10:30'), end: at('12:00') }] }),
    ).toBe(false);
    expect(fitsSchedule({ ...schedule, branchHours: [] })).toBe(false);
  });
});
