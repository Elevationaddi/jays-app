import type { Params } from 'nestjs-pino';
import { REQUEST_ID_HEADER } from '@jays/contracts';
import type { ApiEnv } from '../config.js';
import { resolveRequestId } from './request-id.js';

/**
 * Structured JSON logs with a request id on every line. Credentials, cookies and payment fields are
 * redacted before they are written (docs/09-security-testing.md).
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["idempotency-key"]',
  // A guest cart token is a bearer secret for that cart.
  'req.headers["x-cart-token"]',
  'req.headers["stripe-signature"]',
  'req.headers["x-psp-signature"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.otp',
  '*.token',
  '*.refreshToken',
  '*.accessToken',
  '*.secret',
  '*.cardNumber',
  '*.cvv',
];

export function loggerParams(env: Pick<ApiEnv, 'LOG_LEVEL' | 'APP_ENV'>): Params {
  return {
    pinoHttp: {
      level: env.APP_ENV === 'test' && !process.env['TEST_LOGS'] ? 'silent' : env.LOG_LEVEL,
      redact: { paths: REDACT_PATHS, censor: '[redacted]' },
      genReqId: (req, res) => {
        const id = resolveRequestId(req);
        res.setHeader(REQUEST_ID_HEADER, id);
        return id;
      },
      customProps: () => ({ service: 'api' }),
    },
  };
}
