import type { SigningKey } from '@jays/config';
import { errors, jwtVerify, SignJWT } from 'jose';

export type Audience = 'user' | 'admin';

export interface AccessClaims {
  sub: string;
  sid: string;
  aud: Audience;
}

const ISSUER = 'jays-api';

/**
 * Short-lived HS256 access tokens. The token proves identity and session only; roles, business
 * memberships and permissions are always read from the database (never from token claims).
 */
export class AccessTokens {
  private readonly keys: Map<string, Uint8Array>;
  private readonly signing: SigningKey;

  constructor(keys: SigningKey[]) {
    const [first] = keys;
    if (!first) throw new Error('At least one JWT signing key is required');
    this.signing = first;
    this.keys = new Map(keys.map((k) => [k.kid, new TextEncoder().encode(k.secret)]));
  }

  async sign(
    claims: AccessClaims,
    now: Date,
    ttlSeconds: number,
  ): Promise<{ token: string; expiresAt: Date }> {
    const iat = Math.floor(now.getTime() / 1000);
    const exp = iat + ttlSeconds;
    const token = await new SignJWT({ sid: claims.sid })
      .setProtectedHeader({ alg: 'HS256', kid: this.signing.kid, typ: 'JWT' })
      .setSubject(claims.sub)
      .setAudience(claims.aud)
      .setIssuer(ISSUER)
      .setIssuedAt(iat)
      .setExpirationTime(exp)
      .sign(this.keys.get(this.signing.kid) as Uint8Array);
    return { token, expiresAt: new Date(exp * 1000) };
  }

  /** Returns the claims, or null for any invalid, expired or wrong-audience token. */
  async verify(token: string, audience: Audience, now: Date): Promise<AccessClaims | null> {
    try {
      const { payload } = await jwtVerify(
        token,
        (header) => {
          const key = header.kid ? this.keys.get(header.kid) : undefined;
          if (!key) throw new errors.JWSSignatureVerificationFailed('unknown key');
          return key;
        },
        { algorithms: ['HS256'], audience, issuer: ISSUER, currentDate: now },
      );
      if (typeof payload.sub !== 'string' || typeof payload['sid'] !== 'string') return null;
      return { sub: payload.sub, sid: payload['sid'], aud: audience };
    } catch {
      return null;
    }
  }
}
