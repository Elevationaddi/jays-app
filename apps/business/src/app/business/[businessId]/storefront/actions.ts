'use server';

import { ApiClientError } from '@jays/api-client';
import { IMAGE_CONTENT_TYPES, MEDIA_PURPOSES } from '@jays/domain';
import { redirect } from 'next/navigation';
import { serverApi } from '../../../../lib/api';

const UUID = /^[0-9a-f-]{36}$/i;

function idOf(formData: FormData): string {
  const id = String(formData.get('businessId') ?? '');
  if (!UUID.test(id)) redirect('/business/gateway');
  return id;
}

function back(id: string, error: unknown): never {
  const code = error instanceof ApiClientError ? error.code : 'INTERNAL';
  redirect(`/business/${id}/storefront?error=${encodeURIComponent(code)}`);
}

const text = (formData: FormData, name: string) => String(formData.get(name) ?? '').trim();

/** Saves names and descriptions. Both languages are required by the API (docs/08-design.md). */
export async function saveStorefront(formData: FormData) {
  const id = idOf(formData);
  try {
    await (
      await serverApi()
    ).updateStorefront(id, {
      name: { en: text(formData, 'nameEn'), ar: text(formData, 'nameAr') },
      description: { en: text(formData, 'descriptionEn'), ar: text(formData, 'descriptionAr') },
    });
  } catch (error) {
    back(id, error);
  }
  redirect(`/business/${id}/storefront?saved=1`);
}

/**
 * Uploads a logo or banner: signed upload ticket, PUT, server-side check (type, size, dimensions,
 * malware), then attaches the image to the storefront draft.
 */
export async function uploadStorefrontImage(formData: FormData) {
  const id = idOf(formData);
  const file = formData.get('file');
  const purpose = String(formData.get('purpose') ?? '');
  if (
    !(file instanceof File) ||
    file.size === 0 ||
    !(MEDIA_PURPOSES as readonly string[]).includes(purpose) ||
    !(IMAGE_CONTENT_TYPES as readonly string[]).includes(file.type)
  ) {
    redirect(`/business/${id}/storefront?error=VALIDATION_FAILED`);
  }
  try {
    const api = await serverApi();
    const ticket = await api.createMediaUpload(id, {
      purpose: purpose as never,
      contentType: file.type as never,
      sizeBytes: file.size,
    });
    await api.upload(ticket, new Uint8Array(await file.arrayBuffer()));
    await api.completeMedia(id, ticket.id);
    await api.updateStorefront(
      id,
      purpose === 'storefront_logo' ? { logoMediaId: ticket.id } : { bannerMediaId: ticket.id },
    );
  } catch (error) {
    back(id, error);
  }
  redirect(`/business/${id}/storefront?saved=1`);
}

export async function removeStorefrontImage(formData: FormData) {
  const id = idOf(formData);
  const purpose = String(formData.get('purpose') ?? '');
  try {
    await (
      await serverApi()
    ).updateStorefront(
      id,
      purpose === 'storefront_logo' ? { logoMediaId: null } : { bannerMediaId: null },
    );
  } catch (error) {
    back(id, error);
  }
  redirect(`/business/${id}/storefront?saved=1`);
}
