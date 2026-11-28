import { createHmac, timingSafeEqual } from 'node:crypto';

export type UnsubscribeChannel = 'email' | 'sms' | 'push' | 'all';
const CHANNELS: readonly UnsubscribeChannel[] = ['email', 'sms', 'push', 'all'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Signed one-click unsubscribe links for marketing messages (D15). The link has to work without
 * signing in and for as long as the message sits in an inbox, so it carries the user and channel
 * and an HMAC instead of a stored token. The key is derived from OTP_SECRET with its own label,
 * so the two uses never share a raw key. A token can only withdraw consent, never grant it.
 */
export function unsubscribeKey(otpSecret: string): Buffer {
  return createHmac('sha256', otpSecret).update('jays/unsubscribe/v1').digest();
}

export function signUnsubscribe(key: Buffer, userId: string, channel: UnsubscribeChannel): string {
  const payload = Buffer.from(`${userId}:${channel}`).toString('base64url');
  const sig = createHmac('sha256', key).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyUnsubscribe(
  key: Buffer,
  token: string,
): { userId: string; channel: UnsubscribeChannel } | null {
  if (typeof token !== 'string' || token.length > 200) return null;
  const [payload, sig, extra] = token.split('.');
  if (!payload || !sig || extra !== undefined) return null;
  const expected = createHmac('sha256', key).update(payload).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const [userId, channel] = Buffer.from(payload, 'base64url').toString('utf8').split(':');
  if (!userId || !UUID.test(userId)) return null;
  if (!CHANNELS.includes(channel as UnsubscribeChannel)) return null;
  return { userId, channel: channel as UnsubscribeChannel };
}
