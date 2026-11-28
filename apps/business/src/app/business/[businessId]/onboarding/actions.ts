'use server';

import { ApiClientError } from '@jays/api-client';
import { DOCUMENT_KINDS, MERCHANT_AGREEMENT_VERSION } from '@jays/domain';
import { redirect } from 'next/navigation';
import type { DirectUploadTarget } from '../../../../components/DirectUploadForm';
import { serverApi } from '../../../../lib/api';
import { fileMeta, uploadTarget } from '../../../../lib/uploads';

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

/** Step 1 of a direct upload (ADR-0033): the signed target for one document. */
export async function prepareDocumentUpload(formData: FormData): Promise<DirectUploadTarget> {
  const id = idOf(formData);
  const kind = String(formData.get('kind') ?? '');
  const meta = fileMeta(formData);
  if (!meta || !(DOCUMENT_KINDS as readonly string[]).includes(kind)) {
    redirect(`/business/${id}/onboarding?error=VALIDATION_FAILED#documents`);
  }
  try {
    const ticket = await (
      await serverApi()
    ).createDocumentUpload(id, {
      kind: kind as never,
      fileName: meta.fileName || 'document',
      contentType: meta.contentType as never,
      sizeBytes: meta.sizeBytes,
    });
    return uploadTarget(ticket);
  } catch (error) {
    back(id, error, '#documents');
  }
}

/** Step 3: the API checks type, size and malware before the document counts. */
export async function finishDocumentUpload(formData: FormData) {
  const id = idOf(formData);
  const failed = String(formData.get('uploadError') ?? '');
  if (failed) redirect(`/business/${id}/onboarding?error=${encodeURIComponent(failed)}#documents`);
  try {
    await (await serverApi()).completeDocument(id, String(formData.get('ticketId') ?? ''));
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
  const legalVersion = Number(formData.get('legalVersion') ?? '');
  try {
    const api = await serverApi();
    if (formData.get('onboardingAccepted') !== '1') {
      await api.acceptAgreement(id, String(formData.get('version') ?? MERCHANT_AGREEMENT_VERSION));
    }
    // The versioned agreement in force (ADR-0028), recorded with who accepted it and when.
    if (Number.isInteger(legalVersion) && legalVersion > 0) {
      await api.acceptMerchantAgreement(id, legalVersion);
    }
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
