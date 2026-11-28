import { describe, expect, it } from 'vitest';
import {
  PILOT,
  promotionApplies,
  promotionDaysLeft,
  promotionEndsAt,
  promotionState,
  promotionStopsAt,
} from './pilot.js';

const start = new Date('2027-01-10T06:00:00Z');
const window = { startsAt: start, endsAt: promotionEndsAt(start), cancelledAt: null };

describe('pilot promotion (ADR-0034)', () => {
  it('matches the approved pilot: Abu Dhabi, 30 product and 20 service businesses, 30 days', () => {
    expect(PILOT).toEqual({
      emirate: 'AUH',
      durationDays: 30,
      targets: { shop: 30, services: 20 },
    });
    expect(window.endsAt.toISOString()).toBe('2027-02-09T06:00:00.000Z');
  });

  it('applies from the start (inclusive) to the end (exclusive)', () => {
    expect(promotionApplies(window, new Date(start.getTime() - 1))).toBe(false);
    expect(promotionApplies(window, start)).toBe(true);
    expect(promotionApplies(window, new Date(window.endsAt.getTime() - 1))).toBe(true);
    expect(promotionApplies(window, window.endsAt)).toBe(false);
  });

  it('stops at a cancellation, and never extends past the end', () => {
    const cancelled = { ...window, cancelledAt: new Date('2027-01-20T00:00:00Z') };
    expect(promotionStopsAt(cancelled)).toEqual(cancelled.cancelledAt);
    expect(promotionApplies(cancelled, new Date('2027-01-19T23:59:59Z'))).toBe(true);
    expect(promotionApplies(cancelled, new Date('2027-01-20T00:00:00Z'))).toBe(false);
    expect(promotionState(cancelled, new Date('2027-01-21T00:00:00Z'))).toBe('cancelled');
    const late = { ...window, cancelledAt: new Date('2027-03-01T00:00:00Z') };
    expect(promotionStopsAt(late)).toEqual(window.endsAt);
    expect(promotionState(late, new Date('2027-03-02T00:00:00Z'))).toBe('ended');
  });

  it('counts days left and the state', () => {
    expect(promotionDaysLeft(window, new Date('2027-01-01T00:00:00Z'))).toBe(30);
    expect(promotionDaysLeft(window, new Date('2027-02-08T07:00:00Z'))).toBe(1);
    expect(promotionDaysLeft(window, new Date('2027-02-10T00:00:00Z'))).toBe(0);
    expect(promotionState(window, new Date('2027-01-01T00:00:00Z'))).toBe('scheduled');
    expect(promotionState(window, start)).toBe('active');
    expect(promotionState(window, window.endsAt)).toBe('ended');
  });
});
