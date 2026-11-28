import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/** Header the portals (server side) and the staging customer build send on every API call. */
export const STAGING_ACCESS_HEADER = 'x-staging-access';

/**
 * Paths that stay reachable without the staging header, each because it has its own protection or
 * is opened by something that cannot add a header:
 * - health: liveness and readiness carry no data (Vercel and uptime checks);
 * - webhooks: Stripe cannot add headers; every webhook is verified by its signature;
 * - internal/cron: Vercel Cron, protected by CRON_SECRET;
 * - metrics: protected by METRICS_TOKEN;
 * - storage/objects: links opened by `<img>` tags and browsers, each HMAC-signed and short-lived;
 * - unsubscribe: links in emails, each carrying a signed one-time token;
 * - mock-psp: the mock test payment page opened in a browser (only exists with PSP_PROVIDER=mock).
 */
const OPEN_PREFIXES = [
  '/v1/health',
  '/v1/webhooks/',
  '/v1/internal/cron/',
  '/v1/metrics',
  '/v1/storage/objects/',
  '/v1/unsubscribe',
  '/v1/mock-psp/',
];

export function isOpenPath(path: string): boolean {
  return OPEN_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`),
  );
}

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * Private staging (ADR-0035). When a staging access token is configured:
 * - every response says `X-Robots-Tag: noindex, nofollow` and `/robots.txt` disallows everything;
 * - every other request must carry `x-staging-access: <token>` (compared in constant time), or it
 *   gets `401` with the standard error envelope and nothing else.
 * CORS preflights pass so that browsers can learn the header is allowed; the real request is gated.
 */
export function stagingGate(token: string | undefined) {
  const expected = token ? digest(token) : null;
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!expected) {
      next();
      return;
    }
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    const path = req.path;
    if (path === '/robots.txt') {
      res.type('text/plain').send('User-agent: *\nDisallow: /\n');
      return;
    }
    if (req.method === 'OPTIONS' || isOpenPath(path)) {
      next();
      return;
    }
    const supplied = req.headers[STAGING_ACCESS_HEADER];
    const value = Array.isArray(supplied) ? supplied[0] : supplied;
    if (typeof value === 'string' && timingSafeEqual(digest(value), expected)) {
      next();
      return;
    }
    const requestId = (req as Request & { id?: unknown }).id;
    res.status(401).json({
      error: {
        code: 'STAGING_ACCESS_REQUIRED',
        message: 'This is a private staging environment.',
        requestId: String(requestId ?? 'unknown'),
      },
    });
  };
}
