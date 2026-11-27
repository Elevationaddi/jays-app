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

describe('interpolation', () => {
  it('fills placeholders in both languages and keeps the same placeholders', () => {
    expect(t('en', 'gateway.greeting', { name: 'Layla' })).toBe('Hello, Layla');
    expect(t('ar', 'gateway.greeting', { name: 'ليلى' })).toContain('ليلى');
    const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(catalogs.en) as (keyof typeof catalogs.en)[]) {
      expect(placeholders(catalogs.ar[key])).toEqual(placeholders(catalogs.en[key]));
    }
  });
});
