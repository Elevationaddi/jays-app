import { describe, expect, it } from 'vitest';
import { AccessTokens } from './jwt.js';
import {
  generateOtp,
  hashOtp,
  hashPassword,
  maskContact,
  SecretBox,
  verifyPassword,
} from './crypto.js';

describe('passwords', () => {
  it('hashes with Argon2id and verifies', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
    expect(await verifyPassword(hash, 'correct horse battery')).toBe(true);
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });
});

describe('one-time codes', () => {
  it('are six digits and hashed per challenge', () => {
    for (let i = 0; i < 50; i++) expect(generateOtp()).toMatch(/^\d{6}$/);
    expect(hashOtp('k'.repeat(32), 'a', '123456')).not.toBe(hashOtp('k'.repeat(32), 'b', '123456'));
  });
});

describe('SecretBox', () => {
  it('encrypts with authentication', () => {
    const box = new SecretBox('local-dev-only-test-key-000000000000');
    const sealed = box.seal('JBSWY3DPEHPK3PXP');
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(box.open(sealed)).toBe('JBSWY3DPEHPK3PXP');
    const tampered = sealed.slice(0, -2) + (sealed.endsWith('A') ? 'BB' : 'AA');
    expect(() => box.open(tampered)).toThrow();
    expect(() => new SecretBox('another-key-material-000000000000000').open(sealed)).toThrow();
  });
});

describe('maskContact', () => {
  it('hides most of an email or phone number', () => {
    expect(maskContact('noor@example.test')).toBe('n***@example.test');
    expect(maskContact('+971501234567')).toBe('+97150*****67');
  });
});

describe('AccessTokens', () => {
  const now = new Date('2027-01-01T00:00:00Z');
  const tokens = new AccessTokens([{ kid: 'k1', secret: 'local-dev-only-0000000000000000000000' }]);

  it('signs and verifies within lifetime, for the right audience only', async () => {
    const { token } = await tokens.sign({ sub: 'u1', sid: 's1', aud: 'user' }, now, 900);
    expect(await tokens.verify(token, 'user', now)).toEqual({ sub: 'u1', sid: 's1', aud: 'user' });
    expect(await tokens.verify(token, 'admin', now)).toBeNull();
    expect(await tokens.verify(token, 'user', new Date(now.getTime() + 901_000))).toBeNull();
  });

  it('verifies with a retired key during rotation and rejects unknown keys', async () => {
    const old = new AccessTokens([
      { kid: 'old', secret: 'local-dev-only-old-00000000000000000000' },
    ]);
    const { token } = await old.sign({ sub: 'u1', sid: 's1', aud: 'user' }, now, 900);
    const rotated = new AccessTokens([
      { kid: 'new', secret: 'local-dev-only-new-00000000000000000000' },
      { kid: 'old', secret: 'local-dev-only-old-00000000000000000000' },
    ]);
    expect(await rotated.verify(token, 'user', now)).not.toBeNull();
    expect(await tokens.verify(token, 'user', now)).toBeNull();
  });

  it('rejects a token with alg none or a forged signature', async () => {
    const { token } = await tokens.sign({ sub: 'u1', sid: 's1', aud: 'user' }, now, 900);
    const [header, payload] = token.split('.');
    const none = `${Buffer.from(JSON.stringify({ alg: 'none', kid: 'k1' })).toString('base64url')}.${payload}.`;
    expect(await tokens.verify(none, 'user', now)).toBeNull();
    expect(await tokens.verify(`${header}.${payload}.AAAA`, 'user', now)).toBeNull();
  });
});
