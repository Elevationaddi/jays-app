import { createSign } from 'node:crypto';

/** One push message to one device. Titles and bodies are already rendered in its language. */
export interface PushMessage {
  token: string;
  title: string;
  body: string;
  /** An in-app path such as `/orders/…`, opened when the person taps the notification. */
  link: string | null;
}

/** `invalid`: the provider says the token no longer exists, so the device is revoked. */
export type PushResult = 'sent' | 'invalid';

/** Push delivery adapter (ADR-0031). Throws when the provider is unavailable, so it is retried. */
export interface PushSender {
  readonly name: 'mock' | 'fcm';
  send(message: PushMessage): Promise<PushResult>;
}

export const PUSH_SENDER = Symbol('PUSH_SENDER');

/** Local stand-in: records pushes for tests. Production refuses it (ADR-0006). */
export class MockPushSender implements PushSender {
  readonly name = 'mock' as const;
  readonly sent: PushMessage[] = [];
  /** Tokens to report as no longer registered. */
  readonly invalidTokens = new Set<string>();
  failNext = 0;

  async send(message: PushMessage): Promise<PushResult> {
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new Error('mock push provider unavailable');
    }
    if (this.invalidTokens.has(message.token)) return 'invalid';
    this.sent.push(message);
    if (this.sent.length > 500) this.sent.shift();
    return 'sent';
  }
}

export class PushUnavailableError extends Error {
  constructor(readonly status: number | null) {
    super(`push provider unavailable${status ? ` (${status})` : ''}`);
    this.name = 'PushUnavailableError';
  }
}

const OAUTH_URL = 'https://oauth2.googleapis.com/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TIMEOUT_MS = 10_000;

const b64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');

/**
 * Firebase Cloud Messaging over the HTTP v1 API (ADR-0031), on the no-cost Spark plan. Signs its
 * own OAuth assertion with the service account's key (RS256 via node:crypto), so no Google SDK is
 * added. The access token is cached until shortly before it expires.
 */
export class FcmPushSender implements PushSender {
  readonly name = 'fcm' as const;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly account: { projectId: string; clientEmail: string; privateKey: string },
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async send(message: PushMessage): Promise<PushResult> {
    const body = JSON.stringify({
      message: {
        token: message.token,
        notification: { title: message.title.slice(0, 200), body: message.body.slice(0, 1000) },
        ...(message.link ? { data: { link: message.link } } : {}),
        android: { priority: 'high' },
        apns: { payload: { aps: { sound: 'default' } } },
      },
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      const access = await this.accessToken(attempt > 0);
      let res: Response;
      try {
        res = await this.fetchImpl(
          `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.account.projectId)}/messages:send`,
          {
            method: 'POST',
            headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
            body,
            signal: AbortSignal.timeout(TIMEOUT_MS),
          },
        );
      } catch {
        throw new PushUnavailableError(null);
      }
      if (res.ok) return 'sent';
      // An expired or revoked access token: get a new one and try once more.
      if (res.status === 401 && attempt === 0) continue;
      const error = (await res.json().catch(() => null)) as {
        error?: { status?: string; details?: { errorCode?: string }[] };
      } | null;
      const codes = [
        error?.error?.status,
        ...(error?.error?.details ?? []).map((d) => d.errorCode),
      ].filter(Boolean);
      if (res.status === 404 || codes.includes('UNREGISTERED')) return 'invalid';
      if (res.status === 400 && codes.includes('INVALID_ARGUMENT')) return 'invalid';
      throw new PushUnavailableError(res.status);
    }
    throw new PushUnavailableError(401);
  }

  /** Exchanges a signed assertion for an access token (RFC 7523), cached until near expiry. */
  private async accessToken(force: boolean): Promise<string> {
    const nowMs = this.now();
    if (!force && this.token && this.token.expiresAt - 60_000 > nowMs) return this.token.value;
    const iat = Math.floor(nowMs / 1000);
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = b64url(
      JSON.stringify({
        iss: this.account.clientEmail,
        scope: FCM_SCOPE,
        aud: OAUTH_URL,
        iat,
        exp: iat + 3600,
      }),
    );
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${claims}`);
    const signature = signer.sign(this.account.privateKey).toString('base64url');
    let res: Response;
    try {
      res = await this.fetchImpl(OAUTH_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: `${header}.${claims}.${signature}`,
        }).toString(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new PushUnavailableError(null);
    }
    const json = (await res.json().catch(() => null)) as {
      access_token?: string;
      expires_in?: number;
    } | null;
    if (!res.ok || !json?.access_token) throw new PushUnavailableError(res.status);
    this.token = {
      value: json.access_token,
      expiresAt: nowMs + (json.expires_in ?? 3600) * 1000,
    };
    return json.access_token;
  }
}
