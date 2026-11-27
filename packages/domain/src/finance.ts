import { applyBasisPoints, fils, MoneyError } from './money.js';

/**
 * Money after capture (docs/05-workflows.md, payouts; ADR-0015). Pure rules: commission, fee rule
 * and setting lookup, refund allocation, balanced ledger postings, payout amounts and approvals.
 * All amounts are integer fils; rounding is stated explicitly (half-up, ADR-0007 D4 proposed).
 */

export const FINANCE_MODES = ['shop', 'services'] as const;
export type FinanceMode = (typeof FINANCE_MODES)[number];

export const LEDGER_ACCOUNTS = [
  'psp_clearing',
  'merchant_payable',
  'payouts_in_transit',
  'platform_commission',
  'unallocated_receipts',
] as const;
export type LedgerAccount = (typeof LEDGER_ACCOUNTS)[number];

/** Accounts that belong to one business. */
export const BUSINESS_ACCOUNTS: readonly LedgerAccount[] = [
  'merchant_payable',
  'payouts_in_transit',
];

export const FINANCE_SETTING_KEYS = [
  'refund_approval_threshold_fils',
  'payout_dispute_window_days',
  'payout_minimum_fils',
] as const;
export type FinanceSettingKey = (typeof FINANCE_SETTING_KEYS)[number];

/**
 * Used when no setting row is in force. Proposed defaults, not founder-approved (ADR-0007 D6):
 * refunds above AED 500 need a second approver; payouts wait 7 days after completion or
 * delivery; no minimum payout.
 */
export const FINANCE_SETTING_DEFAULTS: Record<FinanceSettingKey, number> = {
  refund_approval_threshold_fils: 50_000,
  payout_dispute_window_days: 7,
  payout_minimum_fils: 0,
};

export const FINANCE_SETTING_LIMITS: Record<FinanceSettingKey, { min: number; max: number }> = {
  refund_approval_threshold_fils: { min: 0, max: 100_000_000 },
  payout_dispute_window_days: { min: 0, max: 120 },
  payout_minimum_fils: { min: 0, max: 100_000_000 },
};

export interface EffectiveRow {
  effectiveAt: Date;
}

/** The row in force at `at`: the latest one whose effective time is not after `at`. */
export function inForce<T extends EffectiveRow>(rows: readonly T[], at: Date): T | undefined {
  let best: T | undefined;
  for (const row of rows) {
    if (row.effectiveAt.getTime() > at.getTime()) continue;
    if (!best || row.effectiveAt.getTime() > best.effectiveAt.getTime()) best = row;
  }
  return best;
}

export interface FeeRule extends EffectiveRow {
  id: string;
  mode: FinanceMode;
  businessId: string | null;
  commissionBps: number;
}

/**
 * The commission rule for a business and mode at a time. A rule for the business beats the
 * platform rule (docs/06-architecture-data.md: merchant > platform). No rule means no commission.
 */
export function feeRuleFor(
  rules: readonly FeeRule[],
  mode: FinanceMode,
  businessId: string,
  at: Date,
): FeeRule | undefined {
  const forMode = rules.filter((r) => r.mode === mode);
  return (
    inForce(
      forMode.filter((r) => r.businessId === businessId),
      at,
    ) ??
    inForce(
      forMode.filter((r) => r.businessId === null),
      at,
    )
  );
}

export function settingAt(
  rows: readonly (EffectiveRow & { key: FinanceSettingKey; value: number })[],
  key: FinanceSettingKey,
  at: Date,
): number {
  return (
    inForce(
      rows.filter((r) => r.key === key),
      at,
    )?.value ?? FINANCE_SETTING_DEFAULTS[key]
  );
}

/** Commission on the commissionable base, rounded half-up. */
export function commissionFor(baseFils: number, bps: number): number {
  return applyBasisPoints(fils(baseFils), bps, 'half_up');
}

export interface Earning {
  grossFils: number;
  commissionFils: number;
  refundedFils: number;
  commissionRefundedFils: number;
}

/** What the merchant is owed from one earning after refunds. Can be zero, never negative. */
export function netOf(e: Earning): number {
  return e.grossFils - e.commissionFils - (e.refundedFils - e.commissionRefundedFils);
}

/**
 * Splits a refund of `amountFils` against an earning into the merchant's share and the
 * platform's commission share. Commission is returned in proportion to the gross refunded
 * (ADR-0015); the last refund returns whatever commission is left, so rounding never strands
 * a fils.
 */
export function allocateRefund(e: Earning, amountFils: number) {
  if (!Number.isSafeInteger(amountFils) || amountFils <= 0) {
    throw new MoneyError(`Refund must be a positive whole number of fils, got ${amountFils}`);
  }
  const remaining = e.grossFils - e.refundedFils;
  if (amountFils > remaining) {
    throw new MoneyError(`Refund of ${amountFils} exceeds the ${remaining} fils left to refund`);
  }
  const commissionLeft = e.commissionFils - e.commissionRefundedFils;
  let commission: number;
  if (amountFils === remaining) {
    commission = commissionLeft;
  } else {
    const numerator = BigInt(e.commissionFils) * BigInt(amountFils);
    const denominator = BigInt(e.grossFils);
    const q = numerator / denominator;
    const r = numerator % denominator;
    commission = Number(r * 2n >= denominator ? q + 1n : q);
    commission = Math.min(commission, commissionLeft);
  }
  return { merchantFils: amountFils - commission, commissionFils: commission };
}

export interface LedgerLine {
  account: LedgerAccount;
  businessId: string | null;
  debitFils: number;
  creditFils: number;
}

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

/**
 * Checks a posting before it reaches the database (which checks again at commit): positive
 * whole amounts on one side only, business accounts carry a business, debits equal credits.
 * Zero-amount lines are dropped.
 */
export function balanced(lines: readonly LedgerLine[]): LedgerLine[] {
  const kept = lines.filter((l) => l.debitFils !== 0 || l.creditFils !== 0);
  let debits = 0;
  let credits = 0;
  for (const l of kept) {
    if (
      !Number.isSafeInteger(l.debitFils) ||
      !Number.isSafeInteger(l.creditFils) ||
      l.debitFils < 0 ||
      l.creditFils < 0 ||
      (l.debitFils > 0 && l.creditFils > 0)
    ) {
      throw new LedgerError(`Invalid ledger line for ${l.account}`);
    }
    if (BUSINESS_ACCOUNTS.includes(l.account) !== (l.businessId !== null)) {
      throw new LedgerError(`${l.account} needs a business only when it is a business account`);
    }
    debits += l.debitFils;
    credits += l.creditFils;
  }
  if (kept.length < 2 || debits !== credits) {
    throw new LedgerError(`Unbalanced posting: debits ${debits}, credits ${credits}`);
  }
  return kept;
}

const dr = (account: LedgerAccount, businessId: string | null, amount: number): LedgerLine => ({
  account,
  businessId,
  debitFils: amount,
  creditFils: 0,
});
const cr = (account: LedgerAccount, businessId: string | null, amount: number): LedgerLine => ({
  account,
  businessId,
  debitFils: 0,
  creditFils: amount,
});

/** Postings for each money movement. Every one balances by construction. */
export const postings = {
  /** A paid suborder or booking: the money sits at the provider, owed to merchant and platform. */
  capture: (businessId: string, grossFils: number, commissionFils: number) =>
    balanced([
      dr('psp_clearing', null, grossFils),
      cr('merchant_payable', businessId, grossFils - commissionFils),
      cr('platform_commission', null, commissionFils),
    ]),
  /** A payment that arrived after its order or hold ended; it is refunded automatically. */
  lateCapture: (amountFils: number) =>
    balanced([dr('psp_clearing', null, amountFils), cr('unallocated_receipts', null, amountFils)]),
  lateRefund: (amountFils: number) =>
    balanced([dr('unallocated_receipts', null, amountFils), cr('psp_clearing', null, amountFils)]),
  /** A refund or lost dispute, split between the merchant and the commission. */
  reversal: (businessId: string, split: { merchantFils: number; commissionFils: number }) =>
    balanced([
      dr('merchant_payable', businessId, split.merchantFils),
      dr('platform_commission', null, split.commissionFils),
      cr('psp_clearing', null, split.merchantFils + split.commissionFils),
    ]),
  payoutInitiated: (businessId: string, amountFils: number) =>
    balanced([
      dr('merchant_payable', businessId, amountFils),
      cr('payouts_in_transit', businessId, amountFils),
    ]),
  payoutPaid: (businessId: string, amountFils: number) =>
    balanced([
      dr('payouts_in_transit', businessId, amountFils),
      cr('psp_clearing', null, amountFils),
    ]),
  payoutFailed: (businessId: string, amountFils: number) =>
    balanced([
      dr('payouts_in_transit', businessId, amountFils),
      cr('merchant_payable', businessId, amountFils),
    ]),
};

/**
 * How much to pay a business now: the eligible net, capped by the ledger balance it is owed
 * (a negative carry from a chargeback or a refund after payout reduces it). Null when nothing
 * should be paid (nothing owed, or below the minimum).
 */
export function payoutAmount(input: {
  eligibleNetFils: number;
  payableBalanceFils: number;
  minimumFils: number;
}): number | null {
  const amount = Math.min(input.eligibleNetFils, input.payableBalanceFils);
  if (amount <= 0 || amount < input.minimumFils) return null;
  return amount;
}

/** Whether a refund request needs a second, different approver (docs/04-admin.md, T16). */
export function needsSecondApproval(amountFils: number, thresholdFils: number): boolean {
  return amountFils > thresholdFils;
}

export type ApprovalCheck =
  { ok: true } | { ok: false; reason: 'SAME_APPROVER' | 'ALREADY_DECIDED' | 'NO_APPROVAL_NEEDED' };

export function canApproveRefund(input: {
  requestedBy: string;
  approver: string;
  status: 'pending_approval' | 'approved' | 'rejected';
  needsSecondApproval: boolean;
}): ApprovalCheck {
  if (input.status !== 'pending_approval') return { ok: false, reason: 'ALREADY_DECIDED' };
  if (!input.needsSecondApproval) return { ok: false, reason: 'NO_APPROVAL_NEEDED' };
  if (input.requestedBy === input.approver) return { ok: false, reason: 'SAME_APPROVER' };
  return { ok: true };
}

/** Payment status after its refunds change (docs/05-workflows.md: paid -> partially_refunded/refunded). */
export function paymentStatusAfterRefunds(input: {
  capturedFils: number;
  succeededFils: number;
  pendingCount: number;
  failedWithoutSuccess: boolean;
}): 'succeeded' | 'refund_pending' | 'partially_refunded' | 'refunded' | 'refund_failed' {
  if (input.pendingCount > 0) return 'refund_pending';
  if (input.succeededFils >= input.capturedFils) return 'refunded';
  if (input.succeededFils > 0) return 'partially_refunded';
  if (input.failedWithoutSuccess) return 'refund_failed';
  return 'succeeded';
}
