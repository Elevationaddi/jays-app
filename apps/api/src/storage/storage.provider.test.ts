import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fictionalPdf } from '../testing/png.js';
import { ClamavScanner } from './clamav-scanner.js';
import { eicarTestFile } from './scanner.js';
import { SupabaseObjectStorage } from './supabase-storage.js';

/**
 * Real-provider tests (ADR-0032), run only with `pnpm --filter @jays/api test:providers` and
 * credentials in the environment. Never part of CI; no result is claimed without them.
 * - Supabase: SUPABASE_TEST_URL, SUPABASE_TEST_SERVICE_ROLE_KEY and SUPABASE_TEST_BUCKET (a
 *   private bucket in the staging project). The test object is deleted afterwards.
 * - ClamAV: CLAMAV_TEST_HOST, CLAMAV_TEST_PORT (default 3310) and CLAMAV_TEST_TLS=true|false.
 */
const url = process.env['SUPABASE_TEST_URL'];
const key = process.env['SUPABASE_TEST_SERVICE_ROLE_KEY'];
const bucket = process.env['SUPABASE_TEST_BUCKET'];
const clamHost = process.env['CLAMAV_TEST_HOST'];
const clamPort = Number(process.env['CLAMAV_TEST_PORT'] ?? 3310);
const clamTls = process.env['CLAMAV_TEST_TLS'] === 'true';

describe.skipIf(!url || !key || !bucket)('Supabase Storage (real provider)', () => {
  it('uploads with a signed URL, reads, signs a download and deletes', async () => {
    const storage = new SupabaseObjectStorage(
      url as string,
      key as string,
      bucket as string,
      'provider-test-signing-secret-not-used-elsewhere',
      'https://api.example.test',
    );
    const objectKey = `private/${randomUUID()}/${randomUUID()}.pdf`;
    const bytes = fictionalPdf('Fictional provider test');
    try {
      const upload = await storage.signUpload(objectKey, {
        contentType: 'application/pdf',
        maxBytes: bytes.length,
        expiresAt: new Date(Date.now() + 120_000),
      });
      const put = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: bytes });
      expect(put.ok).toBe(true);
      expect(await storage.head(objectKey)).toMatchObject({ size: bytes.length });
      expect((await storage.read(objectKey, bytes.length)).equals(bytes)).toBe(true);
      const download = await storage.signDirectDownload(objectKey, {
        expiresAt: new Date(Date.now() + 60_000),
        disposition: 'attachment',
        fileName: 'test.pdf',
      });
      expect((await fetch(download.url)).ok).toBe(true);
    } finally {
      await storage.delete(objectKey);
    }
    expect(await storage.head(objectKey)).toBeNull();
  });
});

describe.skipIf(!clamHost)('ClamAV (real scanner)', () => {
  it('passes a clean file and detects the EICAR test file', async () => {
    const scanner = new ClamavScanner(clamHost as string, clamPort, clamTls);
    expect(await scanner.scan(fictionalPdf('Fictional clean file'))).toEqual({ clean: true });
    const result = await scanner.scan(eicarTestFile());
    expect(result.clean).toBe(false);
  });
});
