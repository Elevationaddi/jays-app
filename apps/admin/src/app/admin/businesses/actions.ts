'use server';

import { ApiClientError } from '@jays/api-client';
import type { BusinessActionRequest } from '@jays/contracts';
import { BUSINESS_REVIEW_ACTIONS, MODES, type BusinessReviewAction, type Mode } from '@jays/domain';
import { redirect } from 'next/navigation';
import { serverApi } from '../../../lib/api';

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Applies one review action. The form carries the version the reviewer looked at, so a decision
 * made on stale information is refused (409 VERSION_CONFLICT) instead of overwriting another's.
 */
export async function actOnBusiness(formData: FormData) {
  const id = String(formData.get('businessId') ?? '');
  if (!UUID.test(id)) redirect('/admin/businesses');
  const action = String(formData.get('action') ?? '') as BusinessReviewAction;
  const expectedVersion = Number(formData.get('expectedVersion'));
  const reason = String(formData.get('reason') ?? '').trim();
  const mode = String(formData.get('mode') ?? '') as Mode;
  const modes = formData
    .getAll('modes')
    .map(String)
    .filter((m): m is Mode => (MODES as readonly string[]).includes(m));
  if (!BUSINESS_REVIEW_ACTIONS.includes(action) || !Number.isInteger(expectedVersion)) {
    redirect(`/admin/businesses/${id}?error=VALIDATION_FAILED`);
  }
  const body = {
    action,
    expectedVersion,
    ...(reason ? { reason } : {}),
    ...(action === 'approve_mode' || action === 'reject_mode' ? { mode } : {}),
    ...(action === 'approve' && modes.length > 0 ? { modes } : {}),
  } as BusinessActionRequest;
  try {
    await (await serverApi()).adminBusinessAction(id, body);
  } catch (error) {
    const code = error instanceof ApiClientError ? error.code : 'INTERNAL';
    redirect(`/admin/businesses/${id}?error=${encodeURIComponent(code)}`);
  }
  redirect(`/admin/businesses/${id}?done=${action}`);
}
