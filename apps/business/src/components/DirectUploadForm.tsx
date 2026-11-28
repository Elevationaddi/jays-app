'use client';

import type { FormEvent, ReactNode } from 'react';
import { useState } from 'react';

/** What the prepare action returns: the signed upload target for this one file. */
export interface DirectUploadTarget {
  id: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
}

/**
 * Uploads a file straight from the browser to its signed storage URL (ADR-0033), so files never
 * pass through a Vercel function, whose request bodies are limited to 4.5 MB.
 *
 * 1. `prepare` (a server action) receives the form fields and the file's name, type and size, and
 *    returns the signed target, or redirects with an error.
 * 2. The browser sends the file to that URL.
 * 3. `finish` (a server action) receives the form fields, `ticketId` and, if sending failed,
 *    `uploadError`. It asks the API to check and scan the file, then redirects.
 */
export function DirectUploadForm({
  prepare,
  finish,
  className,
  children,
}: {
  prepare: (form: FormData) => Promise<DirectUploadTarget>;
  finish: (form: FormData) => Promise<void>;
  className?: string;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const file = fields.get('file');
    if (!(file instanceof File) || file.size === 0) {
      form.reportValidity();
      return;
    }
    fields.delete('file');
    fields.set('fileName', file.name);
    fields.set('contentType', file.type);
    fields.set('sizeBytes', String(file.size));
    setBusy(true);
    try {
      const target = await prepare(fields);
      let uploadError = '';
      try {
        const res = await fetch(target.uploadUrl, {
          method: target.method,
          headers: target.headers,
          body: file,
        });
        if (!res.ok) uploadError = res.status === 413 ? 'FILE_TOO_LARGE' : 'UPLOAD_FAILED';
      } catch {
        uploadError = 'NETWORK_ERROR';
      }
      fields.set('ticketId', target.id);
      if (uploadError) fields.set('uploadError', uploadError);
      await finish(fields);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className={className} aria-busy={busy}>
      <fieldset disabled={busy} className="plain">
        {children}
      </fieldset>
    </form>
  );
}
