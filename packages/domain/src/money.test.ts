import { describe, expect, it } from 'vitest';
import {
  addFils,
  applyBasisPoints,
  fils,
  formatAed,
  MoneyError,
  multiplyFils,
  subtractFils,
} from './money.js';

describe('fils', () => {
  it('accepts non-negative integers', () => {
    expect(fils(0)).toBe(0);
    expect(fils(12000)).toBe(12000);
  });

  it.each([1.5, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects %s',
    (value) => {
      expect(() => fils(value)).toThrow(MoneyError);
    },
  );
});

describe('arithmetic', () => {
  it('adds, subtracts and multiplies without leaving integers', () => {
    expect(addFils(fils(100), fils(250), fils(5))).toBe(355);
    expect(subtractFils(fils(1000), fils(1))).toBe(999);
    expect(multiplyFils(fils(1299), 3)).toBe(3897);
  });

  it('never goes negative', () => {
    expect(() => subtractFils(fils(1), fils(2))).toThrow(MoneyError);
  });

  it('rejects fractional quantities', () => {
    expect(() => multiplyFils(fils(100), 1.5)).toThrow(MoneyError);
  });
});

describe('applyBasisPoints', () => {
  // 1250 bps (12.5%) of 1 fils steps lands exactly on halves for some amounts.
  it.each([
    // amount, bps, mode, expected
    [10000, 1500, 'half_up', 1500],
    [333, 1000, 'down', 33],
    [333, 1000, 'up', 34],
    [4, 1250, 'half_up', 1], // 0.5 -> 1
    [4, 1250, 'half_even', 0], // 0.5 -> 0 (even)
    [12, 1250, 'half_even', 2], // 1.5 -> 2 (even)
    [12, 1250, 'half_up', 2],
    [5, 1000, 'half_up', 1], // 0.5 -> 1
    [5, 1000, 'down', 0],
  ] as const)('%i fils at %i bps rounded %s = %i', (amount, bps, mode, expected) => {
    expect(applyBasisPoints(fils(amount), bps, mode)).toBe(expected);
  });

  it('stays exact for large amounts', () => {
    expect(applyBasisPoints(fils(9_007_199_254_740), 10_000, 'down')).toBe(9_007_199_254_740);
  });

  it('rejects fractional basis points', () => {
    expect(() => applyBasisPoints(fils(100), 12.5, 'down')).toThrow(MoneyError);
  });
});

describe('formatAed', () => {
  it('formats in English and Arabic', () => {
    expect(formatAed(fils(12000), 'en')).toMatch(/120\.00/);
    expect(formatAed(fils(12000), 'ar')).not.toBe('');
  });
});
