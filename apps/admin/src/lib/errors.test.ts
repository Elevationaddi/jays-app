import { describe, expect, it } from 'vitest';
import { safeReturnTo } from './api';
import { errorMessageKey } from './errors';

describe('admin console helpers', () => {
  it('maps API errors to copy', () => {
    expect(errorMessageKey('INVALID_CREDENTIALS')).toBe('auth.error.invalidCredentials');
    expect(errorMessageKey('RATE_LIMITED')).toBe('auth.error.rateLimited');
  });

  it('refuses off-site return paths', () => {
    expect(safeReturnTo('//evil.example', '/admin/dashboard')).toBe('/admin/dashboard');
    expect(safeReturnTo('/admin/security')).toBe('/admin/security');
  });
});
