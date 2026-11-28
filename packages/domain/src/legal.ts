/**
 * Legal documents (D13, phase 8.8; ADR-0028). Every document is a draft awaiting review by a
 * UAE lawyer: the platform can publish a version so it is shown and accepted, but nothing here
 * marks a document as legally approved, and production refuses to publish an unreviewed one.
 */
/**
 * Whether a UAE lawyer has reviewed the documents. Changing this to true is a founder decision
 * recorded in an ADR, never a configuration switch. While false, production refuses to publish.
 */
export const LEGAL_REVIEW_COMPLETE = false;

export const LEGAL_DOCUMENT_KINDS = [
  'customer_terms',
  'merchant_agreement',
  'privacy_policy',
  'returns_refunds',
  'appointment_cancellation',
  'home_services',
  'marketing_consent',
  'prohibited_items',
  'review_moderation',
  'merchant_licensing',
  'authenticity',
  'promotional_pricing',
] as const;
export type LegalDocumentKind = (typeof LEGAL_DOCUMENT_KINDS)[number];

/** Documents a customer accepts at sign-up and again when a new version is published. */
export const CUSTOMER_REQUIRED_LEGAL: readonly LegalDocumentKind[] = [
  'customer_terms',
  'privacy_policy',
];

/** Documents a business owner accepts before submitting the business for review. */
export const MERCHANT_REQUIRED_LEGAL: readonly LegalDocumentKind[] = ['merchant_agreement'];

export const LEGAL_ACCEPTANCE_SOURCES = ['sign_up', 'reaccept', 'merchant_onboarding'] as const;
export type LegalAcceptanceSource = (typeof LEGAL_ACCEPTANCE_SOURCES)[number];

/** A document body is Markdown in each language, up to this many characters. */
export const LEGAL_BODY_MAX = 60_000;

export interface PublishedVersion {
  kind: LegalDocumentKind;
  version: number;
}

/**
 * Which of the required documents still need the user's acceptance: those with a published
 * version the user has not accepted (an older acceptance does not count).
 */
export function pendingAcceptances(
  required: readonly LegalDocumentKind[],
  published: readonly PublishedVersion[],
  accepted: readonly PublishedVersion[],
): PublishedVersion[] {
  return required.flatMap((kind) => {
    const current = published.find((p) => p.kind === kind);
    if (!current) return [];
    const done = accepted.some((a) => a.kind === kind && a.version === current.version);
    return done ? [] : [current];
  });
}
