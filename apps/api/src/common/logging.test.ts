import { Writable } from 'node:stream';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { REDACT_PATHS } from './logging.js';

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
