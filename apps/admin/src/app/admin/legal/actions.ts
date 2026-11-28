'use server';

import { ApiClientError } from '@jays/api-client';
import { LEGAL_DOCUMENT_KINDS, type LegalDocumentKind } from '@jays/domain';
import { redirect } from 'next/navigation';
import { serverApi } from '../../../lib/api';

const UUID = /^[0-9a-f-]{36}$/i;

function fail(path: string, error: unknown): never {
  const code = error instanceof ApiClientError ? error.code : 'INTERNAL';
  redirect(`${path}?error=${encodeURIComponent(code)}`);
}

/** Starts the next version of a document as a draft, copied from the version the admin chose. */
export async function createLegalDraft(formData: FormData) {
  const kind = String(formData.get('kind') ?? '');
  const fromId = String(formData.get('fromId') ?? '');
  if (!(LEGAL_DOCUMENT_KINDS as readonly string[]).includes(kind) || !UUID.test(fromId)) {
    redirect('/admin/legal?error=VALIDATION_FAILED');
  }
  let id: string;
  try {
    const api = await serverApi();
    const from = await api.adminLegalDocument(fromId);
    const draft = await api.adminCreateLegalDraft({
      kind: kind as LegalDocumentKind,
      title: from.title,
      body: from.body,
      summaryOfChanges: null,
    });
    id = draft.id;
  } catch (error) {
    fail('/admin/legal', error);
  }
  redirect(`/admin/legal/${id}`);
}

/** Saves a draft's text. Published versions are frozen; the API refuses them. */
export async function updateLegalDraft(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  if (!UUID.test(id)) redirect('/admin/legal');
  const back = `/admin/legal/${id}`;
  const text = (name: string) => String(formData.get(name) ?? '');
  const summary = text('summaryOfChanges').trim();
  try {
    await (
      await serverApi()
    ).adminUpdateLegalDraft(id, {
      title: { en: text('titleEn'), ar: text('titleAr') },
      body: { en: text('bodyEn'), ar: text('bodyAr') },
      summaryOfChanges: summary || null,
    });
  } catch (error) {
    fail(back, error);
  }
  redirect(`${back}?done=saved`);
}

/**
 * Publishes a draft so people see and accept it. Outside production only: the API refuses in
 * production until a lawyer's review is recorded (ADR-0028).
 */
export async function publishLegalDraft(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  if (!UUID.test(id)) redirect('/admin/legal');
  const back = `/admin/legal/${id}`;
  if (formData.get('confirm') !== 'on') redirect(`${back}?error=VALIDATION_FAILED`);
  const effective = String(formData.get('effectiveAt') ?? '').trim();
  try {
    await (
      await serverApi()
    ).adminPublishLegal(
      id,
      effective ? { effectiveAt: new Date(`${effective}:00+04:00`).toISOString() } : {},
    );
  } catch (error) {
    fail(back, error);
  }
  redirect(`${back}?done=published`);
}
