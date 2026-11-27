import { describe, expect, it } from 'vitest';
import {
  BUSINESS_CAPABILITIES,
  businessCapabilities,
  canAssignPermissions,
  hasBusinessCapability,
  hasPlatformCapability,
} from './access.js';
import { BUSINESS_PERMISSIONS } from './roles.js';

describe('business capabilities', () => {
  it('gives an owner every capability', () => {
    expect([...businessCapabilities(['owner'])].sort()).toEqual([...BUSINESS_CAPABILITIES].sort());
  });

  it('denies by default', () => {
    expect(businessCapabilities([]).size).toBe(0);
    expect(businessCapabilities(['superadmin', 'admin']).size).toBe(0);
  });

  it('only lets an owner manage payouts (staff cannot payout)', () => {
    for (const permission of BUSINESS_PERMISSIONS) {
      expect(hasBusinessCapability([permission], 'payouts.manage')).toBe(permission === 'owner');
    }
  });

  it('keeps professionals to their own appointments', () => {
    expect(hasBusinessCapability(['professional'], 'appointments.view_own')).toBe(true);
    expect(hasBusinessCapability(['professional'], 'appointments.view_all')).toBe(false);
    expect(hasBusinessCapability(['professional', 'manager'], 'appointments.view_all')).toBe(true);
  });

  it('lets finance see finance but not change the team or modes', () => {
    expect(hasBusinessCapability(['finance'], 'finance.view')).toBe(true);
    expect(hasBusinessCapability(['finance'], 'members.manage')).toBe(false);
    expect(hasBusinessCapability(['manager'], 'modes.manage')).toBe(false);
  });
});

describe('canAssignPermissions', () => {
  it('lets an owner grant anything in the vocabulary', () => {
    expect(canAssignPermissions(['owner'], [], ['owner', 'finance'])).toEqual({ allowed: true });
  });

  it('never accepts a permission outside the vocabulary, even from an owner', () => {
    expect(canAssignPermissions(['owner'], [], ['superadmin']).allowed).toBe(false);
  });

  it('limits managers to operational permissions', () => {
    expect(canAssignPermissions(['manager'], [], ['scheduler', 'professional']).allowed).toBe(true);
    expect(canAssignPermissions(['manager'], [], ['manager']).allowed).toBe(false);
    expect(canAssignPermissions(['manager'], [], ['finance']).allowed).toBe(false);
    expect(canAssignPermissions(['manager'], ['owner'], ['scheduler']).allowed).toBe(false);
  });

  it('refuses staff without members.manage', () => {
    expect(canAssignPermissions(['scheduler'], [], ['professional']).allowed).toBe(false);
  });
});

describe('platform capabilities', () => {
  it('reserves admin management for superadmin', () => {
    expect(hasPlatformCapability(['superadmin'], 'admins.manage')).toBe(true);
    expect(hasPlatformCapability(['compliance', 'support'], 'admins.manage')).toBe(false);
    expect(hasPlatformCapability(['compliance'], 'audit.view')).toBe(true);
    expect(hasPlatformCapability(['owner'], 'audit.view')).toBe(false);
  });
});
