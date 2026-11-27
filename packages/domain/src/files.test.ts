import { describe, expect, it } from 'vitest';
import { checkUpload, probeImage, safeFileName, sniffContentType } from './files.js';

function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

function jpeg(width: number, height: number): Uint8Array {
  // SOI, an APP0 segment, then SOF0 with the size.
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x04,
    0x00,
    0x00,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x03,
    0,
    0,
    0,
    0,
    0,
    0,
  ]);
}

function webpVp8x(width: number, height: number): Uint8Array {
  const b = new Uint8Array(30);
  b.set(
    [...'RIFF'].map((c) => c.charCodeAt(0)),
    0,
  );
  b.set(
    [...'WEBPVP8X'].map((c) => c.charCodeAt(0)),
    8,
  );
  const w = width - 1;
  const h = height - 1;
  b.set(
    [w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff],
    24,
  );
  return b;
}

const ascii = (text: string) => Uint8Array.from([...text].map((c) => c.charCodeAt(0)));
const pdf = ascii('%PDF-1.4\n% fictional\n');

describe('sniffContentType', () => {
  it('recognises the real type from magic bytes', () => {
    expect(sniffContentType(pdf)).toBe('application/pdf');
    expect(sniffContentType(png(1, 1))).toBe('image/png');
    expect(sniffContentType(jpeg(1, 1))).toBe('image/jpeg');
    expect(sniffContentType(webpVp8x(1, 1))).toBe('image/webp');
    expect(sniffContentType(ascii('<html>'))).toBeNull();
  });
});

describe('probeImage', () => {
  it('reads dimensions from PNG, JPEG and WebP headers', () => {
    expect(probeImage(png(640, 480))).toEqual({ type: 'image/png', width: 640, height: 480 });
    expect(probeImage(jpeg(1600, 400))).toEqual({ type: 'image/jpeg', width: 1600, height: 400 });
    expect(probeImage(webpVp8x(512, 512))).toEqual({ type: 'image/webp', width: 512, height: 512 });
    expect(probeImage(pdf)).toBeNull();
  });
});

describe('checkUpload', () => {
  it('refuses a file whose bytes do not match the declared type (T12 upload rejection)', () => {
    expect(checkUpload(pdf, { contentType: 'image/png', maxBytes: 100 })).toEqual({
      ok: false,
      reason: 'type_mismatch',
    });
    expect(
      checkUpload(new Uint8Array(), { contentType: 'application/pdf', maxBytes: 100 }),
    ).toEqual({ ok: false, reason: 'empty' });
    expect(checkUpload(pdf, { contentType: 'application/pdf', maxBytes: 5 })).toEqual({
      ok: false,
      reason: 'too_large',
    });
    expect(checkUpload(pdf, { contentType: 'application/pdf', maxBytes: 100 })).toMatchObject({
      ok: true,
    });
  });

  it('applies image size and shape rules per purpose', () => {
    const declared = (purpose: 'storefront_logo' | 'storefront_banner') => ({
      contentType: 'image/png',
      maxBytes: 1000,
      purpose,
    });
    expect(checkUpload(png(512, 512), declared('storefront_logo')).ok).toBe(true);
    expect(checkUpload(png(100, 100), declared('storefront_logo'))).toEqual({
      ok: false,
      reason: 'dimensions',
    });
    expect(checkUpload(png(1600, 400), declared('storefront_banner')).ok).toBe(true);
    expect(checkUpload(png(512, 512), declared('storefront_banner')).ok).toBe(false);
  });
});

describe('safeFileName', () => {
  it('strips paths, control characters and quotes', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('C:\\docs\\licence "final".pdf')).toBe('licence final.pdf');
    expect(safeFileName('رخصة.pdf')).toBe('رخصة.pdf');
    expect(safeFileName('   ')).toBe('file');
  });
});
