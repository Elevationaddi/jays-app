import {
  BUSINESS_PERMISSIONS,
  type BusinessPermission,
  PLATFORM_ROLES,
  type PlatformRole,
} from './roles.js';

/**
 * What each business permission allows. Default deny: a capability not listed for any of a
 * member's permissions is refused. Enforced by the API on every business route (ADR-0010).
 */
export const BUSINESS_CAPABILITIES = [
  'business.view',
  'business.edit',
  'modes.manage',
  'members.view',
  'members.manage',
  'catalog.manage',
  'inventory.adjust',
  'orders.fulfill',
  'bookings.schedule',
  'appointments.view_all',
  'appointments.view_own',
  'finance.view',
  'payouts.manage',
  // Phase 2. Legal profile, private verification documents, agreement and submission: owner only
  // (docs/03-business.md: private documents visible only to authorised reviewers and the owner).
  'onboarding.manage',
  // Storefront content and its media.
  'storefront.manage',
  // Phase 4. Branches, services, staff profiles, shifts and schedule blocks.
  'services.manage',
  'returns.manage',
  'reviews.respond',
  'dashboard.view',
] as const;
export type BusinessCapability = (typeof BUSINESS_CAPABILITIES)[number];

const MANAGER: readonly BusinessCapability[] = [
  'business.view',
  'business.edit',
  'members.view',
  'members.manage',
  'catalog.manage',
  'inventory.adjust',
  'orders.fulfill',
  'bookings.schedule',
  'appointments.view_all',
  'appointments.view_own',
  'storefront.manage',
  'services.manage',
  'returns.manage',
  'reviews.respond',
  'dashboard.view',
];

export const BUSINESS_GRANTS: Record<BusinessPermission, readonly BusinessCapability[]> = {
  owner: BUSINESS_CAPABILITIES,
  manager: MANAGER,
  fulfillment: ['business.view', 'inventory.adjust', 'orders.fulfill', 'returns.manage'],
  scheduler: ['business.view', 'bookings.schedule', 'appointments.view_all'],
  finance: ['business.view', 'finance.view', 'dashboard.view'],
  // Staff see their own appointments unless granted a manager permission (docs/03-business.md).
  professional: ['business.view', 'appointments.view_own'],
};

export function isBusinessPermission(value: unknown): value is BusinessPermission {
  return typeof value === 'string' && (BUSINESS_PERMISSIONS as readonly string[]).includes(value);
}

export function businessCapabilities(
  permissions: readonly string[],
): ReadonlySet<BusinessCapability> {
  const result = new Set<BusinessCapability>();
  for (const permission of permissions) {
    if (!isBusinessPermission(permission)) continue; // unknown values grant nothing
    for (const capability of BUSINESS_GRANTS[permission]) result.add(capability);
  }
  return result;
}

export function hasBusinessCapability(
  permissions: readonly string[],
  capability: BusinessCapability,
): boolean {
  return businessCapabilities(permissions).has(capability);
}

/** Permissions a manager may hand out. Owner, manager and finance can only be granted by an owner. */
export const MANAGER_GRANTABLE: readonly BusinessPermission[] = [
  'fulfillment',
  'scheduler',
  'professional',
];

/**
 * Can an actor with `actorPermissions` set a member's permissions from `current` to `next`?
 * `current` is empty for a new invite. Returns the reason when refused.
 */
export function canAssignPermissions(
  actorPermissions: readonly string[],
  current: readonly string[],
  next: readonly string[],
): { allowed: true } | { allowed: false; reason: string } {
  if (next.some((p) => !isBusinessPermission(p))) {
    return { allowed: false, reason: 'Unknown permission.' };
  }
  if (actorPermissions.includes('owner')) return { allowed: true };
  if (!hasBusinessCapability(actorPermissions, 'members.manage')) {
    return { allowed: false, reason: 'You cannot manage team members.' };
  }
  const touched = [...current, ...next];
  if (touched.some((p) => !(MANAGER_GRANTABLE as readonly string[]).includes(p))) {
    return {
      allowed: false,
      reason: 'Only an owner can grant or change owner, manager or finance permissions.',
    };
  }
  return { allowed: true };
}

/** Platform admin capabilities. superadmin holds all of them. */
export const PLATFORM_CAPABILITIES = [
  'admins.manage',
  'audit.view',
  // Phase 2 (ADR-0012).
  'businesses.view',
  'businesses.review',
  'businesses.suspend',
  'documents.view',
  'storefronts.review',
  'taxonomy.manage',
  // Phase 3 (ADR-0013): listing review and takedowns.
  'products.view',
  'products.review',
  'products.takedown',
  // Phase 4 (ADR-0014): booking monitoring and service takedowns.
  'bookings.view',
  'services.takedown',
  // Phase 5 (ADR-0015): finance. View money, issue and approve refunds, manage fee rules,
  // settings, payout holds, disputes, payout runs and reconciliation.
  'finance.view',
  'finance.refund',
  'finance.manage',
  'orders.view',
  'reviews.moderate',
  'support.handle',
  'notifications.manage',
  'exports.run',
] as const;
export type PlatformCapability = (typeof PLATFORM_CAPABILITIES)[number];

export const PLATFORM_GRANTS: Record<PlatformRole, readonly PlatformCapability[]> = {
  superadmin: PLATFORM_CAPABILITIES,
  compliance: [
    'audit.view',
    'businesses.view',
    'businesses.review',
    'businesses.suspend',
    'documents.view',
    'storefronts.review',
    'products.view',
    'products.takedown',
    'bookings.view',
    'services.takedown',
    'finance.view',
    'orders.view',
    'reviews.moderate',
    'exports.run',
  ],
  catalog: [
    'businesses.view',
    'storefronts.review',
    'taxonomy.manage',
    'products.view',
    'products.review',
    'products.takedown',
    'services.takedown',
    'reviews.moderate',
  ],
  operations: [
    'businesses.view',
    'businesses.suspend',
    'products.view',
    'bookings.view',
    'services.takedown',
    'orders.view',
    'support.handle',
    'notifications.manage',
  ],
  finance: [
    'businesses.view',
    'bookings.view',
    'finance.view',
    'finance.refund',
    'finance.manage',
    'orders.view',
    'exports.run',
  ],
  // Support can request refunds; above the threshold a second admin must approve (T16).
  support: [
    'businesses.view',
    'products.view',
    'bookings.view',
    'finance.view',
    'finance.refund',
    'orders.view',
    'reviews.moderate',
    'support.handle',
  ],
  analyst: ['finance.view', 'orders.view', 'exports.run'],
};

export function isPlatformRole(value: unknown): value is PlatformRole {
  return typeof value === 'string' && (PLATFORM_ROLES as readonly string[]).includes(value);
}

export function hasPlatformCapability(
  roles: readonly string[],
  capability: PlatformCapability,
): boolean {
  return roles.some((role) => isPlatformRole(role) && PLATFORM_GRANTS[role].includes(capability));
}
