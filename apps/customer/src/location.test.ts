import { describe, expect, it } from 'vitest';
import { FALLBACK_EMIRATES, nearestEmirate } from './location';

describe('nearestEmirate', () => {
  it.each([
    [25.2048, 55.2708, 'DXB'], // Dubai downtown
    [24.4539, 54.3773, 'AUH'], // Abu Dhabi city
    [25.3463, 55.4209, 'SHJ'], // Sharjah city
    [25.7895, 55.9432, 'RAK'], // Ras Al Khaimah city
    [25.1288, 56.3265, 'FUJ'], // Fujairah city
  ] as const)('%f, %f is %s', (lat, lng, code) => {
    expect(nearestEmirate(lat, lng)).toBe(code);
  });

  it('bundles all seven emirates for offline manual choice', () => {
    expect(FALLBACK_EMIRATES).toHaveLength(7);
  });
});
