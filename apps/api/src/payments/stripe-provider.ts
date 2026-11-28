import { createHmac, timingSafeEqual } from 'node:crypto';
import { STRIPE_TEST_SECRET_KEY } from '@jays/config';
import {
  type PaymentIntent,
  type PaymentProvider,
  type PayoutAccountStatus,
  type ProviderEvent,
  type ProviderRecord,
  ProviderUnavailableError,
  WEBHOOK_TOLERANCE_SECONDS,
} from './provider.js';

/** Pinned so a change to the account's default API version cannot change what we parse. */
export const STRIPE_API_VERSION = '2024-06-20';
export const STRIPE_SIGNATURE_HEADER = 'stripe-signature';
const STRIPE_API = 'https://api.stripe.com';
const TIMEOUT_MS = 15_000;

type Params = Record<string, string | number | boolean | undefined>;
type StripeObject = Record<string, unknown>;

/** Refused by Stripe (4xx other than rate limiting). The message never contains the key. */
export class StripeRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super(`stripe refused the request (${status}${code ? `, ${code}` : ''})`);
    this.name = 'StripeRequestError';
  }
}

/** Verifies a `Stripe-Signature` header (`t=<unix>,v1=<hex>[,v1=<hex>]`) over the raw body. */
export function verifyStripeSignature(
  secret: string,
  body: Buffer,
  header: string | undefined,
  now: Date,
): boolean {
  if (!header) return false;
  let t: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (key === 't') t = Number(value);
    if (key === 'v1' && /^[0-9a-f]{64}$/.test(value)) signatures.push(value);
  }
  if (t === null || !Number.isSafeInteger(t) || signatures.length === 0) return false;
  if (Math.abs(now.getTime() / 1000 - t) > WEBHOOK_TOLERANCE_SECONDS) return false;
  const expected = createHmac('sha256', secret)
    .update(Buffer.concat([Buffer.from(`${t}.`), body]))
    .digest();
  return signatures.some((s) => timingSafeEqual(expected, Buffer.from(s, 'hex')));
}

/** Form-encodes Stripe parameters; nested keys are already written as `a[b]`. */
function form(params: Params): string {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) body.append(key, String(value));
  }
  return body.toString();
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) ? v : null;
const obj = (v: unknown): StripeObject | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as StripeObject) : null;

/** The intent id on a Stripe object: a string id or an expanded object. */
function intentIdOf(v: unknown): string | null {
  return str(v) ?? str(obj(v)?.['id']);
}

/**
 * Stripe Connect adapter, **test mode only** (ADR-0030). Live keys are refused here and in the
 * environment schema, so no code path can take a real payment until the founder approves it.
 *
 * Funds flow (proposed, pending Stripe's confirmation for the UAE): the customer pays the
 * platform account in one PaymentIntent for the whole order (multi-merchant cart), grouped by
 * `transfer_group`; weekly payouts are Stripe transfers to each business's connected account,
 * and Stripe pays the business's bank from there. Card data never reaches JAYS: the client
 * confirms the PaymentIntent with Stripe directly using the client secret.
 *
 * Talks to Stripe's REST API with `fetch`, so no SDK dependency is added.
 */
export class StripePaymentProvider implements PaymentProvider {
  readonly name = 'stripe' as const;
  readonly signatureHeader = STRIPE_SIGNATURE_HEADER;
  readonly requiresPayoutAccount = true;

  constructor(
    private readonly apiKey: string,
    /** The platform endpoint's signing secret, then the Connect endpoint's if there is one. */
    private readonly webhookSecrets: readonly string[],
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly apiBase: string = STRIPE_API,
  ) {
    if (!STRIPE_TEST_SECRET_KEY.test(apiKey)) {
      throw new Error('Stripe adapter refuses non-test keys: live payments are not approved');
    }
  }

  async createIntent(input: {
    amountFils: number;
    currency: 'AED';
    idempotencyKey: string;
    metadata: Record<string, string>;
  }): Promise<PaymentIntent> {
    const metadata = Object.fromEntries(
      Object.entries(input.metadata).map(([k, v]) => [`metadata[${k}]`, v]),
    );
    const group = input.metadata['orderId'] ?? input.metadata['bookingId'];
    const pi = await this.request('POST', '/v1/payment_intents', {
      params: {
        // AED has two decimal places at Stripe, so fils are Stripe's minor units.
        amount: input.amountFils,
        currency: 'aed',
        'automatic_payment_methods[enabled]': true,
        ...(group ? { transfer_group: group } : {}),
        ...metadata,
      },
      idempotencyKey: input.idempotencyKey,
    });
    const intentId = str(pi['id']);
    const clientSecret = str(pi['client_secret']);
    if (!intentId || !clientSecret) throw new ProviderUnavailableError('unexpected response');
    return { intentId, clientSecret };
  }

  async refund(input: {
    intentId: string;
    amountFils: number;
    idempotencyKey: string;
    reference: string;
  }): Promise<{ refundId: string }> {
    const refund = await this.request('POST', '/v1/refunds', {
      params: {
        payment_intent: input.intentId,
        amount: input.amountFils,
        'metadata[reference]': input.reference,
      },
      idempotencyKey: input.idempotencyKey,
    });
    const refundId = str(refund['id']);
    if (!refundId) throw new ProviderUnavailableError('unexpected response');
    return { refundId };
  }

  async createPayout(input: {
    reference: string;
    businessId: string;
    destinationAccount: string | null;
    amountFils: number;
    currency: 'AED';
    idempotencyKey: string;
  }): Promise<{ payoutId: string }> {
    if (!input.destinationAccount) throw new Error('no connected account for this business');
    const transfer = await this.request('POST', '/v1/transfers', {
      params: {
        amount: input.amountFils,
        currency: 'aed',
        destination: input.destinationAccount,
        'metadata[reference]': input.reference,
        'metadata[businessId]': input.businessId,
      },
      idempotencyKey: input.idempotencyKey,
    });
    const payoutId = str(transfer['id']);
    if (!payoutId) throw new ProviderUnavailableError('unexpected response');
    return { payoutId };
  }

  async createPayoutAccount(input: {
    businessId: string;
    idempotencyKey: string;
  }): Promise<PayoutAccountStatus> {
    const account = await this.request('POST', '/v1/accounts', {
      params: {
        country: 'AE',
        // Stripe collects identity and bank details and handles its own pricing for the
        // account (no platform fee per active account, docs/FOUNDER_SETUP_GUIDE.md step 4).
        'controller[stripe_dashboard][type]': 'express',
        'controller[fees][payer]': 'account',
        'controller[losses][payments]': 'stripe',
        'capabilities[transfers][requested]': true,
        'metadata[businessId]': input.businessId,
      },
      idempotencyKey: input.idempotencyKey,
    });
    return this.accountStatus(account);
  }

  async createOnboardingLink(input: {
    accountId: string;
    returnUrl: string;
    refreshUrl: string;
  }): Promise<{ url: string }> {
    const link = await this.request('POST', '/v1/account_links', {
      params: {
        account: input.accountId,
        type: 'account_onboarding',
        return_url: input.returnUrl,
        refresh_url: input.refreshUrl,
      },
    });
    const url = str(link['url']);
    if (!url?.startsWith('https://')) throw new ProviderUnavailableError('unexpected response');
    return { url };
  }

  async getPayoutAccount(accountId: string): Promise<PayoutAccountStatus> {
    const account = await this.request('GET', `/v1/accounts/${encodeURIComponent(accountId)}`);
    return this.accountStatus(account);
  }

  /** Payment intents, refunds and transfers created in [from, to), for reconciliation. */
  async listRecords(input: { from: Date; to: Date }): Promise<ProviderRecord[]> {
    const window = {
      'created[gte]': Math.floor(input.from.getTime() / 1000),
      'created[lt]': Math.floor(input.to.getTime() / 1000),
    };
    const records: ProviderRecord[] = [];
    for (const pi of await this.list('/v1/payment_intents', window)) {
      const status = str(pi['status']);
      if (status !== 'succeeded' && status !== 'canceled' && status !== 'requires_payment_method') {
        continue;
      }
      // A payment that was tried and declined goes back to requires_payment_method.
      const failed = status !== 'succeeded' && obj(pi['last_payment_error']) !== null;
      if (status !== 'succeeded' && !failed) continue;
      records.push({
        kind: 'payment',
        ref: str(pi['id']) ?? '',
        intentId: str(pi['id']),
        amountFils: num(pi['amount_received']) || (num(pi['amount']) ?? 0),
        currency: (str(pi['currency']) ?? '').toUpperCase(),
        status: status === 'succeeded' ? 'succeeded' : 'failed',
        at: new Date((num(pi['created']) ?? 0) * 1000),
      });
    }
    for (const r of await this.list('/v1/refunds', window)) {
      const status = str(r['status']);
      records.push({
        kind: 'refund',
        ref: str(r['id']) ?? '',
        intentId: intentIdOf(r['payment_intent']),
        amountFils: num(r['amount']) ?? 0,
        currency: (str(r['currency']) ?? '').toUpperCase(),
        status: status === 'succeeded' ? 'succeeded' : status === 'failed' ? 'failed' : 'pending',
        at: new Date((num(r['created']) ?? 0) * 1000),
      });
    }
    for (const t of await this.list('/v1/transfers', window)) {
      records.push({
        kind: 'payout',
        ref: str(t['id']) ?? '',
        intentId: null,
        amountFils: num(t['amount']) ?? 0,
        currency: (str(t['currency']) ?? '').toUpperCase(),
        status: t['reversed'] === true ? 'failed' : 'paid',
        at: new Date((num(t['created']) ?? 0) * 1000),
      });
    }
    return records;
  }

  verifyWebhook(rawBody: Buffer, signature: string | undefined, now: Date): ProviderEvent | null {
    if (
      !this.webhookSecrets.some((secret) => verifyStripeSignature(secret, rawBody, signature, now))
    ) {
      return null;
    }
    let parsed: StripeObject;
    try {
      parsed = JSON.parse(rawBody.toString('utf8')) as StripeObject;
    } catch {
      return null;
    }
    const id = str(parsed['id']);
    const type = str(parsed['type']);
    const object = obj(obj(parsed['data'])?.['object']);
    // Test-mode events only: a live event is never accepted, even with a valid signature.
    if (!id || !type || !object || parsed['livemode'] !== false) return null;
    return mapStripeEvent(id, type, object);
  }

  private accountStatus(account: StripeObject): PayoutAccountStatus {
    const accountId = str(account['id']);
    if (!accountId) throw new ProviderUnavailableError('unexpected response');
    return {
      accountId,
      detailsSubmitted: account['details_submitted'] === true,
      payoutsEnabled: account['payouts_enabled'] === true,
    };
  }

  /** Lists every page of a Stripe list endpoint (100 per page, at most 50 pages). */
  private async list(path: string, params: Params): Promise<StripeObject[]> {
    const items: StripeObject[] = [];
    let after: string | undefined;
    for (let page = 0; page < 50; page++) {
      const res = await this.request('GET', path, {
        params: { ...params, limit: 100, ...(after ? { starting_after: after } : {}) },
      });
      const data = Array.isArray(res['data']) ? (res['data'] as unknown[]) : [];
      for (const item of data) {
        const o = obj(item);
        if (o) items.push(o);
      }
      const last = obj(data.at(-1));
      if (res['has_more'] !== true || !last) return items;
      after = str(last['id']) ?? undefined;
      if (!after) return items;
    }
    throw new ProviderUnavailableError('too many pages');
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    options: { params?: Params; idempotencyKey?: string } = {},
  ): Promise<StripeObject> {
    const query = method === 'GET' && options.params ? `?${form(options.params)}` : '';
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.apiKey}`,
      'stripe-version': STRIPE_API_VERSION,
    };
    if (method === 'POST') headers['content-type'] = 'application/x-www-form-urlencoded';
    if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.apiBase}${path}${query}`, {
        method,
        headers,
        ...(method === 'POST' ? { body: form(options.params ?? {}) } : {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new ProviderUnavailableError();
    }
    const body: unknown = await res.json().catch(() => null);
    if (res.status === 429 || res.status >= 500) throw new ProviderUnavailableError();
    if (!res.ok) {
      throw new StripeRequestError(res.status, str(obj(obj(body)?.['error'])?.['code']));
    }
    const parsed = obj(body);
    if (!parsed) throw new ProviderUnavailableError('unexpected response');
    return parsed;
  }
}

/** Maps a verified Stripe event onto the provider-neutral event the payments service applies. */
export function mapStripeEvent(
  id: string,
  type: string,
  object: StripeObject,
): ProviderEvent | null {
  const base = {
    id,
    intentId: '',
    amountFils: 0,
    currency: (str(object['currency']) ?? 'aed').toUpperCase(),
    refundId: null,
    payoutId: null,
    reference: null,
    failureCode: null,
  };
  const reference = str(obj(object['metadata'])?.['reference']);
  switch (type) {
    case 'payment_intent.succeeded':
    case 'payment_intent.canceled':
    case 'payment_intent.payment_failed': {
      const intentId = str(object['id']);
      if (!intentId) return null;
      // At Stripe a declined attempt leaves the intent open: the customer can try another card
      // on the same intent. Only cancellation ends it, so a decline changes nothing here and the
      // order or booking hold simply expires if the customer gives up.
      const mapped =
        type === 'payment_intent.succeeded'
          ? 'payment_intent.succeeded'
          : type === 'payment_intent.canceled'
            ? 'payment_intent.payment_failed'
            : 'payment_intent.attempt_failed';
      return {
        ...base,
        type: mapped,
        intentId,
        amountFils:
          type === 'payment_intent.succeeded'
            ? (num(object['amount_received']) ?? 0)
            : (num(object['amount']) ?? 0),
        failureCode:
          str(obj(object['last_payment_error'])?.['code']) ?? str(object['cancellation_reason']),
      };
    }
    case 'refund.created':
    case 'refund.updated':
    case 'refund.failed': {
      const refundId = str(object['id']);
      const status = str(object['status']);
      if (!refundId) return null;
      // Pending refunds and refunds waiting on the customer change nothing yet.
      const outcome =
        status === 'succeeded'
          ? 'refund.succeeded'
          : status === 'failed' || status === 'canceled'
            ? 'refund.failed'
            : `refund.${status ?? 'unknown'}`;
      return {
        ...base,
        type: outcome,
        intentId: intentIdOf(object['payment_intent']) ?? '',
        amountFils: num(object['amount']) ?? 0,
        refundId,
        reference,
        failureCode: str(object['failure_reason']),
      };
    }
    case 'transfer.created':
    case 'transfer.reversed': {
      const payoutId = str(object['id']);
      if (!payoutId) return null;
      // A transfer moves the money into the business's Stripe balance at once; Stripe then
      // pays its bank. A reversal is recorded but not applied: only finance reverses a payout,
      // and reconciliation flags the transfer's changed status.
      return {
        ...base,
        type: type === 'transfer.created' ? 'payout.paid' : 'payout.reversed',
        amountFils: num(object['amount']) ?? 0,
        payoutId,
        reference,
      };
    }
    case 'account.updated': {
      const accountId = str(object['id']);
      if (!accountId) return null;
      return {
        ...base,
        type,
        account: {
          accountId,
          detailsSubmitted: object['details_submitted'] === true,
          payoutsEnabled: object['payouts_enabled'] === true,
        },
      };
    }
    default:
      return { ...base, type };
  }
}
