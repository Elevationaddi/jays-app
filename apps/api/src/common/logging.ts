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
  // Private staging access token (ADR-0035).
  'req.headers["x-staging-access"]',
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

/** Query parameters that carry a secret: signed-URL tokens and signatures, unsubscribe tokens. */
const SECRET_QUERY = /^(token|signature|sig|code|key|x-amz-signature|x-amz-credential|x-amz-security-token)$/i;

/**
 * Removes secrets from a URL before it is logged: the token in a signed storage URL
 * (/v1/storage/objects/<token>) and secret query parameters such as ?token= (signed URLs,
 * unsubscribe links). Anyone holding such a URL could read or write the file until it expires.
 */
export function redactUrl(url: string): string {
  const [path = '', query] = url.split('?', 2);
  const safePath = path.replace(/(\/storage\/objects\/)[^/]+/, '$1[redacted]');
  if (query === undefined) return safePath;
  const safeQuery = query
    .split('&')
    .map((pair) => {
      const [name = '', value] = pair.split('=', 2);
      return value !== undefined && SECRET_QUERY.test(decodeURIComponent(name)) ? `${name}=[redacted]` : pair;
    })
    .join('&');
  return `${safePath}?${safeQuery}`;
}

interface SerializedRequest {
  url?: string;
  query?: Record<string, unknown>;
  params?: Record<string, unknown>;
}

/** pino-http request serializer: the URL, parsed query and route params without secrets. */
export function serializeRequest<T extends SerializedRequest>(req: T): T {
  if (typeof req.url === 'string') req.url = redactUrl(req.url);
  for (const bag of [req.query, req.params]) {
    if (!bag || typeof bag !== 'object') continue;
    for (const name of Object.keys(bag)) {
      if (SECRET_QUERY.test(name)) bag[name] = '[redacted]';
    }
  }
  // Route params of the storage route hold the signed token under a wildcard or "token".
  if (req.url?.includes('/storage/objects/') && req.params) {
    for (const name of Object.keys(req.params)) req.params[name] = '[redacted]';
  }
  return req;
}

export function loggerParams(env: Pick<ApiEnv, 'LOG_LEVEL' | 'APP_ENV'>): Params {
  return {
    pinoHttp: {
      level: env.APP_ENV === 'test' && !process.env['TEST_LOGS'] ? 'silent' : env.LOG_LEVEL,
      redact: { paths: REDACT_PATHS, censor: '[redacted]' },
      serializers: { req: serializeRequest },
      genReqId: (req, res) => {
        const id = resolveRequestId(req);
        res.setHeader(REQUEST_ID_HEADER, id);
        return id;
      },
      customProps: () => ({ service: 'api' }),
    },
  };
}
