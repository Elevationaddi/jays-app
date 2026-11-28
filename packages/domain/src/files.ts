/**
 * Upload rules (docs/09-security-testing.md: signed upload URLs, content type and size validation,
 * malware scan). The declared type is never trusted: the stored bytes are sniffed and must match.
 */
export const DOCUMENT_KINDS = [
  'trade_license',
  'tax_certificate',
  'owner_identity',
  'other',
  'home_service_license',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_CONTENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export type DocumentContentType = (typeof DOCUMENT_CONTENT_TYPES)[number];
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

export const IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageContentType = (typeof IMAGE_CONTENT_TYPES)[number];
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export const MEDIA_PURPOSES = [
  'storefront_logo',
  'storefront_banner',
  'product_image',
  'portfolio_image',
] as const;
export type MediaPurpose = (typeof MEDIA_PURPOSES)[number];
/** Purposes uploaded through the storefront endpoints (owner, manager). */
export const STOREFRONT_MEDIA_PURPOSES = ['storefront_logo', 'storefront_banner'] as const;
/** Product gallery images, uploaded through the catalog endpoints (catalog.manage). */
export const PRODUCT_IMAGES_MAX = 8;

/** Minimum and maximum pixel sizes and aspect ratio (width / height) per purpose. */
export const IMAGE_RULES: Record<
  MediaPurpose,
  { minWidth: number; minHeight: number; maxSide: number; minRatio: number; maxRatio: number }
> = {
  storefront_logo: { minWidth: 200, minHeight: 200, maxSide: 4000, minRatio: 0.8, maxRatio: 1.25 },
  storefront_banner: { minWidth: 1200, minHeight: 300, maxSide: 6000, minRatio: 2, maxRatio: 5 },
  product_image: { minWidth: 600, minHeight: 600, maxSide: 6000, minRatio: 0.5, maxRatio: 2 },
  portfolio_image: { minWidth: 600, minHeight: 600, maxSide: 6000, minRatio: 0.5, maxRatio: 2 },
};

/** Signed upload and download URLs are short-lived. */
export const UPLOAD_URL_TTL_SECONDS = 10 * 60;
export const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

export type SniffedType = 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp';

/** Detects the real file type from its first bytes. Returns null for anything else. */
export function sniffContentType(bytes: Uint8Array): SniffedType | null {
  const starts = (sig: number[], offset = 0) =>
    bytes.length >= offset + sig.length && sig.every((b, i) => bytes[offset + i] === b);
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'; // %PDF-
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return null;
}

export interface ImageInfo {
  type: 'image/jpeg' | 'image/png' | 'image/webp';
  width: number;
  height: number;
}

const u16be = (b: Uint8Array, i: number) => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
const u16le = (b: Uint8Array, i: number) => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
const u24le = (b: Uint8Array, i: number) => u16le(b, i) | ((b[i + 2] ?? 0) << 16);
const u32be = (b: Uint8Array, i: number) => ((u16be(b, i) << 16) >>> 0) + u16be(b, i + 2);

/** Reads image dimensions from PNG, JPEG or WebP headers without decoding pixels. */
export function probeImage(bytes: Uint8Array): ImageInfo | null {
  const type = sniffContentType(bytes);
  if (type === 'image/png') {
    // IHDR is the first chunk: width and height at offsets 16 and 20.
    if (bytes.length < 24 || String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') return null;
    return { type, width: u32be(bytes, 16), height: u32be(bytes, 20) };
  }
  if (type === 'image/jpeg') {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = bytes[i + 1] ?? 0;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const length = u16be(bytes, i + 2);
      // Start-of-frame markers carry the size (C0–CF except C4 DHT, C8 JPG, CC DAC).
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { type, height: u16be(bytes, i + 5), width: u16be(bytes, i + 7) };
      }
      if (length < 2) return null;
      i += 2 + length;
    }
    return null;
  }
  if (type === 'image/webp') {
    const chunk = String.fromCharCode(...bytes.slice(12, 16));
    if (chunk === 'VP8X' && bytes.length >= 30) {
      return { type, width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1 };
    }
    if (chunk === 'VP8 ' && bytes.length >= 30) {
      return { type, width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff };
    }
    if (chunk === 'VP8L' && bytes.length >= 25) {
      const b0 = bytes[21] ?? 0;
      const b1 = bytes[22] ?? 0;
      const b2 = bytes[23] ?? 0;
      const b3 = bytes[24] ?? 0;
      return {
        type,
        width: 1 + (((b1 & 0x3f) << 8) | b0),
        height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
      };
    }
    return null;
  }
  return null;
}

export type UploadCheck =
  | { ok: true; contentType: SniffedType; image?: ImageInfo }
  | { ok: false; reason: 'type_mismatch' | 'too_large' | 'empty' | 'dimensions' };

/** Checks stored bytes against what was declared, and image rules when a purpose is given. */
export function checkUpload(
  bytes: Uint8Array,
  declared: { contentType: string; maxBytes: number; purpose?: MediaPurpose },
): UploadCheck {
  if (bytes.length === 0) return { ok: false, reason: 'empty' };
  if (bytes.length > declared.maxBytes) return { ok: false, reason: 'too_large' };
  const sniffed = sniffContentType(bytes);
  if (!sniffed || sniffed !== declared.contentType) return { ok: false, reason: 'type_mismatch' };
  if (!declared.purpose) return { ok: true, contentType: sniffed };
  const image = probeImage(bytes);
  if (!image) return { ok: false, reason: 'type_mismatch' };
  const rule = IMAGE_RULES[declared.purpose];
  const ratio = image.width / image.height;
  if (
    image.width < rule.minWidth ||
    image.height < rule.minHeight ||
    Math.max(image.width, image.height) > rule.maxSide ||
    ratio < rule.minRatio ||
    ratio > rule.maxRatio
  ) {
    return { ok: false, reason: 'dimensions' };
  }
  return { ok: true, contentType: sniffed, image };
}

/** Keeps a display file name safe for headers and storage: no paths, controls or quotes. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = [...base.normalize('NFC')]
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f && !'"<>|:*?'.includes(ch);
    })
    .join('')
    .trim()
    .slice(0, 200);
  return cleaned === '' ? 'file' : cleaned;
}
