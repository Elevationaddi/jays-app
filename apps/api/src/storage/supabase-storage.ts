import { type StorageClaims, UrlSigner } from './signed-urls.js';
import {
  OBJECT_KEY,
  type ObjectStorage,
  type SignedDownload,
  type SignedUpload,
  type StoredObject,
} from './storage.js';

const TIMEOUT_MS = 20_000;

export class StorageUnavailableError extends Error {
  constructor(readonly status: number | null) {
    super(`storage unavailable${status ? ` (${status})` : ''}`);
    this.name = 'StorageUnavailableError';
  }
}

/**
 * Supabase Storage on the free plan (ADR-0032): one **private** bucket, reached only by the API
 * with the service role key, over the Storage REST API with `fetch` (no SDK).
 *
 * - Uploads go straight from the client to Supabase with a signed upload URL, so files never pass
 *   through a serverless function. Supabase cannot bind a signed upload to a type or size, so the
 *   API checks the stored object afterwards (type from magic bytes, size, image shape, malware)
 *   and deletes anything that fails, exactly as with the local adapter.
 * - Images are served through the API's own signed URLs (no call to Supabase to sign), which the
 *   CDN caches. Private documents and attachments use Supabase's signed download URLs.
 */
export class SupabaseObjectStorage implements ObjectStorage {
  readonly name = 'supabase' as const;
  private readonly signer: UrlSigner;
  private readonly base: string;

  constructor(
    supabaseUrl: string,
    private readonly serviceRoleKey: string,
    private readonly bucket: string,
    signingSecret: string,
    apiPublicUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.base = `${supabaseUrl.replace(/\/$/, '')}/storage/v1`;
    this.signer = new UrlSigner(signingSecret, apiPublicUrl);
  }

  private path(key: string): string {
    if (!OBJECT_KEY.test(key)) throw new Error('invalid object key');
    return `${encodeURIComponent(this.bucket)}/${key}`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      authorization: `Bearer ${this.serviceRoleKey}`,
      apikey: this.serviceRoleKey,
      ...extra,
    };
  }

  private async call(path: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(`${this.base}${path}`, {
        ...init,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new StorageUnavailableError(null);
    }
  }

  private async json(path: string, body: unknown): Promise<Record<string, unknown>> {
    const res = await this.call(path, {
      method: 'POST',
      headers: this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify(body),
    });
    const parsed = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || !parsed) throw new StorageUnavailableError(res.status);
    return parsed;
  }

  async signUpload(
    key: string,
    options: { contentType: string; maxBytes: number; expiresAt: Date },
  ): Promise<SignedUpload> {
    const res = await this.json(`/object/upload/sign/${this.path(key)}`, {});
    const url = res['url'];
    if (typeof url !== 'string' || !url.startsWith('/object/upload/sign/')) {
      throw new StorageUnavailableError(null);
    }
    return {
      url: `${this.base}${url}`,
      method: 'PUT',
      headers: { 'content-type': options.contentType },
      expiresAt: options.expiresAt,
    };
  }

  signDownload(
    key: string,
    options: { expiresAt: Date; fileName?: string; disposition: 'inline' | 'attachment' },
  ): SignedDownload {
    const claims: StorageClaims = {
      k: key,
      m: 'GET',
      e: Math.floor(options.expiresAt.getTime() / 1000),
      d: options.disposition,
    };
    if (options.fileName) claims.fn = options.fileName;
    return { url: this.signer.sign(claims), expiresAt: options.expiresAt };
  }

  async signDirectDownload(
    key: string,
    options: { expiresAt: Date; fileName?: string; disposition: 'inline' | 'attachment' },
  ): Promise<SignedDownload> {
    const expiresIn = Math.max(1, Math.floor((options.expiresAt.getTime() - Date.now()) / 1000));
    const res = await this.json(`/object/sign/${this.path(key)}`, { expiresIn });
    const signed = res['signedURL'] ?? res['signedUrl'];
    if (typeof signed !== 'string' || !signed.startsWith('/object/sign/')) {
      throw new StorageUnavailableError(null);
    }
    const download =
      options.disposition === 'attachment'
        ? `&download=${encodeURIComponent(options.fileName ?? '')}`
        : '';
    return { url: `${this.base}${signed}${download}`, expiresAt: options.expiresAt };
  }

  verify(token: string, now: Date): StorageClaims | null {
    return this.signer.verify(token, now);
  }

  async head(key: string): Promise<StoredObject | null> {
    const res = await this.call(`/object/${this.path(key)}`, {
      method: 'HEAD',
      headers: this.headers(),
    });
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) throw new StorageUnavailableError(res.status);
    const size = Number(res.headers.get('content-length'));
    const contentType = (res.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
    if (!Number.isSafeInteger(size)) throw new StorageUnavailableError(null);
    return { size, contentType };
  }

  /** Reads at most `maxBytes + 1` bytes, asking Supabase for that range and stopping there. */
  async read(key: string, maxBytes: number): Promise<Buffer> {
    const res = await this.call(`/object/${this.path(key)}`, {
      method: 'GET',
      headers: this.headers({ range: `bytes=0-${maxBytes}` }),
    });
    if (!res.ok) throw new StorageUnavailableError(res.status);
    const chunks: Buffer[] = [];
    let size = 0;
    if (res.body) {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        chunks.push(Buffer.from(chunk));
        size += chunk.length;
        if (size > maxBytes) break;
      }
    }
    return Buffer.concat(chunks).subarray(0, maxBytes + 1);
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const res = await this.call(`/object/${this.path(key)}`, {
      method: 'POST',
      headers: this.headers({ 'content-type': contentType, 'x-upsert': 'true' }),
      body: bytes,
    });
    if (!res.ok) throw new StorageUnavailableError(res.status);
  }

  async delete(key: string): Promise<void> {
    this.path(key); // validates the key
    const res = await this.call(`/object/${encodeURIComponent(this.bucket)}`, {
      method: 'DELETE',
      headers: this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({ prefixes: [key] }),
    });
    if (!res.ok && res.status !== 404) throw new StorageUnavailableError(res.status);
  }
}
