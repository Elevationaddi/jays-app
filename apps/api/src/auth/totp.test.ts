import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, hotp, otpauthUri, totpAt, verifyTotp } from './totp.js';

// RFC 6238 appendix B test secret "12345678901234567890" (SHA-1), truncated to 6 digits.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP', () => {
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('matches RFC 6238 at t=%i', (seconds, code) => {
    expect(totpAt(RFC_SECRET, new Date(seconds * 1000))).toBe(code);
  });

  it('matches RFC 4226 HOTP vectors', () => {
    const secret = Buffer.from('12345678901234567890');
    expect([0, 1, 2].map((c) => hotp(secret, c))).toEqual(['755224', '287082', '359152']);
  });

  it('round-trips base32', () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253]);
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
  });

  it('accepts one step of drift and refuses replay of the same or an older step', () => {
    const now = new Date(1_700_000_000_000);
    const previous = totpAt(RFC_SECRET, new Date(now.getTime() - 30_000));
    const step = verifyTotp(RFC_SECRET, previous, now, null);
    expect(step).not.toBeNull();
    expect(verifyTotp(RFC_SECRET, previous, now, step)).toBeNull();
    expect(
      verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, new Date(now.getTime() - 90_000)), now, null),
    ).toBeNull();
    expect(verifyTotp(RFC_SECRET, 'abcdef', now, null)).toBeNull();
  });

  it('builds an otpauth URI authenticator apps understand', () => {
    expect(otpauthUri('Marketplace Admin', 'a@example.test', 'ABC')).toBe(
      'otpauth://totp/Marketplace%20Admin%3Aa%40example.test?secret=ABC&issuer=Marketplace+Admin&algorithm=SHA1&digits=6&period=30',
    );
  });
});
