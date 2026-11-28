import { describe, expect, it } from 'vitest';
import { dubaiDate, resolveRange } from './dashboards.service.js';

// T14: timezone display and midnight boundaries. Dubai is UTC+4 with no daylight saving.
describe('dubaiDate', () => {
  it.each([
    ['2026-11-27T19:59:59.999Z', '2026-11-27'],
    ['2026-11-27T20:00:00.000Z', '2026-11-28'],
    ['2026-12-31T20:00:00.000Z', '2027-01-01'],
    ['2028-02-28T20:30:00.000Z', '2028-02-29'],
  ])('%s is %s in Dubai', (utc, local) => {
    expect(dubaiDate(new Date(utc))).toBe(local);
  });
});

describe('resolveRange', () => {
  it('turns inclusive Dubai dates into a half-open UTC range starting at Dubai midnight', () => {
    const r = resolveRange({ from: '2026-11-01', to: '2026-11-30' }, new Date());
    expect(r.start.toISOString()).toBe('2026-10-31T20:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-11-30T20:00:00.000Z');
    expect(r.dates).toHaveLength(30);
    expect(r.dates[0]).toBe('2026-11-01');
    expect(r.dates.at(-1)).toBe('2026-11-30');
  });

  it('defaults to the 30 Dubai days ending today, even just after Dubai midnight', () => {
    // 00:30 in Dubai on 28 November is still 27 November in UTC.
    const r = resolveRange({}, new Date('2026-11-27T20:30:00Z'));
    expect(r.to).toBe('2026-11-28');
    expect(r.from).toBe('2026-10-30');
    expect(r.dates).toHaveLength(30);
  });

  it('counts an event at 23:59 Dubai in that day and at 00:00 in the next', () => {
    const r = resolveRange({ from: '2026-11-28', to: '2026-11-28' }, new Date());
    const inRange = (iso: string) => {
      const t = new Date(iso).getTime();
      return t >= r.start.getTime() && t < r.end.getTime();
    };
    expect(inRange('2026-11-27T20:00:00Z')).toBe(true); // 00:00 on the 28th
    expect(inRange('2026-11-28T19:59:59Z')).toBe(true); // 23:59:59 on the 28th
    expect(inRange('2026-11-28T20:00:00Z')).toBe(false); // 00:00 on the 29th
    expect(inRange('2026-11-27T19:59:59Z')).toBe(false); // 23:59:59 on the 27th
  });

  it('accepts one day and 366 days, and refuses reversed or longer ranges', () => {
    expect(resolveRange({ from: '2028-01-01', to: '2028-12-31' }, new Date()).dates).toHaveLength(
      366,
    );
    expect(() => resolveRange({ from: '2026-11-02', to: '2026-11-01' }, new Date())).toThrow();
    expect(() => resolveRange({ from: '2026-01-01', to: '2027-01-02' }, new Date())).toThrow();
  });
});
