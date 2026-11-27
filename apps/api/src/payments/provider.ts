/**
 * Payment service provider adapter (ADR-0006, ADR-0013). Only the mock exists until the founder
 * chooses a provider (ADR-0007 D5); production refuses to start with it. Every adapter must
 * confirm payments only through signed webhooks: creating an intent never marks anything paid.
 */
export interface PaymentIntent {
  intentId: string;
  clientSecret: string;
}

export type ProviderEventType =
  | 'payment_intent.succeeded'
  | 'payment_intent.payment_failed'
  | 'refund.succeeded'
  | 'refund.failed';

export interface ProviderEvent {
  id: string;
  type: ProviderEventType | (string & {});
  intentId: string;
  amountFils: number;
  currency: string;
  refundId: string | null;
  failureCode: string | null;
}

export class ProviderUnavailableError extends Error {
  constructor(message = 'payment provider unavailable') {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}

export interface PaymentProvider {
  readonly name: 'mock';
  /** Idempotent per key: the same key returns the same intent. */
  createIntent(input: {
    amountFils: number;
    currency: 'AED';
    idempotencyKey: string;
    metadata: Record<string, string>;
  }): Promise<PaymentIntent>;
  /** Idempotent per key. Throws when the provider refuses or cannot be reached. */
  refund(input: { intentId: string; amountFils: number; idempotencyKey: string }): Promise<{
    refundId: string;
  }>;
  /** Verifies the signature over the raw body and parses the event; null when not authentic. */
  verifyWebhook(rawBody: Buffer, signature: string | undefined, now: Date): ProviderEvent | null;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
export const WEBHOOK_SIGNATURE_HEADER = 'x-psp-signature';
/** Signed events older or newer than this are refused (replay protection with event-id dedupe). */
export const WEBHOOK_TOLERANCE_SECONDS = 300;
