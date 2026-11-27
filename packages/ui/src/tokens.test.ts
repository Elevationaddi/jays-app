import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast.js';
import { colors, spacing, typography } from './tokens.js';

describe('contrast', () => {
  it('computes known ratios', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
  });

  // WCAG AA: 4.5:1 for body text.
  it.each([
    ['text', colors.text, colors.surface],
    ['textMuted', colors.textMuted, colors.surface],
    ['accent on surface', colors.accent, colors.surface],
    ['onAccent', colors.onAccent, colors.accent],
    ['onAccent hover', colors.onAccent, colors.accentHover],
    ['danger', colors.danger, colors.surfaceRaised],
    ['success', colors.success, colors.surfaceRaised],
  ])('%s meets AA body contrast', (_name, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('scale', () => {
  it('uses an 8-point grid and 16px minimum body text', () => {
    for (const value of Object.values(spacing)) expect(value % 8).toBe(0);
    expect(typography.minBodySize).toBeGreaterThanOrEqual(16);
  });
});
