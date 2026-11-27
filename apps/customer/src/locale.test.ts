import { describe, expect, it } from 'vitest';
import { deviceLocale, isRtl } from './locale';

describe('deviceLocale', () => {
  it('uses the first supported device language', () => {
    expect(deviceLocale(['fr-FR', 'ar-AE', 'en-US'])).toBe('ar');
    expect(deviceLocale(['en-GB'])).toBe('en');
  });

  it('falls back to English', () => {
    expect(deviceLocale([])).toBe('en');
    expect(deviceLocale(['de-DE'])).toBe('en');
  });

  it('marks Arabic as right-to-left', () => {
    expect(isRtl('ar')).toBe(true);
    expect(isRtl('en')).toBe(false);
  });
});
