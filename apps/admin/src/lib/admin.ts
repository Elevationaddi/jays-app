import { ApiClientError } from '@jays/api-client';
import { redirect } from 'next/navigation';
import { serverApi } from './api';

/** Loads the signed-in admin or sends the visitor to sign in. */
export async function requireAdmin(returnTo: string) {
  const api = await serverApi();
  try {
    return { api, admin: await api.adminMe() };
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 401)
      redirect(`/sign-in?returnTo=${encodeURIComponent(returnTo)}`);
    throw error;
  }
}
