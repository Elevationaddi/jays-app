/**
 * Access model from docs/01-product.md and docs/03-business.md / 04-admin.md.
 * Three top-level roles; business staff are permission-scoped members, not a fourth role.
 * Enforcement lives in the API; capabilities per permission are in access.ts.
 */
export const TOP_LEVEL_ROLES = ['customer', 'business', 'admin'] as const;
export type TopLevelRole = (typeof TOP_LEVEL_ROLES)[number];

export const BUSINESS_PERMISSIONS = [
  'owner',
  'manager',
  'fulfillment',
  'scheduler',
  'finance',
  'professional',
] as const;
export type BusinessPermission = (typeof BUSINESS_PERMISSIONS)[number];

export const PLATFORM_ROLES = [
  'superadmin',
  'compliance',
  'catalog',
  'operations',
  'finance',
  'support',
  'analyst',
] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];
