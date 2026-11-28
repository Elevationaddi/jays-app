import { describe, expect, it } from 'vitest';
import { SupabaseObjectStorage, StorageUnavailableError } from './supabase-storage.js';

// Mock test (ADR-0032): a fake fetch stands in for the Supabase Storage REST API.
const KEY = 'private/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.pdf';
const SECRET = 'fictional-signing-secret-at-least-32-characters-long';

function fake(responder: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return responder(url, init ?? {});
  }) as typeof fetch;
  const storage = new SupabaseObjectStorage(
    'https://fictional.supabase.co/',
    'fictional-service-role-key',
    'jays-private',
    SECRET,
    'https://api.example.test',
    fetchImpl,
  );
  return { storage, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('SupabaseObjectStorage', () => {
  it('signs an upload with the service role key and returns an absolute URL', async () => {
    const { storage, calls } = fake(() =>
      json({ url: `/object/upload/sign/jays-private/${KEY}?token=abc` }),
    );
    const upload = await storage.signUpload(KEY, {
      contentType: 'application/pdf',
      maxBytes: 1000,
      expiresAt: new Date('2030-01-01T00:00:00Z'),
    });
    expect(calls[0]!.url).toBe(
      `https://fictional.supabase.co/storage/v1/object/upload/sign/jays-private/${KEY}`,
    );
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer fictional-service-role-key');
    expect(headers.apikey).toBe('fictional-service-role-key');
    expect(upload.url).toBe(
      `https://fictional.supabase.co/storage/v1/object/upload/sign/jays-private/${KEY}?token=abc`,
    );
    expect(upload.headers['content-type']).toBe('application/pdf');
  });

  it('refuses an unexpected signing answer', async () => {
    const { storage } = fake(() => json({ url: 'https://elsewhere.example/x' }));
    await expect(
      storage.signUpload(KEY, {
        contentType: 'application/pdf',
        maxBytes: 1,
        expiresAt: new Date(),
      }),
    ).rejects.toBeInstanceOf(StorageUnavailableError);
  });

  it('signs a direct download, adding the file name for attachments', async () => {
    const { storage, calls } = fake(() =>
      json({ signedURL: `/object/sign/jays-private/${KEY}?token=xyz` }),
    );
    const res = await storage.signDirectDownload(KEY, {
      expiresAt: new Date(Date.now() + 300_000),
      fileName: 'licence copy.pdf',
      disposition: 'attachment',
    });
    const body = JSON.parse(String(calls[0]!.init.body)) as { expiresIn: number };
    expect(body.expiresIn).toBeGreaterThan(290);
    expect(body.expiresIn).toBeLessThanOrEqual(300);
    expect(res.url).toBe(
      `https://fictional.supabase.co/storage/v1/object/sign/jays-private/${KEY}?token=xyz&download=licence%20copy.pdf`,
    );
  });

  it('reports a missing object as null and other failures as unavailable', async () => {
    const missing = fake(() => new Response(null, { status: 404 }));
    expect(await missing.storage.head(KEY)).toBeNull();
    const down = fake(() => new Response(null, { status: 503 }));
    await expect(down.storage.head(KEY)).rejects.toBeInstanceOf(StorageUnavailableError);
    const found = fake(
      () =>
        new Response(null, {
          status: 200,
          headers: { 'content-length': '1234', 'content-type': 'application/pdf; charset=binary' },
        }),
    );
    expect(await found.storage.head(KEY)).toEqual({ size: 1234, contentType: 'application/pdf' });
  });

  it('reads with a byte range and never returns more than max + 1 bytes', async () => {
    const { storage, calls } = fake(() => new Response(new Uint8Array(50).fill(7)));
    const bytes = await storage.read(KEY, 10);
    expect((calls[0]!.init.headers as Record<string, string>).range).toBe('bytes=0-10');
    expect(bytes.length).toBe(11);
  });

  it('deletes by prefix and treats an already deleted object as done', async () => {
    const { storage, calls } = fake(() => new Response(null, { status: 404 }));
    await storage.delete(KEY);
    expect(calls[0]!.init.method).toBe('DELETE');
    expect(calls[0]!.url).toBe('https://fictional.supabase.co/storage/v1/object/jays-private');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ prefixes: [KEY] });
  });

  it('refuses keys it did not generate and unreachable storage', async () => {
    const { storage } = fake(() => {
      throw new Error('network down');
    });
    await expect(storage.head('../secret')).rejects.toThrow('invalid object key');
    await expect(storage.head(KEY)).rejects.toBeInstanceOf(StorageUnavailableError);
  });

  it('serves images through its own signed URLs, verified without calling Supabase', () => {
    const { storage, calls } = fake(() => json({}));
    const expiresAt = new Date(Date.now() + 60_000);
    const { url } = storage.signDownload(KEY, { expiresAt, disposition: 'inline' });
    expect(url.startsWith('https://api.example.test/')).toBe(true);
    const token = url.split('/').pop()!;
    const claims = storage.verify(token, new Date());
    expect(claims?.k).toBe(KEY);
    expect(storage.verify(token, new Date(Date.now() + 120_000))).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
