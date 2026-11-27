/** The seven emirates. Which are offered to users is an admin setting (ADR-0007, D11). */
export const EMIRATE_CODES = ['AUH', 'DXB', 'SHJ', 'AJM', 'UAQ', 'RAK', 'FUJ'] as const;
export type EmirateCode = (typeof EMIRATE_CODES)[number];

export function isEmirateCode(value: unknown): value is EmirateCode {
  return typeof value === 'string' && (EMIRATE_CODES as readonly string[]).includes(value);
}
