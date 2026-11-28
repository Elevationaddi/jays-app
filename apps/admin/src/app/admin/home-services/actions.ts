'use server';

import { ApiClientError } from '@jays/api-client';
import { redirect } from 'next/navigation';
import { serverApi } from '../../../lib/api';

const UUID = /^[0-9a-f-]{36}$/i;
const DECISIONS = ['approve', 'reject', 'suspend', 'reinstate'] as const;

/** Approve, reject, suspend or reinstate home visits; carries the version the admin saw. */
export async function decideHomeServices(formData: FormData) {
  const id = String(formData.get('businessId') ?? '');
  if (!UUID.test(id)) redirect('/admin/home-services');
  const back = `/admin/home-services/${id}`;
  const decision = String(formData.get('decision') ?? '');
  const expectedVersion = Number(formData.get('expectedVersion'));
  const reason = String(formData.get('reason') ?? '').trim();
  if (!(DECISIONS as readonly string[]).includes(decision) || !Number.isInteger(expectedVersion)) {
    redirect(`${back}?error=VALIDATION_FAILED`);
  }
  try {
    await (
      await serverApi()
    ).adminDecideHomeServices(id, {
      decision: decision as (typeof DECISIONS)[number],
      expectedVersion,
      reason: reason || null,
    });
  } catch (error) {
    const code = error instanceof ApiClientError ? error.code : 'INTERNAL';
    redirect(`${back}?error=${encodeURIComponent(code)}`);
  }
  redirect(`${back}?done=1`);
}
