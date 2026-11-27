import type { MyMembership } from '@jays/contracts';

/**
 * Picks the workspace to show: an explicit choice if it is still one of the user's active
 * memberships, else the first active one. Membership comes from the API, never from the cookie.
 */
export function pickWorkspace(
  memberships: MyMembership[],
  preferredId: string | undefined,
): MyMembership | undefined {
  const active = memberships.filter((m) => m.status === 'active');
  return active.find((m) => m.business.id === preferredId) ?? active[0];
}

/** Parses an AED amount typed in a form ("12", "12.5", "12.50") into integer fils. */
export function parseAed(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? '')
    .trim()
    .replace(/,/g, '');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(text)) return null;
  const [whole, frac = ''] = text.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}
