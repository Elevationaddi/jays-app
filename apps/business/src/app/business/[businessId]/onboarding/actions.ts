'use server';

import { ApiClientError } from '@jays/api-client';
import { DOCUMENT_KINDS, MERCHANT_AGREEMENT_VERSION } from '@jays/domain';
import { redirect } from 'next/navigation';
import { serverApi } from '../../../../lib/api';

const UUID = /^[0-9a-f-]{36}$/i;

function idOf(formData: FormData): string {
  const id = String(formData.get('businessId') ?? '');
  if (!UUID.test(id)) redirect('/business/gateway');
  return id;
}

function back(id: string, error: unknown, anchor = ''): never {
  const code = error instanceof ApiClientError ? error.code : 'INTERNAL';
  redirect(`/business/${id}/onboarding?error=${encodeURIComponent(code)}${anchor}`);
}

const text = (formData: FormData, name: string) => {
  const value = String(formData.get(name) ?? '').trim();
  return value === '' ? undefined : value;
};

export async function saveLegalProfile(formData: FormData) {
  const id = idOf(formData);
  const taxRegistered = formData.get('taxRegistered') === 'on';
  const emirate = text(formData, 'emirate');
  try {
    await (
      await serverApi()
    ).updateOnboarding(id, {
      legalName: text(formData, 'legalName'),
      tradeLicenseNumber: text(formData, 'tradeLicenseNumber'),
      licenseAuthority: text(formData, 'licenseAuthority'),
      licenseExpiry: text(formData, 'licenseExpiry'),
      taxRegistered,
      taxId: taxRegistered ? (text(formData, 'taxId') ?? null) : null,
      ...(emirate
        ? {
            address: {
              emirate: emirate as never,
              area: text(formData, 'area') ?? '',
              street: text(formData, 'street') ?? '',
              building: text(formData, 'building') ?? '',
              unit: text(formData, 'unit') ?? null,
            },
          }
        : {}),
    });
  } catch (error) {
    back(id, error, '#legal');
  }
  redirect(`/business/${id}/onboarding?saved=legal#legal`);
}

export async function uploadDocument(formData: FormData) {
  const id = idOf(formData);
  const file = formData.get('file');
  const kind = String(formData.get('kind') ?? '');
  if (
    !(file instanceof File) ||
    file.size === 0 ||
    !(DOCUMENT_KINDS as readonly string[]).includes(kind)
  ) {
    redirect(`/business/${id}/onboarding?error=VALIDATION_FAILED#documents`);
  }
  try {
    const api = await serverApi();
    const ticket = await api.createDocumentUpload(id, {
      kind: kind as never,
      fileName: file.name || 'document',
      contentType: file.type as never,
      sizeBytes: file.size,
    });
    await api.upload(ticket, new Uint8Array(await file.arrayBuffer()));
    await api.completeDocument(id, ticket.id);
  } catch (error) {
    back(id, error, '#documents');
  }
  redirect(`/business/${id}/onboarding?saved=document#documents`);
}

export async function removeDocument(formData: FormData) {
  const id = idOf(formData);
  try {
    await (await serverApi()).removeDocument(id, String(formData.get('documentId') ?? ''));
  } catch (error) {
    back(id, error, '#documents');
  }
  redirect(`/business/${id}/onboarding#documents`);
}

export async function acceptAgreement(formData: FormData) {
  const id = idOf(formData);
  if (formData.get('accept') !== 'on')
    redirect(`/business/${id}/onboarding?error=VALIDATION_FAILED#agreement`);
  try {
    await (
      await serverApi()
    ).acceptAgreement(id, String(formData.get('version') ?? MERCHANT_AGREEMENT_VERSION));
  } catch (error) {
    back(id, error, '#agreement');
  }
  redirect(`/business/${id}/onboarding#agreement`);
}

export async function submitForReview(formData: FormData) {
  const id = idOf(formData);
  try {
    await (await serverApi()).submitBusiness(id);
  } catch (error) {
    back(id, error);
  }
  redirect(`/business/${id}/onboarding?saved=submitted`);
}
