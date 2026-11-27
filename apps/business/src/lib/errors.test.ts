import { describe, expect, it } from 'vitest';
import { safeReturnTo } from './api';
import { errorMessageKey } from './errors';

describe('errorMessageKey', () => {
  it('maps known codes and falls back for unknown ones', () => {
    expect(errorMessageKey('OTP_EXPIRED')).toBe('auth.error.otpExpired');
    expect(errorMessageKey('SOMETHING_NEW')).toBe('common.error');
    expect(errorMessageKey(undefined)).toBeNull();
  });

  it('explains onboarding and upload refusals instead of a generic error', () => {
    expect(errorMessageKey('ONBOARDING_INCOMPLETE')).toBe('error.onboardingIncomplete');
    expect(errorMessageKey('FILE_INFECTED')).toBe('error.fileInfected');
    expect(errorMessageKey('IMAGE_DIMENSIONS')).toBe('error.imageDimensions');
    expect(errorMessageKey('IN_REVIEW')).toBe('error.inReview');
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
