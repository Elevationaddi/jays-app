'use server';

import { ApiClientError } from '@jays/api-client';
import { EMIRATE_CODES } from '@jays/domain';
import { redirect } from 'next/navigation';
import { serverApi } from '../../../lib/api';
import type { DirectUploadTarget } from '../../../components/DirectUploadForm';
import { fileMeta, uploadTarget } from '../../../lib/uploads';
import { parseAed } from '../../../lib/workspace';

const UUID = /^[0-9a-f-]{36}$/i;
const text = (f: FormData, name: string) => String(f.get(name) ?? '').trim();
const orNull = (value: string) => (value === '' ? null : value);

function businessPath(f: FormData) {
  const id = text(f, 'businessId');
  if (!UUID.test(id)) redirect('/business/gateway');
  return { id, path: `/business/${id}/services/home` };
}

function fail(path: string, error: unknown): never {
  const code = error instanceof ApiClientError ? error.code : 'INTERNAL';
  redirect(`${path}?error=${encodeURIComponent(code)}`);
}

/** Rows are area-0, area-1, …; a row without an emirate is skipped. */
function areasOf(f: FormData) {
  const areas: {
    emirate: (typeof EMIRATE_CODES)[number];
    area: string | null;
    travelFeeFils: number;
  }[] = [];
  for (let i = 0; i < 50; i += 1) {
    const emirate = text(f, `emirate-${i}`);
    if (!emirate) continue;
    if (!(EMIRATE_CODES as readonly string[]).includes(emirate)) continue;
    areas.push({
      emirate: emirate as (typeof EMIRATE_CODES)[number],
      area: orNull(text(f, `area-${i}`)),
      travelFeeFils: parseAed(f.get(`fee-${i}`)) ?? 0,
    });
  }
  return areas;
}

export async function saveHomeServices(f: FormData) {
  const { id, path } = businessPath(f);
  const buffer = Number(text(f, 'travelBufferMin'));
  try {
    await (
      await serverApi()
    ).saveHomeServices(id, {
      licenseNumber: orNull(text(f, 'licenseNumber')),
      licenseAuthority: orNull(text(f, 'licenseAuthority')),
      licenseExpiry: orNull(text(f, 'licenseExpiry')),
      licenseDocumentId: orNull(text(f, 'licenseDocumentId')),
      travelBufferMin: Number.isInteger(buffer) ? buffer : -1,
      minOrderFils: parseAed(f.get('minOrder')) ?? 0,
      areas: areasOf(f),
    });
  } catch (error) {
    fail(path, error);
  }
  redirect(`${path}?saved=1`);
}

/** Step 1 of a direct upload of the home-visit licence (ADR-0033). */
export async function prepareHomeLicenceUpload(f: FormData): Promise<DirectUploadTarget> {
  const { id, path } = businessPath(f);
  const meta = fileMeta(f);
  if (!meta) redirect(`${path}?error=VALIDATION_FAILED`);
  try {
    const ticket = await (
      await serverApi()
    ).createDocumentUpload(id, {
      kind: 'home_service_license',
      fileName: meta.fileName || 'licence',
      contentType: meta.contentType as never,
      sizeBytes: meta.sizeBytes,
    });
    return uploadTarget(ticket);
  } catch (error) {
    fail(path, error);
  }
}

/** Step 3: the API checks and scans the licence before it counts. */
export async function finishHomeLicenceUpload(f: FormData) {
  const { id, path } = businessPath(f);
  const failed = String(f.get('uploadError') ?? '');
  if (failed) redirect(`${path}?error=${encodeURIComponent(failed)}`);
  try {
    await (await serverApi()).completeDocument(id, String(f.get('ticketId') ?? ''));
  } catch (error) {
    fail(path, error);
  }
  redirect(`${path}?saved=1`);
}

export async function submitHomeServices(f: FormData) {
  const { id, path } = businessPath(f);
  try {
    await (await serverApi()).submitHomeServices(id);
  } catch (error) {
    fail(path, error);
  }
  redirect(`${path}?saved=1`);
}
