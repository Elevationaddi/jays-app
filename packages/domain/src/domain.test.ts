import { describe, expect, it } from 'vitest';
import { DEFAULT_TIMEZONE, formatInTimezone } from './time.js';
import { isMode } from './modes.js';

describe('modes', () => {
  it('recognises only shop and services', () => {
    expect(isMode('shop')).toBe(true);
    expect(isMode('services')).toBe(true);
    expect(isMode('admin')).toBe(false);
    expect(isMode(undefined)).toBe(false);
  });
});

describe('formatInTimezone', () => {
  it('shows a UTC instant as Dubai wall-clock time (UTC+4) across midnight', () => {
    const instant = new Date('2027-01-01T21:30:00Z');
    const text = formatInTimezone(instant, DEFAULT_TIMEZONE, 'en', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    expect(text).toContain('02');
    expect(text).toContain('01:30');
  });
});
