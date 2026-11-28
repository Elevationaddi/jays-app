import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { EmailBudget } from './email-budget.js';
import { renderEmail, safeLink } from './email-templates.js';
import { FcmPushSender, PushUnavailableError } from './push.js';
import { EmailSendError, ResendNotifier } from './resend-notifier.js';

// Mock tests (ADR-0031): Resend's and Google's HTTP APIs are faked in process. Real-provider
// tests are in notify.provider.test.ts and need credentials.

describe('email templates', () => {
  it('renders the code in English and Arabic, right to left for Arabic', () => {
    const en = renderEmail({
      channel: 'email',
      to: 'a@example.test',
      template: 'otp.verify_contact',
      locale: 'en',
      params: { code: '123456' },
    });
    expect(en.subject).toContain('123456');
    expect(en.html).toContain('dir="ltr"');
    expect(en.text).toContain('123456');
    expect(en.text).toContain('10 minutes');
    const ar = renderEmail({
      channel: 'email',
      to: 'a@example.test',
      template: 'otp.password_reset',
      locale: 'ar',
      params: { code: '654321' },
    });
    expect(ar.html).toContain('dir="rtl"');
    expect(ar.html).toContain('lang="ar"');
    expect(ar.text).toContain('654321');
  });

  it('escapes every value and only links https', () => {
    const e = renderEmail({
      channel: 'email',
      to: 'a@example.test',
      template: 'notification',
      locale: 'en',
      params: { title: 'Order <b>1</b>', body: '<script>alert(1)</script> & "more"' },
    });
    expect(e.html).not.toContain('<script>');
    expect(e.html).toContain('&lt;script&gt;');
    expect(e.html).toContain('&amp; &quot;more&quot;');
    expect(safeLink('https://admin.example.test/invite?t=1')).toBe(
      'https://admin.example.test/invite?t=1',
    );
    expect(safeLink('http://localhost:3002/invite')).toBe('http://localhost:3002/invite');
    expect(safeLink('http://evil.example.test/')).toBeNull();
    expect(safeLink('javascript:alert(1)')).toBeNull();
    const invite = renderEmail({
      channel: 'email',
      to: 'a@example.test',
      template: 'admin.invite',
      locale: 'en',
      params: { link: 'javascript:alert(1)' },
    });
    expect(invite.html).not.toContain('javascript:');
  });
});

function fakeBudget() {
  const calls: string[] = [];
  const budget = {
    reserve: async (essential: boolean) => {
      calls.push(`reserve:${essential}`);
    },
    release: async (essential: boolean) => {
      calls.push(`release:${essential}`);
    },
  } as unknown as EmailBudget;
  return { budget, calls };
}

describe('ResendNotifier (mock HTTP)', () => {
  it('sends through the Resend API with the idempotency key and counts it as essential', async () => {
    const requests: { url: string; init: RequestInit }[] = [];
    const { budget, calls } = fakeBudget();
    const notifier = new ResendNotifier(
      're_fictional_key',
      'JAYS <no-reply@mail.example.test>',
      budget,
      async (url, init) => {
        requests.push({ url: String(url), init: init as RequestInit });
        return new Response(JSON.stringify({ id: 'email_1' }), { status: 200 });
      },
    );
    expect(notifier.supports('email')).toBe(true);
    expect(notifier.supports('sms')).toBe(false);
    await notifier.send({
      channel: 'email',
      to: 'person@example.test',
      template: 'otp.verify_contact',
      locale: 'ar',
      params: { code: '111222' },
      idempotencyKey: 'k-1',
    });
    expect(calls).toEqual(['reserve:true']);
    const req = requests[0]!;
    expect(req.url).toBe('https://api.resend.com/emails');
    const headers = req.init.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer re_fictional_key');
    expect(headers['idempotency-key']).toBe('k-1');
    const body = JSON.parse(String(req.init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      from: 'JAYS <no-reply@mail.example.test>',
      to: ['person@example.test'],
    });
    expect(String(body['html'])).toContain('111222');
  });

  it('gives the slot back and throws when Resend refuses, and never sends SMS', async () => {
    const { budget, calls } = fakeBudget();
    const notifier = new ResendNotifier(
      're_k',
      'a@example.test',
      budget,
      async () => new Response('{}', { status: 429 }),
    );
    const message = {
      channel: 'email' as const,
      to: 'p@example.test',
      template: 'notification' as const,
      locale: 'en' as const,
      params: { title: 't', body: 'b' },
    };
    const error = await notifier.send(message).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EmailSendError);
    expect(String((error as Error).message)).not.toContain('p@example.test');
    expect(calls).toEqual(['reserve:false', 'release:false']);
    await expect(notifier.send({ ...message, channel: 'sms' })).rejects.toBeInstanceOf(
      EmailSendError,
    );
  });
});

describe('FcmPushSender (mock HTTP)', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const account = {
    projectId: 'jays-fictional',
    clientEmail: 'push@jays-fictional.iam.gserviceaccount.com',
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
  const message = {
    token: 'device-token-0000000000',
    title: 'Hi',
    body: 'There',
    link: '/orders/1',
  };

  function fake(responses: Response[]) {
    const requests: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      requests.push({ url: String(url), init });
      if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
        return new Response(
          JSON.stringify({ access_token: `at-${requests.length}`, expires_in: 3600 }),
        );
      }
      return responses.shift() ?? new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    return { requests, fetchImpl };
  }

  it('signs a valid RS256 assertion for the messaging scope and caches the access token', async () => {
    const { requests, fetchImpl } = fake([]);
    const fcm = new FcmPushSender(account, fetchImpl, () => 1_800_000_000_000);
    expect(await fcm.send(message)).toBe('sent');
    expect(await fcm.send(message)).toBe('sent');
    const tokenCalls = requests.filter((r) => r.url.startsWith('https://oauth2'));
    expect(tokenCalls).toHaveLength(1);
    const assertion = new URLSearchParams(String(tokenCalls[0]!.init.body)).get('assertion')!;
    const [h, c, s] = assertion.split('.');
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${h}.${c}`);
    expect(verifier.verify(publicKey, Buffer.from(s!, 'base64url'))).toBe(true);
    const claims = JSON.parse(Buffer.from(c!, 'base64url').toString()) as Record<string, unknown>;
    expect(claims).toMatchObject({
      iss: account.clientEmail,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
    });
    const send = requests.find((r) => r.url.includes('/messages:send'))!;
    expect(send.url).toBe('https://fcm.googleapis.com/v1/projects/jays-fictional/messages:send');
    expect(JSON.parse(String(send.init.body))).toMatchObject({
      message: { token: message.token, notification: { title: 'Hi' }, data: { link: '/orders/1' } },
    });
  });

  it('reports unregistered tokens as invalid, retries once on 401, and throws on outages', async () => {
    const unregistered = fake([
      new Response(
        JSON.stringify({
          error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] },
        }),
        {
          status: 404,
        },
      ),
    ]);
    expect(await new FcmPushSender(account, unregistered.fetchImpl).send(message)).toBe('invalid');

    const expired = fake([
      new Response('{}', { status: 401 }),
      new Response('{}', { status: 200 }),
    ]);
    expect(await new FcmPushSender(account, expired.fetchImpl).send(message)).toBe('sent');
    expect(expired.requests.filter((r) => r.url.startsWith('https://oauth2'))).toHaveLength(2);

    const down = fake([new Response('{}', { status: 503 })]);
    await expect(new FcmPushSender(account, down.fetchImpl).send(message)).rejects.toBeInstanceOf(
      PushUnavailableError,
    );
  });
});
