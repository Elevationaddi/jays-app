import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { renderPng } from '../testing/png.js';
import { MAX_INPUT_PIXELS, sanitizeImage } from './image-sanitizer.js';

/** A fictional photo: 800 x 600 JPEG with EXIF orientation 6 (rotate 90°) and GPS coordinates. */
async function photoWithGps(): Promise<Buffer> {
  return sharp({
    create: { width: 800, height: 600, channels: 3, background: { r: 200, g: 120, b: 90 } },
  })
    .jpeg()
    .withMetadata({
      orientation: 6,
      exif: {
        IFD0: { Make: 'FictionalCam', Model: 'Demo 1', Copyright: 'Fictional owner' },
        IFD3: {
          GPSLatitudeRef: 'N',
          GPSLatitude: '24/1 27/1 0/1',
          GPSLongitudeRef: 'E',
          GPSLongitude: '54/1 22/1 0/1',
        },
      },
    })
    .toBuffer();
}

describe('sanitizeImage (ADR-0036)', () => {
  it('removes EXIF and GPS metadata and applies the orientation to the pixels', async () => {
    const input = await photoWithGps();
    const before = await sharp(input).metadata();
    expect(before.exif).toBeDefined();
    expect(before.orientation).toBe(6);
    expect(input.includes(Buffer.from('FictionalCam'))).toBe(true);

    const result = await sanitizeImage(input, 'image/jpeg');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = await sharp(result.bytes).metadata();
    expect(after.exif).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    expect(after.iptc).toBeUndefined();
    expect(after.orientation).toBeUndefined();
    expect(result.bytes.includes(Buffer.from('FictionalCam'))).toBe(false);
    expect(result.bytes.includes(Buffer.from('GPS'))).toBe(false);
    // Rotated upright: width and height swap.
    expect(result.image).toEqual({ type: 'image/jpeg', width: 600, height: 800 });
  });

  it('drops data hidden after the image (for example an appended archive)', async () => {
    const png = renderPng(640, 640, { from: [51, 102, 153], to: [102, 153, 204] });
    const hidden = Buffer.from('PK\u0003\u0004fictional-hidden-archive-payload');
    const polyglot = Buffer.concat([png, hidden]);
    const result = await sanitizeImage(polyglot, 'image/png');
    // Either refused (strict decoder) or re-encoded without the trailing bytes; never kept.
    if (result.ok) {
      expect(result.bytes.includes(Buffer.from('fictional-hidden-archive-payload'))).toBe(false);
    }
  });

  it('limits the longest side and keeps the aspect ratio', async () => {
    const big = await sharp({
      create: { width: 5000, height: 2500, channels: 3, background: '#808080' },
    })
      .webp()
      .toBuffer();
    const result = await sanitizeImage(big, 'image/webp', { maxSide: 2000 });
    expect(result.ok && result.image).toEqual({ type: 'image/webp', width: 2000, height: 1000 });
  });

  it('never enlarges a small image', async () => {
    const small = renderPng(300, 200, { from: [0, 0, 0], to: [255, 255, 255] });
    const result = await sanitizeImage(small, 'image/png');
    expect(result.ok && result.image).toEqual({ type: 'image/png', width: 300, height: 200 });
  });

  it('refuses truncated or corrupt files', async () => {
    const input = await photoWithGps();
    expect(await sanitizeImage(input.subarray(0, input.length / 2), 'image/jpeg')).toEqual({
      ok: false,
      reason: 'type_mismatch',
    });
    expect(await sanitizeImage(Buffer.from('not an image at all'), 'image/png')).toEqual({
      ok: false,
      reason: 'type_mismatch',
    });
  });

  it('refuses a file whose real format differs from the declared one', async () => {
    const png = renderPng(640, 640, { from: [17, 17, 17], to: [34, 34, 34] });
    const result = await sanitizeImage(png, 'image/jpeg');
    expect(result).toEqual({ ok: false, reason: 'type_mismatch' });
  });

  it('refuses images over the pixel limit (decompression bombs) before decoding them', async () => {
    // A tiny PNG header that claims 20,000 x 20,000 pixels (400 megapixels).
    const side = 20_000;
    expect(side * side).toBeGreaterThan(MAX_INPUT_PIXELS);
    const bomb = await sharp({
      create: { width: side, height: 1, channels: 3, background: '#000000' },
    })
      .png()
      .toBuffer();
    // Patch the IHDR height to 20,000 so the header lies about its size.
    bomb.writeUInt32BE(side, 20);
    expect(await sanitizeImage(bomb, 'image/png')).toEqual({ ok: false, reason: 'type_mismatch' });
  });
});
