import { describe, expect, it } from 'vitest';
import { resolveLocale } from './locale';

describe('resolveLocale', () => {
  it('prefers a valid cookie over the header', () => {
    expect(resolveLocale('ar', 'en-US')).toBe('ar');
  });

  it('ignores an invalid cookie', () => {
    expect(resolveLocale('fr', 'ar-AE')).toBe('ar');
    expect(resolveLocale(undefined, null)).toBe('en');
  });
});
