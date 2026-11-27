import { describe, expect, it, vi } from 'vitest';
import { ApiClientError, createApiClient } from './index.js';

function fakeFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  return vi.fn(
    async () => new Response(body === undefined ? null : JSON.stringify(body), { status, headers }),
  );
}

describe('createApiClient', () => {
  it('sends the bearer token and JSON body, and validates the response', async () => {
    const fetch = fakeFetch(200, { items: [{ code: 'DXB', name: { en: 'Dubai', ar: 'دبي' } }] });
    const client = createApiClient({
      baseUrl: 'http://api.test/v1/',
      fetch,
      accessToken: () => 'tok',
    });
    const result = await client.emirates();
    expect(result.items[0]?.code).toBe('DXB');
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api.test/v1/emirates');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer tok');
  });

  it('turns the error envelope into ApiClientError with retry information', async () => {
    const fetch = fakeFetch(
      429,
      { error: { code: 'RATE_LIMITED', message: 'Too many attempts.', requestId: 'req-12345678' } },
      { 'retry-after': '42' },
    );
    const client = createApiClient({ baseUrl: 'http://api.test/v1', fetch });
    const error = await client.login('a@example.test', 'x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
      retryAfterSeconds: 42,
      requestId: 'req-12345678',
    });
  });

  it('reports network failures distinctly so screens can offer retry', async () => {
    const client = createApiClient({
      baseUrl: 'http://api.test/v1',
      fetch: vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    });
    const error = (await client.emirates().catch((e: unknown) => e)) as ApiClientError;
    expect(error.isNetworkError).toBe(true);
  });

  it('rejects a response that does not match the contract', async () => {
    const client = createApiClient({
      baseUrl: 'http://api.test/v1',
      fetch: fakeFetch(200, { items: [{ code: 'XX' }] }),
    });
    await expect(client.emirates()).rejects.toThrow();
  });

  it('handles 204 responses', async () => {
    const client = createApiClient({
      baseUrl: 'http://api.test/v1',
      fetch: fakeFetch(204, undefined),
    });
    await expect(client.logout('a'.repeat(30))).resolves.toBeNull();
  });
});
