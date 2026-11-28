import { describe, expect, it } from 'vitest';
import {
  ADDONS_PER_BOOKING_MAX,
  AddonError,
  bookingPriceParts,
  inWaitlistWindow,
  pickAddons,
} from './service-discovery.js';

const addons = [
  { id: 'a', priceFils: 2_000, durationMin: 15 },
  { id: 'b', priceFils: 3_500, durationMin: 30 },
  { id: 'c', priceFils: 0, durationMin: 0 },
];

describe('pickAddons', () => {
  it('returns chosen add-ons in the service order with totals', () => {
    const r = pickAddons(addons, ['b', 'a'], 60);
    expect(r.addons.map((a) => a.id)).toEqual(['a', 'b']);
    expect(r.priceFils).toBe(5_500);
    expect(r.durationMin).toBe(45);
  });

  it('allows none', () => {
    expect(pickAddons(addons, [], 60)).toEqual({ addons: [], priceFils: 0, durationMin: 0 });
  });

  it('rejects unknown, archived or repeated add-ons', () => {
    expect(() => pickAddons(addons, ['x'], 60)).toThrow(AddonError);
    expect(() => pickAddons(addons, ['a', 'a'], 60)).toThrow(/once/);
  });

  it('caps the count and the total duration', () => {
    const many = Array.from({ length: ADDONS_PER_BOOKING_MAX + 1 }, (_, i) => ({
      id: String(i),
      priceFils: 100,
      durationMin: 5,
    }));
    expect(() =>
      pickAddons(
        many,
        many.map((a) => a.id),
        30,
      ),
    ).toThrow(/at most/);
    try {
      pickAddons([{ id: 'long', priceFils: 1, durationMin: 240 }], ['long'], 480);
      expect.unreachable();
    } catch (e) {
      expect((e as AddonError).code).toBe('DURATION_TOO_LONG');
    }
  });
});

describe('bookingPriceParts', () => {
  it('splits VAT in proportion and keeps the total exact', () => {
    // 120.00 service + 20.00 add-ons + 15.00 travel = 155.00 including 5% VAT (7.38).
    const p = bookingPriceParts({
      priceFils: 15_500,
      taxFils: 738,
      addonsFils: 2_000,
      travelFeeFils: 1_500,
    });
    expect(p.serviceFils).toBe(12_000);
    expect(p.addonsVatFils).toBe(95);
    expect(p.travelVatFils).toBe(71);
    expect(p.serviceVatFils + p.addonsVatFils + p.travelVatFils).toBe(738);
    expect(p.serviceFils + p.addonsFils + p.travelFeeFils).toBe(15_500);
  });

  it('handles no VAT and no extras', () => {
    expect(
      bookingPriceParts({ priceFils: 10_000, taxFils: 0, addonsFils: 0, travelFeeFils: 0 }),
    ).toMatchObject({ serviceFils: 10_000, serviceVatFils: 0, addonsVatFils: 0 });
  });
});

describe('inWaitlistWindow', () => {
  it('includes the start and excludes the end', () => {
    expect(inWaitlistWindow('10:00', '10:00', '12:00')).toBe(true);
    expect(inWaitlistWindow('11:55:00', '10:00:00', '12:00:00')).toBe(true);
    expect(inWaitlistWindow('12:00', '10:00', '12:00')).toBe(false);
    expect(inWaitlistWindow('09:59', '10:00', '12:00')).toBe(false);
  });
});
