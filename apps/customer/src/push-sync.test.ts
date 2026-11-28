import { describe, expect, it } from 'vitest';
import { type PushPermission, type PushSource, stopPush, syncPush } from './push-sync';

function fakeSource(
  initial: PushPermission,
  answer: PushPermission,
  token: string | null = 'fcm-token-0123456789abcdef',
) {
  const calls: string[] = [];
  const source: PushSource = {
    platform: 'android',
    supported: () => initial !== 'unsupported',
    permission: async () => initial,
    requestPermission: async () => {
      calls.push('ask');
      return answer;
    },
    token: async () => token,
    onTokenChange: () => () => undefined,
    onOpen: () => () => undefined,
  };
  return { source, calls };
}

function fakeApi(fail = false) {
  const registered: unknown[] = [];
  const unregistered: string[] = [];
  return {
    registered,
    unregistered,
    registerPushDevice: async (body: unknown) => {
      registered.push(body);
      return body;
    },
    unregisterPushDevice: async (token: string) => {
      if (fail) throw new Error('offline');
      unregistered.push(token);
      return null;
    },
  };
}

describe('syncPush', () => {
  it('never asks the operating system unless the person chose to', async () => {
    const { source, calls } = fakeSource('undetermined', 'granted');
    const api = fakeApi();
    expect(await syncPush(api, source, { ask: false })).toEqual({
      permission: 'undetermined',
      token: null,
    });
    expect(calls).toEqual([]);
    expect(api.registered).toEqual([]);
  });

  it('asks on request and registers the token when allowed', async () => {
    const { source, calls } = fakeSource('undetermined', 'granted');
    const api = fakeApi();
    const r = await syncPush(api, source, { ask: true });
    expect(calls).toEqual(['ask']);
    expect(r.permission).toBe('granted');
    expect(api.registered).toEqual([{ token: 'fcm-token-0123456789abcdef', platform: 'android' }]);
  });

  it('registers silently when push is already allowed (sign-in, token refresh)', async () => {
    const { source, calls } = fakeSource('granted', 'granted');
    const api = fakeApi();
    await syncPush(api, source, { ask: false });
    expect(calls).toEqual([]);
    expect(api.registered).toHaveLength(1);
  });

  it('registers nothing when refused, unsupported or without a token', async () => {
    for (const [initial, answer, token] of [
      ['undetermined', 'denied', 'x'.repeat(30)],
      ['denied', 'denied', 'x'.repeat(30)],
      ['unsupported', 'unsupported', 'x'.repeat(30)],
      ['granted', 'granted', null],
    ] as const) {
      const { source } = fakeSource(initial, answer, token);
      const api = fakeApi();
      const r = await syncPush(api, source, { ask: true });
      expect(r.token).toBeNull();
      expect(api.registered).toEqual([]);
    }
  });
});

describe('stopPush', () => {
  it('unregisters the token and never blocks sign-out', async () => {
    const api = fakeApi();
    await stopPush(api, 'tok');
    expect(api.unregistered).toEqual(['tok']);
    await expect(stopPush(fakeApi(true), 'tok')).resolves.toBeUndefined();
    await stopPush(api, null);
    expect(api.unregistered).toEqual(['tok']);
  });
});
