import { describe, expect, it } from 'vitest';
import {
  BUSINESS_REVIEW_ACTIONS,
  canApplyAction,
  isPubliclyVisible,
  legalProfileEditable,
  licenseValid,
  MERCHANT_AGREEMENT_VERSION,
  missingItems,
  type OnboardingFacts,
  submissionTarget,
  uaeDate,
} from './onboarding.js';

const complete: OnboardingFacts = {
  legalName: 'Fictional Trading LLC',
  tradeLicenseNumber: 'CN-1234567',
  licenseAuthority: 'Fictional Economic Department',
  licenseExpiry: '2099-12-31',
  address: { emirate: 'DXB', area: 'Al Barsha', street: '1 Example St', building: 'Tower A' },
  taxRegistered: false,
  taxId: null,
  cleanDocumentKinds: ['trade_license'],
  storefrontName: { en: 'Store', ar: 'متجر' },
  storefrontDescription: { en: 'About', ar: 'نبذة' },
  agreementVersion: MERCHANT_AGREEMENT_VERSION,
  modes: { shop: 'onboarding' },
};
const now = new Date('2026-11-27T12:00:00Z');

describe('onboarding checklist', () => {
  it('is complete for a complete profile', () => {
    expect(missingItems(complete, now)).toEqual([]);
  });

  it('asks for the tax number and certificate only when tax registered', () => {
    expect(missingItems({ ...complete, taxRegistered: true }, now)).toEqual([
      'tax_registration',
      'tax_document',
    ]);
    expect(
      missingItems(
        {
          ...complete,
          taxRegistered: true,
          taxId: '100000000000003',
          cleanDocumentKinds: ['trade_license', 'tax_certificate'],
        },
        now,
      ),
    ).toEqual([]);
  });

  it('needs a clean licence document, a valid licence and the current agreement', () => {
    expect(
      missingItems(
        {
          ...complete,
          cleanDocumentKinds: [],
          licenseExpiry: '2026-11-26',
          agreementVersion: 'old',
        },
        now,
      ),
    ).toEqual(['license_valid', 'license_document', 'agreement']);
  });
});

describe('licence expiry uses the UAE calendar date', () => {
  it('treats the expiry day as still valid and the next day as expired', () => {
    // 2026-11-27T21:00Z is already 28 November in Dubai (UTC+4).
    const lateEvening = new Date('2026-11-27T21:00:00Z');
    expect(uaeDate(lateEvening)).toBe('2026-11-28');
    expect(licenseValid('2026-11-28', lateEvening)).toBe(true);
    expect(licenseValid('2026-11-27', lateEvening)).toBe(false);
  });
});

describe('state machine', () => {
  it('only allows listed transitions', () => {
    expect(canApplyAction('submitted', 'start_review')).toBe(true);
    expect(canApplyAction('submitted', 'approve')).toBe(false);
    expect(canApplyAction('draft', 'approve')).toBe(false);
    expect(canApplyAction('under_review', 'approve')).toBe(true);
    expect(canApplyAction('approved', 'suspend')).toBe(true);
    expect(canApplyAction('suspended', 'reactivate')).toBe(true);
    expect(canApplyAction('rejected', 'approve')).toBe(false);
    // Nothing approves a draft directly.
    for (const action of BUSINESS_REVIEW_ACTIONS) {
      expect(canApplyAction('draft', action)).toBe(false);
    }
  });

  it('locks the legal profile during review and after approval', () => {
    expect(legalProfileEditable('draft')).toBe(true);
    expect(legalProfileEditable('rejected')).toBe(true);
    for (const s of ['submitted', 'under_review', 'approved', 'suspended'] as const) {
      expect(legalProfileEditable(s)).toBe(false);
    }
  });

  it('submits a draft with its onboarding modes, and a new mode of an approved business alone', () => {
    expect(submissionTarget('draft', { shop: 'onboarding' })).toEqual({
      ok: true,
      businessStatus: 'submitted',
      modes: ['shop'],
    });
    expect(submissionTarget('rejected', { shop: 'rejected', services: 'pending_review' })).toEqual({
      ok: true,
      businessStatus: 'submitted',
      modes: ['services', 'shop'],
    });
    expect(submissionTarget('approved', { shop: 'active', services: 'onboarding' })).toEqual({
      ok: true,
      businessStatus: 'approved',
      modes: ['services'],
    });
    expect(submissionTarget('approved', { shop: 'active' })).toEqual({
      ok: false,
      reason: 'NOTHING_TO_SUBMIT',
    });
    expect(submissionTarget('under_review', { shop: 'pending_review' })).toEqual({
      ok: false,
      reason: 'IN_REVIEW',
    });
  });

  it('is public only when approved and the mode is active (T02)', () => {
    expect(isPubliclyVisible('approved', 'active')).toBe(true);
    expect(isPubliclyVisible('approved', 'pending_review')).toBe(false);
    expect(isPubliclyVisible('suspended', 'active')).toBe(false);
    expect(isPubliclyVisible('under_review', 'active')).toBe(false);
  });
});
