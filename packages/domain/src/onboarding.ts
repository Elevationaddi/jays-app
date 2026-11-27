import type { PlatformCapability } from './access.js';
import type { Mode } from './modes.js';
import { DEFAULT_TIMEZONE } from './time.js';

/**
 * Merchant onboarding and review (docs/03-business.md, docs/04-admin.md).
 *
 * Business: draft → submitted → under_review → approved | rejected; rejected → submitted
 * (resubmission); approved ⇄ suspended. Each mode is reviewed on its own:
 * onboarding → pending_review → active | rejected; rejected → pending_review.
 * Nothing is public unless the business is approved and the mode is active.
 */
export const BUSINESS_STATUSES = [
  'draft',
  'submitted',
  'under_review',
  'approved',
  'rejected',
  'suspended',
] as const;
export type BusinessStatus = (typeof BUSINESS_STATUSES)[number];

export const MODE_STATUSES = [
  'onboarding',
  'pending_review',
  'active',
  'rejected',
  'suspended',
] as const;
export type ModeStatus = (typeof MODE_STATUSES)[number];

/** Placeholder merchant agreement version until the founder approves the text (ADR-0007, D13). */
export const MERCHANT_AGREEMENT_VERSION = 'merchant-draft-2026-11';

/** Admin actions on a business: a typed allowlist (docs/07-api.md). */
export const BUSINESS_REVIEW_ACTIONS = [
  'start_review',
  'approve',
  'reject',
  'approve_mode',
  'reject_mode',
  'suspend',
  'reactivate',
  'approve_storefront_changes',
  'reject_storefront_changes',
] as const;
export type BusinessReviewAction = (typeof BUSINESS_REVIEW_ACTIONS)[number];

/** Actions that must carry a written reason (destructive or reversing a decision). */
export const ACTIONS_REQUIRING_REASON: readonly BusinessReviewAction[] = [
  'reject',
  'reject_mode',
  'suspend',
  'reactivate',
  'reject_storefront_changes',
];

/** Business status each action needs, and the status it leads to (null = unchanged). */
export const BUSINESS_TRANSITIONS: Record<
  BusinessReviewAction,
  { from: readonly BusinessStatus[]; to: BusinessStatus | null }
> = {
  start_review: { from: ['submitted'], to: 'under_review' },
  approve: { from: ['under_review'], to: 'approved' },
  reject: { from: ['under_review'], to: 'rejected' },
  approve_mode: { from: ['approved', 'suspended'], to: null },
  reject_mode: { from: ['approved', 'suspended'], to: null },
  suspend: { from: ['approved'], to: 'suspended' },
  reactivate: { from: ['suspended'], to: 'approved' },
  approve_storefront_changes: { from: ['approved', 'suspended'], to: null },
  reject_storefront_changes: { from: ['approved', 'suspended'], to: null },
};

/** Which platform capability each review action needs (ADR-0012). */
export const ACTION_CAPABILITY: Record<BusinessReviewAction, PlatformCapability> = {
  start_review: 'businesses.review',
  approve: 'businesses.review',
  reject: 'businesses.review',
  approve_mode: 'businesses.review',
  reject_mode: 'businesses.review',
  suspend: 'businesses.suspend',
  reactivate: 'businesses.suspend',
  approve_storefront_changes: 'storefronts.review',
  reject_storefront_changes: 'storefronts.review',
};

export function canApplyAction(status: BusinessStatus, action: BusinessReviewAction): boolean {
  return BUSINESS_TRANSITIONS[action].from.includes(status);
}

/** The merchant can edit the legal profile and documents only before review or after rejection. */
export function legalProfileEditable(status: BusinessStatus): boolean {
  return status === 'draft' || status === 'rejected';
}

/**
 * Submitting: a draft or rejected business goes to `submitted` with its onboarding modes. An
 * approved (or suspended) business can submit a newly activated or previously rejected mode on
 * its own, without leaving `approved`.
 */
export function submissionTarget(
  status: BusinessStatus,
  modes: Partial<Record<Mode, ModeStatus>>,
):
  | { ok: true; businessStatus: BusinessStatus; modes: Mode[] }
  | { ok: false; reason: 'IN_REVIEW' | 'NOTHING_TO_SUBMIT' } {
  if (status === 'submitted' || status === 'under_review')
    return { ok: false, reason: 'IN_REVIEW' };
  const submittable = (Object.entries(modes) as [Mode, ModeStatus][])
    .filter(([, s]) => s === 'onboarding' || s === 'rejected')
    .map(([m]) => m)
    .sort();
  if (status === 'draft' || status === 'rejected') {
    // A resubmission also re-sends modes still pending from before.
    const resend = (Object.entries(modes) as [Mode, ModeStatus][])
      .filter(([, s]) => s === 'pending_review')
      .map(([m]) => m);
    const all = [...new Set([...submittable, ...resend])].sort();
    if (all.length === 0) return { ok: false, reason: 'NOTHING_TO_SUBMIT' };
    return { ok: true, businessStatus: 'submitted', modes: all };
  }
  if (submittable.length === 0) return { ok: false, reason: 'NOTHING_TO_SUBMIT' };
  return { ok: true, businessStatus: status, modes: submittable };
}

/** Public visibility: approved business and active mode. Suspension hides it at once. */
export function isPubliclyVisible(businessStatus: BusinessStatus, modeStatus: ModeStatus): boolean {
  return businessStatus === 'approved' && modeStatus === 'active';
}

/** Today's calendar date (YYYY-MM-DD) in the UAE, for licence expiry checks. */
export function uaeDate(instant: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** A licence is valid through its expiry date (UAE local date). */
export function licenseValid(expiry: string, now: Date): boolean {
  return expiry >= uaeDate(now);
}

/** UAE tax registration number: 15 digits. */
export function isTaxRegistrationNumber(value: string): boolean {
  return /^[0-9]{15}$/.test(value);
}

export const ONBOARDING_ITEMS = [
  'legal_name',
  'trade_license',
  'license_valid',
  'address',
  'tax_registration',
  'license_document',
  'tax_document',
  'storefront_name',
  'storefront_description',
  'agreement',
  'mode',
] as const;
export type OnboardingItem = (typeof ONBOARDING_ITEMS)[number];

export interface OnboardingFacts {
  legalName: string | null;
  tradeLicenseNumber: string | null;
  licenseAuthority: string | null;
  licenseExpiry: string | null;
  address: {
    emirate: string | null;
    area: string | null;
    street: string | null;
    building: string | null;
  };
  taxRegistered: boolean;
  taxId: string | null;
  /** Kinds of documents that passed validation and malware scanning. */
  cleanDocumentKinds: readonly string[];
  storefrontName: { en: string; ar: string } | null;
  storefrontDescription: { en: string; ar: string } | null;
  agreementVersion: string | null;
  modes: Partial<Record<Mode, ModeStatus>>;
}

/**
 * The checklist the business portal shows, and the server's submission check. Each item is done or
 * missing; submission needs every applicable item done.
 */
export function onboardingChecklist(
  facts: OnboardingFacts,
  now: Date,
): { item: OnboardingItem; done: boolean }[] {
  const has = (value: string | null | undefined) =>
    typeof value === 'string' && value.trim() !== '';
  const items: { item: OnboardingItem; done: boolean; applies: boolean }[] = [
    { item: 'legal_name', done: has(facts.legalName), applies: true },
    {
      item: 'trade_license',
      done:
        has(facts.tradeLicenseNumber) && has(facts.licenseAuthority) && has(facts.licenseExpiry),
      applies: true,
    },
    {
      item: 'license_valid',
      done: facts.licenseExpiry !== null && licenseValid(facts.licenseExpiry, now),
      applies: true,
    },
    {
      item: 'address',
      done:
        has(facts.address.emirate) &&
        has(facts.address.area) &&
        has(facts.address.street) &&
        has(facts.address.building),
      applies: true,
    },
    {
      item: 'tax_registration',
      done: facts.taxId !== null && isTaxRegistrationNumber(facts.taxId),
      applies: facts.taxRegistered,
    },
    {
      item: 'license_document',
      done: facts.cleanDocumentKinds.includes('trade_license'),
      applies: true,
    },
    {
      item: 'tax_document',
      done: facts.cleanDocumentKinds.includes('tax_certificate'),
      applies: facts.taxRegistered,
    },
    { item: 'storefront_name', done: facts.storefrontName !== null, applies: true },
    { item: 'storefront_description', done: facts.storefrontDescription !== null, applies: true },
    {
      item: 'agreement',
      done: facts.agreementVersion === MERCHANT_AGREEMENT_VERSION,
      applies: true,
    },
    {
      item: 'mode',
      done: Object.values(facts.modes).some((s) => s !== undefined),
      applies: true,
    },
  ];
  return items.filter((i) => i.applies).map(({ item, done }) => ({ item, done }));
}

export function missingItems(facts: OnboardingFacts, now: Date): OnboardingItem[] {
  return onboardingChecklist(facts, now)
    .filter((i) => !i.done)
    .map((i) => i.item);
}
