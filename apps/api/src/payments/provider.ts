import type { PaymentProviderName } from '@jays/db';

/**
 * Payment service provider adapter (ADR-0006, ADR-0013, ADR-0030). Adapters: the local mock,
 * which production refuses, and Stripe Connect in test mode. Every adapter must confirm payments
 * only through signed webhooks: creating an intent never marks anything paid.
 */
export interface PaymentIntent {
  intentId: string;
  clientSecret: string;
}

export type ProviderEventType =
  | 'payment_intent.succeeded'
  | 'payment_intent.payment_failed'
  | 'refund.succeeded'
  | 'refund.failed'
  | 'payout.paid'
  | 'payout.failed'
  | 'account.updated';

export interface ProviderEvent {
  id: string;
  type: ProviderEventType | (string & {});
  intentId: string;
  amountFils: number;
  currency: string;
  refundId: string | null;
  payoutId: string | null;
  /** Our own payout or refund id, passed when it was created and echoed back by the provider. */
  reference: string | null;
  failureCode: string | null;
  /** For `account.updated`: the connected payout account and what the provider reports. */
  account?: PayoutAccountStatus | null;
}

/** What the provider reports about a business's connected payout account. */
export interface PayoutAccountStatus {
  accountId: string;
  detailsSubmitted: boolean;
  payoutsEnabled: boolean;
}

/** One record from the provider's own books, used by daily reconciliation (T15). */
export interface ProviderRecord {
  kind: 'payment' | 'refund' | 'payout';
  /** Intent id for payments, refund id for refunds, payout id for payouts. */
  ref: string;
  intentId: string | null;
  amountFils: number;
  currency: string;
  status: 'succeeded' | 'failed' | 'pending' | 'paid';
  at: Date;
}

export class ProviderUnavailableError extends Error {
  constructor(message = 'payment provider unavailable') {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}

export interface PaymentProvider {
  readonly name: PaymentProviderName;
  /** The request header that carries the webhook signature. */
  readonly signatureHeader: string;
  /**
   * True when payouts need a connected account that the provider has enabled. The mock pays any
   * business; Stripe transfers only to an onboarded connected account.
   */
  readonly requiresPayoutAccount: boolean;
  /** Idempotent per key: the same key returns the same intent. */
  createIntent(input: {
    amountFils: number;
    currency: 'AED';
    idempotencyKey: string;
    metadata: Record<string, string>;
  }): Promise<PaymentIntent>;
  /** Idempotent per key. Throws when the provider refuses or cannot be reached. */
  refund(input: {
    intentId: string;
    amountFils: number;
    idempotencyKey: string;
    /** Our refund id, echoed back in webhooks so they match before we store the provider's id. */
    reference: string;
  }): Promise<{
    refundId: string;
  }>;
  /**
   * Sends money to a merchant's payout destination. Idempotent per key. The result arrives as a
   * signed `payout.paid` or `payout.failed` webhook. Throws when refused or unreachable.
   */
  createPayout(input: {
    /** Our payout id; echoed back in webhooks so they match even before we store the ref. */
    reference: string;
    businessId: string;
    /** The business's connected account; null only where `requiresPayoutAccount` is false. */
    destinationAccount: string | null;
    amountFils: number;
    currency: 'AED';
    idempotencyKey: string;
  }): Promise<{ payoutId: string }>;
  /** Creates the business's connected payout account. Idempotent per key. */
  createPayoutAccount(input: {
    businessId: string;
    idempotencyKey: string;
  }): Promise<PayoutAccountStatus>;
  /** A short-lived link to the provider's hosted onboarding (identity and bank details). */
  createOnboardingLink(input: {
    accountId: string;
    returnUrl: string;
    refreshUrl: string;
  }): Promise<{ url: string }>;
  /** The account's current status, read from the provider. */
  getPayoutAccount(accountId: string): Promise<PayoutAccountStatus>;
  /** The provider's records that changed in [from, to), for reconciliation. */
  listRecords(input: { from: Date; to: Date }): Promise<ProviderRecord[]>;
  /** Verifies the signature over the raw body and parses the event; null when not authentic. */
  verifyWebhook(rawBody: Buffer, signature: string | undefined, now: Date): ProviderEvent | null;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
/** The mock provider's signature header. Stripe uses `stripe-signature`. */
export const WEBHOOK_SIGNATURE_HEADER = 'x-psp-signature';
/** Signed events older or newer than this are refused (replay protection with event-id dedupe). */
export const WEBHOOK_TOLERANCE_SECONDS = 300;
