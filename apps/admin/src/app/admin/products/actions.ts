'use server';

import { ApiClientError } from '@jays/api-client';
import { PRODUCT_REVIEW_ACTIONS, type ProductReviewAction } from '@jays/domain';
import { redirect } from 'next/navigation';
import { serverApi } from '../../../lib/api';

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Applies one listing decision. The form carries the version the reviewer looked at, so a
 * decision made on stale content is refused (409 VERSION_CONFLICT).
 */
export async function actOnProduct(formData: FormData) {
  const id = String(formData.get('productId') ?? '');
  if (!UUID.test(id)) redirect('/admin/products');
  const action = String(formData.get('action') ?? '') as ProductReviewAction;
  const expectedVersion = Number(formData.get('expectedVersion'));
  const reason = String(formData.get('reason') ?? '').trim();
  if (!PRODUCT_REVIEW_ACTIONS.includes(action) || !Number.isInteger(expectedVersion)) {
    redirect(`/admin/products/${id}?error=VALIDATION_FAILED`);
  }
  try {
    await (
      await serverApi()
    ).adminProductAction(id, { action, expectedVersion, ...(reason ? { reason } : {}) });
  } catch (error) {
    const code = error instanceof ApiClientError ? error.code : 'INTERNAL';
    redirect(`/admin/products/${id}?error=${encodeURIComponent(code)}`);
  }
  redirect(`/admin/products/${id}?done=${action}`);
}
