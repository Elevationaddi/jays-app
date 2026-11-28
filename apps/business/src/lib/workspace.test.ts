import type { MyMembership } from '@jays/contracts';
import { describe, expect, it } from 'vitest';
import { modeHome, parseAed, pickWorkspace, resolveMode } from './workspace';

const membership = (id: string, status: 'active' | 'invited'): MyMembership => ({
  membershipId: `m-${id}`,
  status,
  permissions: ['owner'],
  business: {
    id,
    displayName: { en: id, ar: id },
    status: 'draft',
    modes: { shop: 'onboarding', services: 'not_activated' },
    myPermissions: ['owner'],
    myCapabilities: ['business.view'],
    createdAt: '2026-11-27T00:00:00.000Z',
  },
});

describe('pickWorkspace', () => {
  it('keeps the chosen business across pages and mode switches (T01)', () => {
    const list = [membership('a', 'active'), membership('b', 'active')];
    expect(pickWorkspace(list, 'b')?.business.id).toBe('b');
  });

  it('ignores a remembered business the user no longer belongs to, or is only invited to', () => {
    const list = [membership('a', 'active'), membership('c', 'invited')];
    expect(pickWorkspace(list, 'gone')?.business.id).toBe('a');
    expect(pickWorkspace(list, 'c')?.business.id).toBe('a');
    expect(pickWorkspace([membership('c', 'invited')], 'c')).toBeUndefined();
  });
});

describe('parseAed', () => {
  it.each([
    ['12', 1200],
    ['12.5', 1250],
    ['12.05', 1205],
    ['1,250.00', 125000],
    ['0', 0],
  ])('%s -> %i fils', (input, expected) => {
    expect(parseAed(input)).toBe(expected);
  });

  it.each(['', '-1', '1.234', 'abc', '1e3', '12345678'])('rejects %s', (input) => {
    expect(parseAed(input)).toBeNull();
  });
});

describe('resolveMode', () => {
  const both = { shop: 'active', services: 'active' } as const;
  it('follows the tab when the tab belongs to a mode', () => {
    expect(resolveMode('orders', both, 'services')).toBe('shop');
    expect(resolveMode('calendar', both, 'shop')).toBe('services');
  });
  it('uses the remembered choice on shared tabs', () => {
    expect(resolveMode('finance', both, 'services')).toBe('services');
    expect(resolveMode('finance', both, undefined)).toBe('shop');
    expect(resolveMode('finance', both, 'nonsense')).toBe('shop');
  });
  it('never picks a mode that is not activated while the other one is', () => {
    const servicesOnly = { shop: 'not_activated', services: 'active' } as const;
    expect(resolveMode('dashboard', servicesOnly, 'shop')).toBe('services');
    expect(resolveMode('dashboard', servicesOnly, undefined)).toBe('services');
    const shopOnly = { shop: 'onboarding', services: 'not_activated' } as const;
    expect(resolveMode('dashboard', shopOnly, 'services')).toBe('shop');
  });
});

describe('modeHome', () => {
  it('opens the first page the member may use in that mode', () => {
    expect(modeHome('b1', 'shop', ['catalog.manage'])).toBe('/business/b1/products');
    expect(modeHome('b1', 'shop', ['orders.fulfill'])).toBe('/business/b1/orders');
    expect(modeHome('b1', 'services', ['appointments.view_own'])).toBe('/business/b1/calendar');
    expect(modeHome('b1', 'services', ['services.manage'])).toBe('/business/b1/services');
  });
  it('falls back to the dashboard', () => {
    expect(modeHome('b1', 'services', [])).toBe('/business/b1/dashboard');
  });
});
