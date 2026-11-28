import { describe, expect, it } from 'vitest';
import {
  coverageFor,
  homeServiceDecision,
  homeVisitTerms,
  HomeVisitError,
  offersLocation,
  withTravel,
} from './home.js';

const areas = [
  { emirate: 'AUH', area: null, travelFeeFils: 3_000 },
  { emirate: 'AUH', area: 'Al Reem Island', travelFeeFils: 1_500 },
  { emirate: 'DXB', area: 'Marina', travelFeeFils: 5_000 },
];
const approved = { status: 'approved' as const, travelBufferMin: 30, minOrderFils: 10_000 };

describe('home services', () => {
  it('matches service modes to locations', () => {
    expect(offersLocation('in_venue', 'venue')).toBe(true);
    expect(offersLocation('in_venue', 'home')).toBe(false);
    expect(offersLocation('home', 'venue')).toBe(false);
    expect(offersLocation('both', 'home')).toBe(true);
  });

  it('prefers a named area over the emirate-wide rule', () => {
    expect(coverageFor(areas, { emirate: 'AUH', area: '  al reem   island ' })?.travelFeeFils).toBe(
      1_500,
    );
    expect(coverageFor(areas, { emirate: 'AUH', area: 'Khalifa City' })?.travelFeeFils).toBe(3_000);
    expect(coverageFor(areas, { emirate: 'DXB', area: 'Deira' })).toBeNull();
    expect(coverageFor(areas, { emirate: 'SHJ', area: 'Marina' })).toBeNull();
  });

  it('returns the travel terms of an allowed visit', () => {
    expect(
      homeVisitTerms({
        profile: approved,
        serviceMode: 'both',
        servicePriceFils: 10_000,
        areas,
        address: { emirate: 'DXB', area: 'Marina' },
      }),
    ).toEqual({ travelFeeFils: 5_000, travelBufferMin: 30 });
  });

  it.each([
    [{ profile: null }, 'HOME_SERVICES_NOT_AVAILABLE'],
    [{ profile: { ...approved, status: 'suspended' as const } }, 'HOME_SERVICES_NOT_AVAILABLE'],
    [{ serviceMode: 'in_venue' as const }, 'LOCATION_NOT_OFFERED'],
    [{ address: { emirate: 'DXB', area: 'Deira' } }, 'ADDRESS_NOT_COVERED'],
    [{ servicePriceFils: 9_999 }, 'BELOW_HOME_MINIMUM'],
  ])('refuses %o with %s', (change, code) => {
    const input = {
      profile: approved,
      serviceMode: 'home' as const,
      servicePriceFils: 20_000,
      areas,
      address: { emirate: 'AUH', area: 'Yas' },
      ...change,
    };
    try {
      homeVisitTerms(input);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(HomeVisitError);
      expect((e as HomeVisitError).code).toBe(code);
    }
  });

  it('adds travel to both buffers', () => {
    expect(withTravel({ durationMin: 60, bufferBeforeMin: 5, bufferAfterMin: 10 }, 30)).toEqual({
      durationMin: 60,
      bufferBeforeMin: 35,
      bufferAfterMin: 40,
    });
  });

  it('allows only the defined review transitions', () => {
    expect(homeServiceDecision('pending', 'approve')).toBe('approved');
    expect(homeServiceDecision('pending', 'reject')).toBe('rejected');
    expect(homeServiceDecision('approved', 'suspend')).toBe('suspended');
    expect(homeServiceDecision('suspended', 'reinstate')).toBe('approved');
    expect(homeServiceDecision('draft', 'approve')).toBeNull();
    expect(homeServiceDecision('approved', 'approve')).toBeNull();
  });
});
