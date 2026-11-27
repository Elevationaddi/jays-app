import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { MockPaymentOutcome } from '@jays/domain';
import type { Clock } from '../common/clock.js';
import {
  type PaymentIntent,
  type PaymentProvider,
  type ProviderEvent,
  ProviderUnavailableError,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TOLERANCE_SECONDS,
} from './provider.js';

export interface WebhookDelivery {
  body: string;
  headers: Record<string, string>;
}

/** Where the mock sends its signed webhooks. */
export type WebhookSink = (delivery: WebhookDelivery) => void;

interface MockIntent {
  intentId: string;
  clientSecret: string;
  amountFils: number;
  currency: string;
  status: 'requires_payment' | 'succeeded' | 'failed';
}

export class MockIntentError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'ALREADY_CONFIRMED') {
    super(code);
  }
}

export function signWebhook(secret: string, body: string, now: Date): string {
  const t = Math.floor(now.getTime() / 1000);
  const v1 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

/** Verifies `t=<unix>,v1=<hex>` over `${t}.${body}` with a time tolerance. */
export function verifySignature(
  secret: string,
  body: Buffer,
  header: string | undefined,
  now: Date,
): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const t = Number(parts['t']);
  const v1 = parts['v1'];
  if (!Number.isSafeInteger(t) || typeof v1 !== 'string' || !/^[0-9a-f]{64}$/.test(v1)) {
    return false;
  }
  if (Math.abs(now.getTime() / 1000 - t) > WEBHOOK_TOLERANCE_SECONDS) return false;
  const expected = createHmac('sha256', secret)
    .update(Buffer.concat([Buffer.from(`${t}.`), body]))
    .digest();
  return timingSafeEqual(expected, Buffer.from(v1, 'hex'));
}

/**
 * Local stand-in for a real PSP. It behaves like one where it matters: intents are idempotent,
 * the customer "pays" on a separate hosted step (`confirm`), and the outcome arrives later as a
 * signed webhook — never as a return value. Outcomes for testing (ADR-0006):
 * success, fail, timeout (no webhook at all) and duplicate (the same event delivered twice).
 * State lives in memory, so intents do not survive an API restart (local development only).
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock' as const;
  private readonly intents = new Map<string, MockIntent>();
  private readonly intentKeys = new Map<string, string>();
  private readonly refundKeys = new Map<string, string>();
  /** Test seams: make the provider unreachable, or make refunds fail. */
  unavailable = false;
  failRefunds = false;

  constructor(
    private readonly secret: string,
    private readonly sink: WebhookSink,
    private readonly clock: Clock,
  ) {}

  async createIntent(input: {
    amountFils: number;
    currency: 'AED';
    idempotencyKey: string;
    metadata: Record<string, string>;
  }): Promise<PaymentIntent> {
    if (this.unavailable) throw new ProviderUnavailableError();
    const existing = this.intentKeys.get(input.idempotencyKey);
    if (existing) {
      const intent = this.intents.get(existing) as MockIntent;
      return { intentId: intent.intentId, clientSecret: intent.clientSecret };
    }
    const intent: MockIntent = {
      intentId: `pi_mock_${randomUUID().replaceAll('-', '')}`,
      clientSecret: `pi_secret_${randomBytes(24).toString('base64url')}`,
      amountFils: input.amountFils,
      currency: input.currency,
      status: 'requires_payment',
    };
    this.intents.set(intent.intentId, intent);
    this.intentKeys.set(input.idempotencyKey, intent.intentId);
    return { intentId: intent.intentId, clientSecret: intent.clientSecret };
  }

  /** The hosted payment step. Returns how many webhooks were queued. */
  confirm(intentId: string, clientSecret: string, outcome: MockPaymentOutcome): number {
    const intent = this.intents.get(intentId);
    if (
      !intent ||
      intent.clientSecret.length !== clientSecret.length ||
      !timingSafeEqual(Buffer.from(intent.clientSecret), Buffer.from(clientSecret))
    ) {
      throw new MockIntentError('NOT_FOUND');
    }
    if (intent.status !== 'requires_payment') throw new MockIntentError('ALREADY_CONFIRMED');
    switch (outcome) {
      case 'timeout':
        // The customer never finishes and the provider never calls back.
        return 0;
      case 'fail':
        intent.status = 'failed';
        this.emit('payment_intent.payment_failed', intent, { failureCode: 'card_declined' });
        return 1;
      case 'success':
        intent.status = 'succeeded';
        this.emit('payment_intent.succeeded', intent);
        return 1;
      case 'duplicate': {
        intent.status = 'succeeded';
        const delivery = this.emit('payment_intent.succeeded', intent);
        this.sink(delivery);
        return 2;
      }
    }
  }

  async refund(input: {
    intentId: string;
    amountFils: number;
    idempotencyKey: string;
  }): Promise<{ refundId: string }> {
    if (this.unavailable) throw new ProviderUnavailableError();
    const done = this.refundKeys.get(input.idempotencyKey);
    if (done) return { refundId: done };
    const intent = this.intents.get(input.intentId);
    if (!intent || intent.status !== 'succeeded' || input.amountFils > intent.amountFils) {
      throw new Error('refund refused by provider');
    }
    if (this.failRefunds) throw new Error('refund refused by provider');
    const refundId = `re_mock_${randomUUID().replaceAll('-', '')}`;
    this.refundKeys.set(input.idempotencyKey, refundId);
    this.emit('refund.succeeded', intent, { refundId, amountFils: input.amountFils });
    return { refundId };
  }

  verifyWebhook(rawBody: Buffer, signature: string | undefined, now: Date): ProviderEvent | null {
    if (!verifySignature(this.secret, rawBody, signature, now)) return null;
    try {
      const parsed = JSON.parse(rawBody.toString('utf8')) as {
        id?: unknown;
        type?: unknown;
        data?: Record<string, unknown>;
      };
      const data = parsed.data ?? {};
      if (
        typeof parsed.id !== 'string' ||
        typeof parsed.type !== 'string' ||
        typeof data['intentId'] !== 'string' ||
        typeof data['amountFils'] !== 'number' ||
        typeof data['currency'] !== 'string'
      ) {
        return null;
      }
      return {
        id: parsed.id,
        type: parsed.type,
        intentId: data['intentId'],
        amountFils: data['amountFils'],
        currency: data['currency'],
        refundId: typeof data['refundId'] === 'string' ? data['refundId'] : null,
        failureCode: typeof data['failureCode'] === 'string' ? data['failureCode'] : null,
      };
    } catch {
      return null;
    }
  }

  private emit(
    type: string,
    intent: MockIntent,
    extra: { failureCode?: string; refundId?: string; amountFils?: number } = {},
  ): WebhookDelivery {
    const body = JSON.stringify({
      id: `evt_mock_${randomUUID().replaceAll('-', '')}`,
      type,
      created: Math.floor(this.clock.now().getTime() / 1000),
      data: {
        intentId: intent.intentId,
        amountFils: extra.amountFils ?? intent.amountFils,
        currency: intent.currency,
        ...(extra.failureCode ? { failureCode: extra.failureCode } : {}),
        ...(extra.refundId ? { refundId: extra.refundId } : {}),
      },
    });
    const delivery = {
      body,
      headers: {
        'content-type': 'application/json',
        [WEBHOOK_SIGNATURE_HEADER]: signWebhook(this.secret, body, this.clock.now()),
      },
    };
    this.sink(delivery);
    return delivery;
  }
}

/**
 * Default sink for local development: POSTs each webhook to this API's own webhook endpoint
 * shortly afterwards, retrying a few times like a real provider would.
 */
export function httpWebhookSink(
  url: string,
  onError: (error: unknown) => void,
  fetchImpl: typeof fetch = fetch,
): WebhookSink {
  return (delivery) => {
    const attempt = (n: number) => {
      setTimeout(
        () => {
          fetchImpl(url, { method: 'POST', headers: delivery.headers, body: delivery.body })
            .then((res) => {
              if (!res.ok && res.status >= 500 && n < 4) attempt(n + 1);
            })
            .catch((error: unknown) => {
              if (n < 4) attempt(n + 1);
              else onError(error);
            });
        },
        250 * 2 ** n,
      ).unref();
    };
    attempt(0);
  };
}
