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

/** The two management experiences of a business (founder brief: Manage Products / Services). */
export type WorkspaceMode = 'shop' | 'services';
export const WORKSPACE_MODE_COOKIE = 'workspace_mode';

/** Tabs that belong to one mode. Every other tab (dashboard, storefront, finance…) is shared. */
export const MODE_TABS: Record<WorkspaceMode, readonly string[]> = {
  shop: ['products', 'inventory', 'delivery', 'orders', 'returns'],
  services: ['calendar', 'services', 'staff'],
};

type ModeStatus = string;

/**
 * Which management experience a page belongs to: the mode of its tab if it has one, else the
 * mode the member last chose (cookie), else the first activated mode. A mode that is not
 * activated is never picked while the other one is.
 */
export function resolveMode(
  tab: string,
  modes: Record<WorkspaceMode, ModeStatus>,
  preferred: string | undefined,
): WorkspaceMode {
  const activated = (m: WorkspaceMode) => modes[m] !== 'not_activated';
  if (MODE_TABS.shop.includes(tab)) return 'shop';
  if (MODE_TABS.services.includes(tab)) return 'services';
  if ((preferred === 'shop' || preferred === 'services') && activated(preferred)) return preferred;
  return activated('shop') || !activated('services') ? 'shop' : 'services';
}

/** The first page of a mode's workspace, for the mode switch and the gateway. */
export function modeHome(
  businessId: string,
  mode: WorkspaceMode,
  capabilities: readonly string[],
): string {
  if (mode === 'shop') {
    const first = [
      ['catalog.manage', 'products'],
      ['orders.fulfill', 'orders'],
      ['inventory.adjust', 'inventory'],
    ].find(([cap]) => capabilities.includes(cap as string));
    return `/business/${businessId}/${first?.[1] ?? 'dashboard'}`;
  }
  const first = [
    ['appointments.view_all', 'calendar'],
    ['appointments.view_own', 'calendar'],
    ['services.manage', 'services'],
  ].find(([cap]) => capabilities.includes(cap as string));
  return `/business/${businessId}/${first?.[1] ?? 'dashboard'}`;
}
