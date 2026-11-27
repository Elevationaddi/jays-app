import { describe, expect, it } from 'vitest';
import { catalogs, t } from './messages.js';
import { negotiateLocale, textDirection } from './locales.js';

describe('catalogs', () => {
  it('have identical keys in English and Arabic', () => {
    expect(Object.keys(catalogs.ar).sort()).toEqual(Object.keys(catalogs.en).sort());
  });

  it('have no empty strings', () => {
    for (const catalog of Object.values(catalogs)) {
      for (const value of Object.values(catalog)) expect(value.trim()).not.toBe('');
    }
  });

  it('translate keys', () => {
    expect(t('en', 'mode.shop')).toBe('Shop Products');
    expect(t('ar', 'mode.shop')).not.toBe('Shop Products');
  });
});

describe('direction and negotiation', () => {
  it('uses RTL for Arabic only', () => {
    expect(textDirection('ar')).toBe('rtl');
    expect(textDirection('en')).toBe('ltr');
  });

  it.each([
    [undefined, 'en'],
    ['ar-AE,ar;q=0.9,en;q=0.8', 'ar'],
    ['fr-FR,en;q=0.5,ar;q=0.9', 'ar'],
    ['fr-FR', 'en'],
    ['en-GB', 'en'],
  ] as const)('%s -> %s', (header, expected) => {
    expect(negotiateLocale(header)).toBe(expected);
  });
});
