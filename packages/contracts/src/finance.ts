import { FINANCE_MODES, FINANCE_SETTING_KEYS, LEDGER_ACCOUNTS } from '@jays/domain';
import { z } from 'zod';
import { isoDateTime } from './identity.js';

/**
 * Finance (phase 5, ADR-0015): ledger, earnings, payouts, refunds with a second approver,
 * disputes, payout holds, commission rules, finance settings and reconciliation. Money is
 * integer fils in AED. Business views are read-only (docs/03-business.md, /business/finance).
 */

const cursorQuery = {
  cursor: z.string().min(1).max(300).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};
const fils = z.number().int();
const reason = z.string().trim().min(3).max(500);
const actor = z.object({ id: z.uuid(), name: z.string() }).nullable();
const bizRef = z.object({ id: z.uuid(), name: z.object({ en: z.string(), ar: z.string() }) });

export const financeModeSchema = z.enum(FINANCE_MODES);
export const ledgerAccountSchema = z.enum(LEDGER_ACCOUNTS);
export const financeSettingKeySchema = z.enum(FINANCE_SETTING_KEYS);
export const earningStatusSchema = z.enum(['pending', 'eligible', 'in_payout', 'paid_out']);
export const payoutStatusSchema = z.enum(['pending', 'paid', 'failed']);
export const ledgerKindSchema = z.enum([
  'capture',
  'late_capture',
  'refund',
  'late_refund',
  'chargeback',
  'payout_initiated',
  'payout_paid',
  'payout_failed',
]);

// Business ---------------------------------------------------------------------------------------

export const financeSummarySchema = z.object({
  currency: z.literal('AED'),
  /** What the business is owed now according to the ledger. Negative after a chargeback. */
  payableBalanceFils: fils,
  /** Sent for payout, waiting for the provider to confirm. */
  inTransitFils: fils,
  /** Earned but not yet eligible (work not done, or inside the dispute window). */
  pendingFils: fils,
  /** Eligible for the next payout run. */
  eligibleFils: fils,
  paidOutFils: fils,
  commissionFils: fils,
  refundedFils: fils,
  onHold: z.boolean(),
  holdReason: z.string().nullable(),
  disputeWindowDays: z.number().int(),
  openDisputes: z.number().int(),
});
export type FinanceSummary = z.infer<typeof financeSummarySchema>;

export const earningSchema = z.object({
  id: z.uuid(),
  sourceType: z.enum(['merchant_order', 'booking']),
  merchantOrderId: z.uuid().nullable(),
  orderId: z.uuid().nullable(),
  bookingId: z.uuid().nullable(),
  mode: financeModeSchema,
  grossFils: fils,
  commissionBps: z.number().int(),
  commissionFils: fils,
  refundedFils: fils,
  netFils: fils,
  status: earningStatusSchema,
  eligibleAt: isoDateTime.nullable(),
  payoutId: z.uuid().nullable(),
  disputed: z.boolean(),
  createdAt: isoDateTime,
});
export type EarningView = z.infer<typeof earningSchema>;

export const earningListQuerySchema = z.strictObject({
  status: earningStatusSchema.optional(),
  ...cursorQuery,
});
export type EarningListQuery = z.infer<typeof earningListQuerySchema>;

export const ledgerLineSchema = z.object({
  id: z.uuid(),
  transactionId: z.uuid(),
  kind: ledgerKindSchema,
  sourceType: z.string(),
  sourceId: z.uuid(),
  account: ledgerAccountSchema,
  debitFils: fils,
  creditFils: fils,
  occurredAt: isoDateTime,
});
export type LedgerLineView = z.infer<typeof ledgerLineSchema>;

export const ledgerListQuerySchema = z.strictObject({ ...cursorQuery });
export type LedgerListQuery = z.infer<typeof ledgerListQuerySchema>;

export const payoutSchema = z.object({
  id: z.uuid(),
  business: bizRef,
  amountFils: fils,
  currency: z.literal('AED'),
  status: payoutStatusSchema,
  providerRef: z.string().nullable(),
  failureCode: z.string().nullable(),
  needsAttention: z.boolean(),
  earningCount: z.number().int(),
  createdAt: isoDateTime,
  paidAt: isoDateTime.nullable(),
  failedAt: isoDateTime.nullable(),
});
export type PayoutView = z.infer<typeof payoutSchema>;

export const payoutListQuerySchema = z.strictObject({
  status: payoutStatusSchema.optional(),
  businessId: z.uuid().optional(),
  ...cursorQuery,
});
export type PayoutListQuery = z.infer<typeof payoutListQuerySchema>;

// Admin: overview, rules and settings -------------------------------------------------------------

export const feeRuleSchema = z.object({
  id: z.uuid(),
  mode: financeModeSchema,
  business: bizRef.nullable(),
  commissionBps: z.number().int(),
  effectiveAt: isoDateTime,
  reason: z.string(),
  createdBy: actor,
  createdAt: isoDateTime,
  inForce: z.boolean(),
});
export type FeeRuleView = z.infer<typeof feeRuleSchema>;

export const feeRuleInputSchema = z.strictObject({
  mode: financeModeSchema,
  businessId: z.uuid().nullable().default(null),
  commissionBps: z.number().int().min(0).max(10_000),
  /** Defaults to now. Rules take effect now or later; history is never rewritten. */
  effectiveAt: isoDateTime.optional(),
  reason,
});
export type FeeRuleInput = z.infer<typeof feeRuleInputSchema>;

export const financeSettingSchema = z.object({
  id: z.uuid().nullable(),
  key: financeSettingKeySchema,
  value: z.number().int(),
  effectiveAt: isoDateTime.nullable(),
  reason: z.string().nullable(),
  createdBy: actor,
  /** True when no row is in force and the built-in default applies. */
  isDefault: z.boolean(),
});
export type FinanceSettingView = z.infer<typeof financeSettingSchema>;

export const financeSettingInputSchema = z.strictObject({
  key: financeSettingKeySchema,
  value: z.number().int().min(0),
  effectiveAt: isoDateTime.optional(),
  reason,
});
export type FinanceSettingInput = z.infer<typeof financeSettingInputSchema>;

export const financeOverviewSchema = z.object({
  currency: z.literal('AED'),
  balances: z.object({
    pspClearingFils: fils,
    merchantPayableFils: fils,
    payoutsInTransitFils: fils,
    platformCommissionFils: fils,
    unallocatedReceiptsFils: fils,
  }),
  paymentsNeedingAttention: z.number().int(),
  payoutsNeedingAttention: z.number().int(),
  refundRequestsPending: z.number().int(),
  openDisputes: z.number().int(),
  activeHolds: z.number().int(),
  openReconciliationItems: z.number().int(),
  lastReconciliation: z
    .object({
      id: z.uuid(),
      periodStart: isoDateTime,
      status: z.enum(['running', 'completed', 'failed']),
      mismatchCount: z.number().int(),
      recoveredCount: z.number().int(),
      finishedAt: isoDateTime.nullable(),
    })
    .nullable(),
  settings: z.array(financeSettingSchema),
  feeRules: z.array(feeRuleSchema),
});
export type FinanceOverview = z.infer<typeof financeOverviewSchema>;

// Admin: payments and refunds --------------------------------------------------------------------

export const adminPaymentSchema = z.object({
  id: z.uuid(),
  targetType: z.enum(['order', 'booking']),
  orderId: z.uuid().nullable(),
  bookingId: z.uuid().nullable(),
  amountFils: fils,
  refundedFils: fils,
  pendingRefundFils: fils,
  status: z.string(),
  needsAttention: z.boolean(),
  providerRef: z.string().nullable(),
  createdAt: isoDateTime,
  succeededAt: isoDateTime.nullable(),
  /** One row per seller with what can still be refunded from it. */
  sellers: z.array(
    z.object({
      merchantOrderId: z.uuid().nullable(),
      business: bizRef,
      grossFils: fils,
      refundableFils: fils,
    }),
  ),
});
export type AdminPayment = z.infer<typeof adminPaymentSchema>;

export const adminPaymentListQuerySchema = z.strictObject({
  needsAttention: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  status: z
    .enum([
      'requires_payment',
      'succeeded',
      'failed',
      'refund_pending',
      'partially_refunded',
      'refunded',
      'refund_failed',
    ])
    .optional(),
  ...cursorQuery,
});
export type AdminPaymentListQuery = z.infer<typeof adminPaymentListQuerySchema>;

export const refundRequestInputSchema = z.strictObject({
  paymentId: z.uuid(),
  /** Required for orders: which seller's suborder the refund comes out of. */
  merchantOrderId: z.uuid().nullable().default(null),
  amountFils: z.number().int().min(1),
  reason,
});
export type RefundRequestInput = z.infer<typeof refundRequestInputSchema>;

export const refundRequestStatusSchema = z.enum(['pending_approval', 'approved', 'rejected']);

export const refundRequestSchema = z.object({
  id: z.uuid(),
  paymentId: z.uuid(),
  merchantOrderId: z.uuid().nullable(),
  business: bizRef.nullable(),
  amountFils: fils,
  reason: z.string(),
  thresholdFils: fils,
  needsSecondApproval: z.boolean(),
  status: refundRequestStatusSchema,
  requestedBy: actor,
  decidedBy: actor,
  decisionNote: z.string().nullable(),
  decidedAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
  refund: z.object({ id: z.uuid(), status: z.enum(['pending', 'succeeded', 'failed']) }).nullable(),
});
export type RefundRequestView = z.infer<typeof refundRequestSchema>;

export const refundRequestListQuerySchema = z.strictObject({
  status: refundRequestStatusSchema.optional(),
  ...cursorQuery,
});
export type RefundRequestListQuery = z.infer<typeof refundRequestListQuerySchema>;

export const refundDecisionSchema = z.strictObject({
  decision: z.enum(['approve', 'reject']),
  note: z.string().trim().max(500).optional(),
});
export type RefundDecision = z.infer<typeof refundDecisionSchema>;

// Admin: disputes and holds ----------------------------------------------------------------------

export const disputeInputSchema = z.strictObject({
  earningId: z.uuid(),
  amountFils: z.number().int().min(1),
  reason,
});
export type DisputeInput = z.infer<typeof disputeInputSchema>;

export const disputeSchema = z.object({
  id: z.uuid(),
  earningId: z.uuid(),
  business: bizRef,
  amountFils: fils,
  status: z.enum(['open', 'won', 'lost']),
  reason: z.string(),
  resolutionNote: z.string().nullable(),
  openedBy: actor,
  resolvedBy: actor,
  resolvedAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
});
export type DisputeView = z.infer<typeof disputeSchema>;

export const disputeListQuerySchema = z.strictObject({
  status: z.enum(['open', 'won', 'lost']).optional(),
  ...cursorQuery,
});
export type DisputeListQuery = z.infer<typeof disputeListQuerySchema>;

export const disputeResolutionSchema = z.strictObject({
  outcome: z.enum(['won', 'lost']),
  note: reason,
});
export type DisputeResolution = z.infer<typeof disputeResolutionSchema>;

export const payoutHoldInputSchema = z.strictObject({ businessId: z.uuid(), reason });
export type PayoutHoldInput = z.infer<typeof payoutHoldInputSchema>;

export const payoutHoldSchema = z.object({
  id: z.uuid(),
  business: bizRef,
  reason: z.string(),
  placedBy: actor,
  releasedBy: actor,
  releasedAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
});
export type PayoutHoldView = z.infer<typeof payoutHoldSchema>;

export const adminEarningListQuerySchema = z.strictObject({
  businessId: z.uuid().optional(),
  status: earningStatusSchema.optional(),
  ...cursorQuery,
});
export type AdminEarningListQuery = z.infer<typeof adminEarningListQuerySchema>;

export const adminEarningSchema = earningSchema.extend({
  business: bizRef,
});
export type AdminEarning = z.infer<typeof adminEarningSchema>;

// Admin: payout runs and reconciliation ---------------------------------------------------------

export const payoutRunResultSchema = z.object({
  madeEligible: z.number().int(),
  payouts: z.array(payoutSchema),
  skipped: z.array(
    z.object({
      business: bizRef,
      reason: z.enum(['on_hold', 'suspended', 'nothing_owed', 'below_minimum', 'pending_refund']),
    }),
  ),
});
export type PayoutRunResult = z.infer<typeof payoutRunResultSchema>;

export const reconciliationRunRequestSchema = z.strictObject({
  /** UTC calendar day to reconcile. Defaults to yesterday. */
  date: z.iso.date().optional(),
});
export type ReconciliationRunRequest = z.infer<typeof reconciliationRunRequestSchema>;

export const reconciliationItemSchema = z.object({
  id: z.uuid(),
  runId: z.uuid(),
  kind: z.enum([
    'recovered_missing_webhook',
    'amount_mismatch',
    'status_mismatch',
    'unknown_at_provider',
    'unknown_locally',
  ]),
  objectType: z.enum(['payment', 'refund', 'payout']),
  providerRef: z.string().nullable(),
  paymentId: z.uuid().nullable(),
  refundId: z.uuid().nullable(),
  payoutId: z.uuid().nullable(),
  localAmountFils: fils.nullable(),
  providerAmountFils: fils.nullable(),
  localStatus: z.string().nullable(),
  providerStatus: z.string().nullable(),
  resolvedAt: isoDateTime.nullable(),
  resolvedBy: actor,
  resolutionNote: z.string().nullable(),
  createdAt: isoDateTime,
});
export type ReconciliationItemView = z.infer<typeof reconciliationItemSchema>;

export const reconciliationRunSchema = z.object({
  id: z.uuid(),
  periodStart: isoDateTime,
  periodEnd: isoDateTime,
  status: z.enum(['running', 'completed', 'failed']),
  checkedCount: z.number().int(),
  recoveredCount: z.number().int(),
  mismatchCount: z.number().int(),
  startedBy: actor,
  startedAt: isoDateTime,
  finishedAt: isoDateTime.nullable(),
  failure: z.string().nullable(),
  items: z.array(reconciliationItemSchema),
});
export type ReconciliationRunView = z.infer<typeof reconciliationRunSchema>;

export const reconciliationListQuerySchema = z.strictObject({ ...cursorQuery });
export type ReconciliationListQuery = z.infer<typeof reconciliationListQuerySchema>;

export const reconciliationResolveSchema = z.strictObject({ note: reason });
export type ReconciliationResolve = z.infer<typeof reconciliationResolveSchema>;
