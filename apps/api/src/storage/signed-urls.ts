import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { OBJECT_KEY } from './storage.js';

const claimsSchema = z.object({
  k: z.string().regex(OBJECT_KEY),
  m: z.enum(['GET', 'PUT']),
  e: z.number().int(),
  ct: z.string().optional(),
  max: z.number().int().positive().optional(),
  fn: z.string().optional(),
  d: z.enum(['inline', 'attachment']).optional(),
});
export type StorageClaims = z.infer<typeof claimsSchema>;

/**
 * HMAC-signed URLs served by the API's own storage route (ADR-0012, ADR-0032): one object, one
 * method, an expiry, and for uploads a fixed content type and maximum size. Images are served
 * this way with every adapter, so the CDN in front of the API can cache public images and the
 * storage provider's egress stays low.
 */
export class UrlSigner {
  constructor(
    private readonly secret: string,
    private readonly publicBaseUrl: string,
  ) {}

  sign(claims: StorageClaims): string {
    const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const mac = createHmac('sha256', this.secret).update(body).digest('base64url');
    return `${this.publicBaseUrl.replace(/\/$/, '')}/storage/objects/${body}.${mac}`;
  }

  /** Verifies a token from a signed URL. Returns null when forged, malformed or expired. */
  verify(token: string, now: Date): StorageClaims | null {
    const [body, mac, extra] = token.split('.');
    if (!body || !mac || extra !== undefined) return null;
    const expected = createHmac('sha256', this.secret).update(body).digest();
    const given = Buffer.from(mac, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    try {
      const claims = claimsSchema.parse(JSON.parse(Buffer.from(body, 'base64url').toString()));
      return claims.e * 1000 > now.getTime() ? claims : null;
    } catch {
      return null;
    }
  }
}
