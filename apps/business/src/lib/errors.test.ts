import { describe, expect, it } from 'vitest';
import { safeReturnTo } from './api';
import { errorMessageKey } from './errors';

describe('errorMessageKey', () => {
  it('maps known codes and falls back for unknown ones', () => {
    expect(errorMessageKey('OTP_EXPIRED')).toBe('auth.error.otpExpired');
    expect(errorMessageKey('SOMETHING_NEW')).toBe('common.error');
    expect(errorMessageKey(undefined)).toBeNull();
  });
});

describe('safeReturnTo', () => {
  it('only allows same-site paths', () => {
    expect(safeReturnTo('/business/gateway')).toBe('/business/gateway');
    expect(safeReturnTo('//evil.example')).toBe('/');
    expect(safeReturnTo('https://evil.example')).toBe('/');
    expect(safeReturnTo('/\\evil.example')).toBe('/');
    expect(safeReturnTo(null, '/x')).toBe('/x');
  });
});
