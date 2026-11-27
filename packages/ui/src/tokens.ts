/**
 * Working design tokens from docs/08-design.md: warm white surfaces, charcoal text and a muted
 * plum accent. These are proposed, not the final brand (docs/adr/0007).
 */
export const colors = {
  surface: '#FBF8F4',
  surfaceRaised: '#FFFFFF',
  border: '#E4DED6',
  text: '#26221F',
  textMuted: '#5E5751',
  accent: '#6B3F5E',
  accentHover: '#56304B',
  onAccent: '#FFFFFF',
  danger: '#A12A2A',
  success: '#2D6A3E',
} as const;

/** 8-point spacing scale in px. */
export const spacing = { 0: 0, 1: 8, 2: 16, 3: 24, 4: 32, 5: 40, 6: 48, 8: 64 } as const;

export const typography = {
  minBodySize: 16,
  fontFamilyLatin: "'Inter', system-ui, sans-serif",
  fontFamilyArabic: "'IBM Plex Sans Arabic', 'Noto Sans Arabic', system-ui, sans-serif",
} as const;

/** Minimum touch target in points (docs/08-design.md). */
export const minTouchTarget = 44;

export const radius = { sm: 6, md: 12, lg: 20 } as const;
