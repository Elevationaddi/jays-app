import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IMAGE_MAX_BYTES } from '@jays/domain';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderPng } from '../testing/png.js';
import { LocalObjectStorage } from './local-storage.js';
import { MockMalwareScanner } from './scanner.js';
import { verifyStoredUpload } from './uploads.js';

const KEY = 'media/0b7a4d4e-4a8b-4f43-9c43-7a1d2f6b9e10/5c1e2f3a-6b7d-4e8f-9a0b-1c2d3e4f5a6b.png';

describe('verifyStoredUpload with image re-encoding', () => {
  let dir: string;
  let storage: LocalObjectStorage;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'jays-uploads-'));
    storage = new LocalObjectStorage(dir, 'x'.repeat(32), 'http://localhost');
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('accepts a re-encoded copy that is slightly larger than the declared upload', async () => {
    // This small, well-compressed logo grows by a few hundred bytes when Sharp writes it again.
    const png = renderPng(400, 400, {
      from: [64, 140, 130],
      to: [190, 230, 215],
      disc: [24, 100, 90],
    });
    await storage.put(KEY, png, 'image/png');

    const result = await verifyStoredUpload(storage, new MockMalwareScanner(), KEY, {
      contentType: 'image/png',
      maxBytes: png.length,
      limitBytes: IMAGE_MAX_BYTES,
      purpose: 'storefront_logo',
    });

    expect(result.ok).toBe(true);
    const stored = await storage.read(KEY, IMAGE_MAX_BYTES);
    expect(result.ok && result.size).toBe(stored.length);
    expect((await sharp(stored).metadata()).format).toBe('png');
  });

  it('still refuses an upload larger than its declared size', async () => {
    const png = renderPng(400, 400, { from: [64, 140, 130], to: [190, 230, 215] });
    await storage.put(KEY, png, 'image/png');

    const result = await verifyStoredUpload(storage, new MockMalwareScanner(), KEY, {
      contentType: 'image/png',
      maxBytes: png.length - 1,
      limitBytes: IMAGE_MAX_BYTES,
      purpose: 'storefront_logo',
    });

    expect(result).toMatchObject({ ok: false });
  });
});
