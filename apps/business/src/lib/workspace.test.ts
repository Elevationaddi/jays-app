import type { MyMembership } from '@jays/contracts';
import { describe, expect, it } from 'vitest';
import { parseAed, pickWorkspace } from './workspace';

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
