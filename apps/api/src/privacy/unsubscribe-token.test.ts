import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signUnsubscribe, unsubscribeKey, verifyUnsubscribe } from './unsubscribe-token.js';

const key = unsubscribeKey('local-dev-only-otp-secret-0123456789abcdef');
const user = '0b6a1f7e-3c55-4d1e-9f5a-1a2b3c4d5e6f';

describe('unsubscribe tokens', () => {
  it('round-trips the user and channel', () => {
    const token = signUnsubscribe(key, user, 'email');
    expect(verifyUnsubscribe(key, token)).toEqual({ userId: user, channel: 'email' });
  });

  it('rejects a token signed with another key', () => {
    const other = unsubscribeKey('another-secret-another-secret-another-secret');
    expect(verifyUnsubscribe(key, signUnsubscribe(other, user, 'all'))).toBeNull();
  });

  it('rejects tampered payloads and malformed input', () => {
    const token = signUnsubscribe(key, user, 'sms');
    const [, sig] = token.split('.');
    const forged = `${Buffer.from(`${user}:all`).toString('base64url')}.${sig}`;
    expect(verifyUnsubscribe(key, forged)).toBeNull();
    expect(verifyUnsubscribe(key, 'nope')).toBeNull();
    expect(verifyUnsubscribe(key, `${token}.x`)).toBeNull();
    expect(verifyUnsubscribe(key, 'a'.repeat(300))).toBeNull();
  });

  it('rejects a validly signed payload that is not a user and channel', () => {
    const bad = Buffer.from('not-a-user:email').toString('base64url');
    const sig = createHmac('sha256', key).update(bad).digest('base64url');
    expect(verifyUnsubscribe(key, `${bad}.${sig}`)).toBeNull();
  });
});
