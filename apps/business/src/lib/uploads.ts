import type { UploadTicket } from '@jays/contracts';
import type { DirectUploadTarget } from '../components/DirectUploadForm';

/** The file description a direct-upload form sends instead of the file (ADR-0033). */
export function fileMeta(
  form: FormData,
): { fileName: string; contentType: string; sizeBytes: number } | null {
  const fileName = String(form.get('fileName') ?? '').slice(0, 200);
  const contentType = String(form.get('contentType') ?? '');
  const sizeBytes = Number(form.get('sizeBytes') ?? '');
  if (!contentType || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) return null;
  return { fileName, contentType, sizeBytes };
}

/** Only what the browser needs to send the file: the scoped, short-lived signed URL. */
export function uploadTarget(ticket: UploadTicket): DirectUploadTarget {
  return {
    id: ticket.id,
    uploadUrl: ticket.uploadUrl,
    method: ticket.method,
    headers: ticket.headers,
  };
}
