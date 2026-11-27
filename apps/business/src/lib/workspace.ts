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
