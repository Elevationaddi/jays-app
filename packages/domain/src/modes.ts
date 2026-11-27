/** The two marketplace experiences. A business can activate either or both independently. */
export const MODES = ['shop', 'services'] as const;
export type Mode = (typeof MODES)[number];

export function isMode(value: unknown): value is Mode {
  return typeof value === 'string' && (MODES as readonly string[]).includes(value);
}
