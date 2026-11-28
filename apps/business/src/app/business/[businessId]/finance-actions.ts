'use server';

import { ApiClientError } from '@jays/api-client';
import { redirect } from 'next/navigation';
import { serverApi } from '../../../lib/api';

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Opens the payment provider's hosted onboarding for payouts (ADR-0030). The provider collects
 * identity and bank details on its own site; the portal never sees them.
 */
export async function startPayoutOnboarding(f: FormData) {
  const id = String(f.get('businessId') ?? '');
  if (!UUID.test(id)) redirect('/business/gateway');
  const path = `/business/${id}/finance`;
  let url: string;
  try {
    ({ url } = await (await serverApi()).payoutOnboardingLink(id));
  } catch (error) {
    const code = error instanceof ApiClientError ? error.code : 'INTERNAL';
    redirect(`${path}?error=${encodeURIComponent(code)}`);
  }
  redirect(url);
}
