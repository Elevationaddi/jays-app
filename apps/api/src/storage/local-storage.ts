import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import {
  OBJECT_KEY,
  type ObjectStorage,
  type SignedDownload,
  type SignedUpload,
  type StoredObject,
} from './storage.js';

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
 * Local adapter: objects on disk, URLs signed with HMAC-SHA256 and served by the API's storage
 * route. It behaves like a signed S3 URL: one object, one method, an expiry, and for uploads a
 * fixed content type and maximum size. Not for production (the environment schema refuses it).
 */
export class LocalObjectStorage implements ObjectStorage {
  private readonly root: string;

  constructor(
    directory: string,
    private readonly secret: string,
    private readonly publicBaseUrl: string,
  ) {
    this.root = resolve(directory);
  }

  private path(key: string): string {
    if (!OBJECT_KEY.test(key)) throw new Error('invalid object key');
    return join(this.root, key);
  }

  private sign(claims: StorageClaims): string {
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

  signUpload(
    key: string,
    options: { contentType: string; maxBytes: number; expiresAt: Date },
  ): SignedUpload {
    const url = this.sign({
      k: key,
      m: 'PUT',
      e: Math.floor(options.expiresAt.getTime() / 1000),
      ct: options.contentType,
      max: options.maxBytes,
    });
    return {
      url,
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
    return { url: this.sign(claims), expiresAt: options.expiresAt };
  }

  async head(key: string): Promise<StoredObject | null> {
    try {
      const [info, meta] = await Promise.all([
        stat(this.path(key)),
        readFile(`${this.path(key)}.meta.json`, 'utf8'),
      ]);
      const parsed = z.object({ contentType: z.string() }).parse(JSON.parse(meta));
      return { size: info.size, contentType: parsed.contentType };
    } catch {
      return null;
    }
  }

  async read(key: string, maxBytes: number): Promise<Buffer> {
    const handle = await open(this.path(key), 'r');
    try {
      const buffer = Buffer.alloc(maxBytes + 1);
      const { bytesRead } = await handle.read(buffer, 0, maxBytes + 1, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const target = this.path(key);
    await mkdir(dirname(target), { recursive: true });
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, bytes);
    await writeFile(`${target}.meta.json`, JSON.stringify({ contentType }));
    await rename(temp, target);
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
    await rm(`${this.path(key)}.meta.json`, { force: true });
  }
}
