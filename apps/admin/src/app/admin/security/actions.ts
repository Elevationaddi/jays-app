'use server';

import { ApiClientError } from '@jays/api-client';
import { PLATFORM_ROLES } from '@jays/domain';
import { redirect } from 'next/navigation';
import { serverApi } from '../../../lib/api';

export async function inviteAdmin(formData: FormData) {
  const roles = formData
    .getAll('roles')
    .map(String)
    .filter((r) => (PLATFORM_ROLES as readonly string[]).includes(r));
  try {
    await (
      await serverApi()
    ).inviteAdmin({
      email: String(formData.get('email') ?? ''),
      displayName: String(formData.get('displayName') ?? ''),
      roles: roles as never,
      reason: String(formData.get('reason') ?? ''),
    });
  } catch (error) {
    redirect(
      `/admin/security?error=${encodeURIComponent(error instanceof ApiClientError ? error.code : 'INTERNAL')}`,
    );
  }
  redirect('/admin/security?invited=1');
}
