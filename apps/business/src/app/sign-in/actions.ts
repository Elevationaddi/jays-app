'use server';

import { ApiClientError } from '@jays/api-client';
import { redirect } from 'next/navigation';
import { serverApi, safeReturnTo } from '../../lib/api';
import { storeTokens } from '../../lib/session';

function failure(path: string, error: unknown, extra: Record<string, string> = {}): never {
  const params = new URLSearchParams(extra);
  if (error instanceof ApiClientError) {
    params.set('error', error.code);
    if (error.retryAfterSeconds) params.set('retryAfter', String(error.retryAfterSeconds));
  } else {
    params.set('error', 'INTERNAL');
  }
  redirect(`${path}?${params.toString()}`);
}

export async function signIn(formData: FormData) {
  const identifier = String(formData.get('identifier') ?? '');
  const returnTo = safeReturnTo(formData.get('returnTo'), '/business/gateway');
  let destination: string;
  try {
    const api = await serverApi();
    const result = await api.login(identifier, String(formData.get('password') ?? ''));
    if (result.status === 'verification_required') {
      const c = result.challenge;
      destination = `/verify?${new URLSearchParams({ c: c.challengeId, to: c.destination, returnTo }).toString()}`;
    } else {
      await storeTokens(result.tokens);
      destination = returnTo;
    }
  } catch (error) {
    failure('/sign-in', error, { identifier, returnTo });
  }
  redirect(destination);
}

export async function register(formData: FormData) {
  const channel = formData.get('channel') === 'phone' ? 'phone' : 'email';
  const contact = String(formData.get('contact') ?? '').trim();
  const locale = formData.get('locale') === 'ar' ? 'ar' : 'en';
  let destination: string;
  try {
    const api = await serverApi();
    const challenge = await api.register({
      ...(channel === 'email' ? { email: contact } : { phone: contact }),
      password: String(formData.get('password') ?? ''),
      locale,
      acceptTerms: formData.get('acceptTerms') === 'on' ? true : (false as unknown as true),
      marketing: {
        email: formData.get('marketing.email') === 'on',
        sms: formData.get('marketing.sms') === 'on',
        push: formData.get('marketing.push') === 'on',
      },
    });
    destination = `/verify?${new URLSearchParams({ c: challenge.challengeId, to: challenge.destination }).toString()}`;
  } catch (error) {
    failure('/register', error, { channel, contact });
  }
  redirect(destination);
}

export async function verify(formData: FormData) {
  const challengeId = String(formData.get('c') ?? '');
  const to = String(formData.get('to') ?? '');
  const returnTo = safeReturnTo(formData.get('returnTo'), '/business/gateway');
  try {
    const api = await serverApi();
    const session = await api.verify(challengeId, String(formData.get('code') ?? '').trim());
    await storeTokens(session.tokens);
  } catch (error) {
    failure('/verify', error, { c: challengeId, to, returnTo });
  }
  redirect(returnTo);
}

export async function resend(formData: FormData) {
  const challengeId = String(formData.get('c') ?? '');
  const to = String(formData.get('to') ?? '');
  const returnTo = safeReturnTo(formData.get('returnTo'), '/business/gateway');
  try {
    await (await serverApi()).resend(challengeId);
  } catch (error) {
    failure('/verify', error, { c: challengeId, to, returnTo });
  }
  redirect(
    `/verify?${new URLSearchParams({ c: challengeId, to, returnTo, resent: '1' }).toString()}`,
  );
}
