import { probeImage, type ImageInfo } from '@jays/domain';
import sharp from 'sharp';

/**
 * Image privacy and safety (ADR-0036, founder answer to question 6). Every accepted JPEG, PNG or
 * WebP is decoded and written again from its pixels, so that:
 * - EXIF, GPS location, XMP, IPTC, comments and any trailing or hidden data are dropped (sharp
 *   writes no metadata unless asked; nothing here asks);
 * - the camera orientation is applied to the pixels, so the image still looks upright without EXIF;
 * - the image is converted to sRGB, limited to `maxSide` on its longest side, and compressed;
 * - a malformed, truncated or decompression-bomb file fails to decode and is refused.
 *
 * Re-encoding is not a malware scan. Uploads are still scanned (ADR-0032) before this runs, and a
 * file that cannot be scanned is never accepted.
 */

/** Longest side kept for images that have no stricter per-purpose rule (attachments, documents). */
export const DEFAULT_MAX_SIDE = 4000;
/**
 * Decoder pixel limit: about 40 megapixels (enough for any phone photo). Larger inputs, including
 * small files that claim huge dimensions, are refused before their pixels are allocated.
 */
export const MAX_INPUT_PIXELS = 40_000_000;

export type SanitizableType = 'image/jpeg' | 'image/png' | 'image/webp';

export const isSanitizable = (type: string): type is SanitizableType =>
  type === 'image/jpeg' || type === 'image/png' || type === 'image/webp';

export type SanitizeResult =
  { ok: true; bytes: Buffer; image: ImageInfo } | { ok: false; reason: 'type_mismatch' };

const FORMATS: Record<SanitizableType, string> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
};

// Serverless instances are small: one image at a time, and no cache kept between requests.
sharp.concurrency(1);
sharp.cache(false);

export async function sanitizeImage(
  input: Uint8Array,
  type: SanitizableType,
  options: { maxSide?: number } = {},
): Promise<SanitizeResult> {
  const maxSide = options.maxSide ?? DEFAULT_MAX_SIDE;
  const decoderOptions = {
    failOn: 'warning',
    limitInputPixels: MAX_INPUT_PIXELS,
    sequentialRead: true,
    // Only the first frame of an animated image is kept: product images are stills.
    animated: false,
  } as const;
  try {
    // The decoder's own view of the format must match the declared type.
    const { format } = await sharp(input, decoderOptions).metadata();
    if (FORMATS[type] !== format) return { ok: false, reason: 'type_mismatch' };
    const pipeline = sharp(input, decoderOptions)
      .rotate()
      .toColourspace('srgb')
      .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true });
    const encoded =
      type === 'image/jpeg'
        ? pipeline.jpeg({ quality: 82, mozjpeg: true })
        : type === 'image/png'
          ? pipeline.png({ compressionLevel: 9, adaptiveFiltering: true })
          : pipeline.webp({ quality: 80 });
    const bytes = await encoded.toBuffer();
    const image = probeImage(bytes);
    if (!image || image.type !== type) return { ok: false, reason: 'type_mismatch' };
    return { ok: true, bytes, image };
  } catch {
    // Corrupt, truncated, over the pixel limit, or not really this format.
    return { ok: false, reason: 'type_mismatch' };
  }
}
