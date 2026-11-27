'use server';

import { ApiClientError } from '@jays/api-client';
import { redirect } from 'next/navigation';
import { serverApi } from '../../../lib/api';

const UUID = /^[0-9a-f-]{36}$/i;
const text = (formData: FormData, name: string) => String(formData.get(name) ?? '').trim();

function fail(error: unknown): never {
  const code = error instanceof ApiClientError ? error.code : 'INTERNAL';
  redirect(`/admin/content?error=${encodeURIComponent(code)}`);
}

export async function createCategory(formData: FormData) {
  const mode = text(formData, 'mode') === 'services' ? 'services' : 'shop';
  const parentId = text(formData, 'parentId');
  try {
    await (
      await serverApi()
    ).createCategory({
      mode,
      parentId: UUID.test(parentId) ? parentId : null,
      slug: text(formData, 'slug'),
      name: { en: text(formData, 'nameEn'), ar: text(formData, 'nameAr') },
    });
  } catch (error) {
    fail(error);
  }
  redirect('/admin/content?saved=1');
}

export async function setCategoryStatus(formData: FormData) {
  const id = text(formData, 'id');
  const status = text(formData, 'status') === 'archived' ? 'archived' : 'active';
  if (!UUID.test(id)) redirect('/admin/content');
  try {
    await (await serverApi()).updateCategory(id, { status });
  } catch (error) {
    fail(error);
  }
  redirect('/admin/content?saved=1');
}

export async function createBrand(formData: FormData) {
  try {
    await (
      await serverApi()
    ).createBrand({
      slug: text(formData, 'slug'),
      name: { en: text(formData, 'nameEn'), ar: text(formData, 'nameAr') },
    });
  } catch (error) {
    fail(error);
  }
  redirect('/admin/content?saved=1#brands');
}

export async function setBrandStatus(formData: FormData) {
  const id = text(formData, 'id');
  const status = text(formData, 'status') === 'archived' ? 'archived' : 'active';
  if (!UUID.test(id)) redirect('/admin/content');
  try {
    await (await serverApi()).updateBrand(id, { status });
  } catch (error) {
    fail(error);
  }
  redirect('/admin/content?saved=1#brands');
}
