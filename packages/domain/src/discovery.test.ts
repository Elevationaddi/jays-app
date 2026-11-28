import { describe, expect, it } from 'vitest';
import { discountPercent, ratingSummary, validCompareAt } from './discovery.js';

describe('discountPercent', () => {
  it('rounds the saving down', () => {
    expect(discountPercent(6_700, 10_000)).toBe(33);
    expect(discountPercent(9_999, 10_000)).toBeNull();
    expect(discountPercent(5_000, 10_000)).toBe(50);
  });
  it('is null without a higher earlier price', () => {
    expect(discountPercent(10_000, null)).toBeNull();
    expect(discountPercent(10_000, 10_000)).toBeNull();
    expect(discountPercent(10_000, 9_000)).toBeNull();
  });
});

describe('validCompareAt', () => {
  it('accepts none or a higher price only', () => {
    expect(validCompareAt(100, null)).toBe(true);
    expect(validCompareAt(100, undefined)).toBe(true);
    expect(validCompareAt(100, 101)).toBe(true);
    expect(validCompareAt(100, 100)).toBe(false);
  });
});

describe('ratingSummary', () => {
  it('averages to one decimal', () => {
    expect(ratingSummary(14, 3)).toEqual({ average: 4.7, count: 3 });
    expect(ratingSummary(0, 0)).toBeNull();
  });
});
