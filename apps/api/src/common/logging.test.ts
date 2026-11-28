import { Writable } from 'node:stream';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { REDACT_PATHS, redactUrl, serializeRequest } from './logging.js';

describe('log redaction (phase 11)', () => {
  it('never writes credentials, cart tokens or webhook signatures', () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _enc, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const log = pino({ redact: { paths: REDACT_PATHS, censor: '[redacted]' } }, sink);
    const secrets = {
      authorization: 'Bearer fictional-access-token',
      cookie: 'session=fictional',
      'x-cart-token': 'fictional-cart-token-123',
      'stripe-signature': 't=1,v1=fictionalsignature',
      'x-psp-signature': 'fictional-mock-signature',
    };
    log.info({ req: { headers: secrets }, body: { password: 'Fictional-Passw0rd' } }, 'request');
    const out = lines.join('');
    for (const value of [...Object.values(secrets), 'Fictional-Passw0rd']) {
      expect(out).not.toContain(value);
    }
    expect(out).toContain('[redacted]');
  });
});

describe('signed URL redaction', () => {
  it('removes the token from signed storage URLs and secret query parameters', () => {
    expect(redactUrl('/v1/storage/objects/eyJhbGciOi.fictional.sig')).toBe('/v1/storage/objects/[redacted]');
    expect(redactUrl('/v1/unsubscribe?token=fictional.token&lang=ar')).toBe('/v1/unsubscribe?token=[redacted]&lang=ar');
    expect(
      redactUrl('/storage/v1/object/upload/sign/jays-files/a.png?token=fictional-supabase-token'),
    ).toBe('/storage/v1/object/upload/sign/jays-files/a.png?token=[redacted]');
    expect(redactUrl('/v1/products?q=oud&cursor=abc')).toBe('/v1/products?q=oud&cursor=abc');
  });

  it('cleans the request the HTTP logger writes', () => {
    const req = serializeRequest({
      url: '/v1/storage/objects/fictional-signed-token?download=1',
      query: { download: '1' },
      params: { splat: ['storage', 'objects', 'fictional-signed-token'] as unknown },
    });
    const out = JSON.stringify(req);
    expect(out).not.toContain('fictional-signed-token');
    const unsub = serializeRequest({ url: '/v1/unsubscribe?token=abc.def', query: { token: 'abc.def' } });
    expect(JSON.stringify(unsub)).not.toContain('abc.def');
  });

  it('redacts the staging access header', () => {
    expect(REDACT_PATHS).toContain('req.headers["x-staging-access"]');
  });
});
