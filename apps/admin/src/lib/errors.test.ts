import { describe, expect, it } from 'vitest';
import { safeReturnTo } from './api';
import { errorMessageKey } from './errors';

describe('admin console helpers', () => {
  it('maps API errors to copy', () => {
    expect(errorMessageKey('INVALID_CREDENTIALS')).toBe('auth.error.invalidCredentials');
    expect(errorMessageKey('RATE_LIMITED')).toBe('auth.error.rateLimited');
  });

  it('tells a reviewer when someone else acted first or the action does not apply', () => {
    expect(errorMessageKey('VERSION_CONFLICT')).toBe('error.versionConflict');
    expect(errorMessageKey('INVALID_TRANSITION')).toBe('error.invalidTransition');
    expect(errorMessageKey('SLUG_TAKEN')).toBe('error.slugTaken');
  });

  it('refuses off-site return paths', () => {
    expect(safeReturnTo('//evil.example', '/admin/dashboard')).toBe('/admin/dashboard');
    expect(safeReturnTo('/admin/security')).toBe('/admin/security');
  });
});
