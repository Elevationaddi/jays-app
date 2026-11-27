'use server';

import { ApiClientError } from '@jays/api-client';
import { redirect } from 'next/navigation';
import { serverApi } from '../../../lib/api';

const UUID = /^[0-9a-f-]{36}$/i;

/** Suspends or reinstates a service; the form carries the version the admin saw. */
export async function actOnService(formData: FormData) {
  const id = String(formData.get('serviceId') ?? '');
  const back = `/admin/services?status=${encodeURIComponent(String(formData.get('status') ?? 'active'))}`;
  if (!UUID.test(id)) redirect(back);
  const action = String(formData.get('action') ?? '');
  const expectedVersion = Number(formData.get('expectedVersion'));
  const reason = String(formData.get('reason') ?? '').trim();
  if ((action !== 'suspend' && action !== 'reinstate') || !Number.isInteger(expectedVersion)) {
    redirect(`${back}&error=VALIDATION_FAILED`);
  }
  try {
    await (await serverApi()).adminServiceAction(id, { action, expectedVersion, reason });
  } catch (error) {
    const code = error instanceof ApiClientError ? error.code : 'INTERNAL';
    redirect(`${back}&error=${encodeURIComponent(code)}`);
  }
  redirect(`${back}&done=1`);
}
