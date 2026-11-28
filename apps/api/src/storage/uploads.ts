import { createHash, randomUUID } from 'node:crypto';
import { HttpStatus } from '@nestjs/common';
import { checkUpload, IMAGE_RULES, type ImageInfo, type MediaPurpose } from '@jays/domain';
import { ApiError } from '../common/error.filter.js';
import { isSanitizable, sanitizeImage } from './image-sanitizer.js';
import { extensionFor, type MalwareScanner, type ObjectStorage } from './storage.js';

export type VerifyResult =
  | { ok: true; size: number; sha256: string; image?: ImageInfo }
  | {
      ok: false;
      reason: 'missing' | 'type_mismatch' | 'too_large' | 'empty' | 'malware' | 'dimensions';
    };

/** The error a rejected upload answers with. */
export const uploadFailure = (reason: string) => {
  switch (reason) {
    case 'missing':
      return new ApiError(
        HttpStatus.CONFLICT,
        'UPLOAD_MISSING',
        'We did not receive the file. Upload it again.',
      );
    case 'malware':
      return new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'FILE_INFECTED',
        'This file failed our security scan and was deleted.',
      );
    case 'dimensions':
      return new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'IMAGE_DIMENSIONS',
        'The image size or shape is not allowed for this use.',
      );
    case 'too_large':
      return new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'FILE_TOO_LARGE',
        'The file is too large.',
      );
    case 'empty':
      return new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'FILE_EMPTY', 'The file is empty.');
    default:
      return new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'FILE_TYPE_MISMATCH',
        'The file content does not match its type.',
      );
  }
};

export function newObjectKey(
  prefix: 'private' | 'media',
  /** A business id, or a ticket id for support attachments. */
  businessId: string,
  contentType: string,
): string {
  return `${prefix}/${businessId}/${randomUUID()}.${extensionFor(contentType)}`;
}

/**
 * Checks an uploaded object before it counts: present, within size, real type equals the declared
 * type (magic bytes, not the client's header), image dimensions for media, then a malware scan of
 * the bytes exactly as uploaded. Images that pass are then re-encoded (ADR-0036): metadata such as
 * GPS location is removed, orientation applied, size limited, and the clean copy replaces the
 * original in storage. Anything that fails is deleted from storage so it can never be served.
 */
export async function verifyStoredUpload(
  storage: ObjectStorage,
  scanner: MalwareScanner,
  key: string,
  declared: {
    contentType: string;
    /** The most bytes the uploaded object may have (the declared size, capped by the hard limit). */
    maxBytes: number;
    /**
     * The hard limit for the purpose. The re-encoded copy is checked against this, not against the
     * declared size: a well-compressed upload can grow slightly when it is written again.
     */
    limitBytes: number;
    purpose?: MediaPurpose;
  },
): Promise<VerifyResult> {
  const head = await storage.head(key);
  if (!head) return { ok: false, reason: 'missing' };
  const bytes = await storage.read(key, declared.maxBytes);
  const check = checkUpload(bytes, declared);
  let result: VerifyResult;
  if (!check.ok) {
    result = { ok: false, reason: check.reason };
  } else {
    let scan: Awaited<ReturnType<MalwareScanner['scan']>>;
    try {
      scan = await scanner.scan(bytes);
    } catch {
      // Fail closed: the object stays pending and unserved, and the client can try again.
      throw new ApiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'SCANNER_UNAVAILABLE',
        'We could not check the file just now. Try again in a few minutes.',
      );
    }
    if (!scan.clean) {
      result = { ok: false, reason: 'malware' };
    } else if (isSanitizable(check.contentType)) {
      const maxSide = declared.purpose ? IMAGE_RULES[declared.purpose].maxSide : undefined;
      const clean = await sanitizeImage(bytes, check.contentType, maxSide ? { maxSide } : {});
      if (!clean.ok) {
        result = { ok: false, reason: clean.reason };
      } else if (clean.bytes.length > declared.limitBytes) {
        result = { ok: false, reason: 'too_large' };
      } else {
        // The stored object becomes the re-encoded copy; the original bytes are never served.
        await storage.put(key, clean.bytes, check.contentType);
        result = {
          ok: true,
          size: clean.bytes.length,
          sha256: createHash('sha256').update(clean.bytes).digest('hex'),
          ...(declared.purpose ? { image: clean.image } : {}),
        };
      }
    } else {
      result = {
        ok: true,
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
    }
  }
  if (!result.ok) await storage.delete(key);
  return result;
}
