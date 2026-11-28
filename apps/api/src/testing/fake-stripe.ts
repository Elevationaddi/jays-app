import { createHmac, randomBytes } from 'node:crypto';

/**
 * A fake of the parts of Stripe's REST API the adapter uses, served through an injected `fetch`
 * (no network). Tests that use it are **mock tests**: they prove the adapter sends what Stripe's
 * documentation describes and parses what it returns, not that Stripe accepts it. Tests against
 * Stripe's real test mode are in `*.provider.test.ts` and need a test key (ADR-0030).
 */
export interface FakeStripeRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  params: URLSearchParams;
}

export class FakeStripe {
  readonly requests: FakeStripeRequest[] = [];
  private readonly idempotent = new Map<string, unknown>();
  readonly accounts = new Map<string, { details_submitted: boolean; payouts_enabled: boolean }>();
  /** Test seams. */
  failWith: number | null = null;
  /** Pages of list results by path, served in order. */
  lists = new Map<string, unknown[][]>();

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : (input as URL | Request).toString());
    const method = init?.method ?? 'GET';
    const headers = Object.fromEntries(
      Object.entries((init?.headers as Record<string, string> | undefined) ?? {}).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    );
    const params =
      method === 'POST' ? new URLSearchParams(String(init?.body ?? '')) : url.searchParams;
    this.requests.push({ method, path: url.pathname, headers, params });
    if (this.failWith) return json(this.failWith, { error: { code: 'fake_failure' } });
    const key = headers['idempotency-key'];
    if (key && this.idempotent.has(`${url.pathname}:${key}`)) {
      return json(200, this.idempotent.get(`${url.pathname}:${key}`));
    }
    const body = this.handle(method, url.pathname, params);
    if (key && body.status === 200) this.idempotent.set(`${url.pathname}:${key}`, body.body);
    return json(body.status, body.body);
  };

  private handle(
    method: string,
    path: string,
    params: URLSearchParams,
  ): { status: number; body: unknown } {
    const id = (prefix: string) => `${prefix}_${randomBytes(12).toString('hex')}`;
    if (method === 'POST' && path === '/v1/payment_intents') {
      const intentId = id('pi');
      return {
        status: 200,
        body: {
          id: intentId,
          object: 'payment_intent',
          amount: Number(params.get('amount')),
          currency: params.get('currency'),
          client_secret: `${intentId}_secret_${randomBytes(8).toString('hex')}`,
          status: 'requires_payment_method',
        },
      };
    }
    if (method === 'POST' && path === '/v1/refunds') {
      return {
        status: 200,
        body: {
          id: id('re'),
          object: 'refund',
          amount: Number(params.get('amount')),
          payment_intent: params.get('payment_intent'),
          status: 'succeeded',
        },
      };
    }
    if (method === 'POST' && path === '/v1/transfers') {
      return {
        status: 200,
        body: {
          id: id('tr'),
          object: 'transfer',
          amount: Number(params.get('amount')),
          destination: params.get('destination'),
        },
      };
    }
    if (method === 'POST' && path === '/v1/accounts') {
      const accountId = id('acct');
      this.accounts.set(accountId, { details_submitted: false, payouts_enabled: false });
      return {
        status: 200,
        body: {
          id: accountId,
          object: 'account',
          details_submitted: false,
          payouts_enabled: false,
        },
      };
    }
    if (method === 'POST' && path === '/v1/account_links') {
      return {
        status: 200,
        body: {
          object: 'account_link',
          url: `https://connect.stripe.com/setup/e/${params.get('account')}/fictional`,
        },
      };
    }
    const account = /^\/v1\/accounts\/(acct_[A-Za-z0-9]+)$/.exec(path);
    if (method === 'GET' && account) {
      const state = this.accounts.get(account[1] as string);
      if (!state) return { status: 404, body: { error: { code: 'resource_missing' } } };
      return { status: 200, body: { id: account[1], object: 'account', ...state } };
    }
    if (method === 'GET' && this.lists.has(path)) {
      const pages = this.lists.get(path) as unknown[][];
      const page = pages.shift() ?? [];
      return { status: 200, body: { object: 'list', data: page, has_more: pages.length > 0 } };
    }
    return { status: 404, body: { error: { code: 'resource_missing' } } };
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Builds a test-mode event signed the way Stripe documents it (`Stripe-Signature`). */
export function stripeEvent(
  secret: string,
  type: string,
  object: Record<string, unknown>,
  now: Date,
  extra: Record<string, unknown> = {},
): { body: string; headers: Record<string, string> } {
  const body = JSON.stringify({
    id: `evt_${randomBytes(12).toString('hex')}`,
    object: 'event',
    type,
    livemode: false,
    created: Math.floor(now.getTime() / 1000),
    data: { object },
    ...extra,
  });
  const t = Math.floor(now.getTime() / 1000);
  const v1 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return {
    body,
    headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${v1}` },
  };
}
