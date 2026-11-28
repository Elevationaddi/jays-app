import { createHash, randomUUID } from 'node:crypto';
import { HttpStatus } from '@nestjs/common';
import { checkUpload, type ImageInfo, type MediaPurpose } from '@jays/domain';
import { ApiError } from '../common/error.filter.js';
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
 * type (magic bytes, not the client's header), image dimensions for media, then a malware scan.
 * Anything that fails is deleted from storage so it can never be served.
 */
export async function verifyStoredUpload(
  storage: ObjectStorage,
  scanner: MalwareScanner,
  key: string,
  declared: { contentType: string; maxBytes: number; purpose?: MediaPurpose },
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
    result = scan.clean
      ? {
          ok: true,
          size: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          ...(check.image ? { image: check.image } : {}),
        }
      : { ok: false, reason: 'malware' };
  }
  if (!result.ok) await storage.delete(key);
  return result;
}
