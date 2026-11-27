import { createHash, randomUUID } from 'node:crypto';
import { checkUpload, type ImageInfo, type MediaPurpose } from '@jays/domain';
import { extensionFor, type MalwareScanner, type ObjectStorage } from './storage.js';

export type VerifyResult =
  | { ok: true; size: number; sha256: string; image?: ImageInfo }
  | {
      ok: false;
      reason: 'missing' | 'type_mismatch' | 'too_large' | 'empty' | 'malware' | 'dimensions';
    };

export function newObjectKey(
  prefix: 'private' | 'media',
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
    const scan = await scanner.scan(bytes);
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
