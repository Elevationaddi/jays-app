'use server';

import { ApiClientError } from '@jays/api-client';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { serverApi, safeReturnTo } from '../../lib/api';
import { storeTokens } from '../../lib/session';

const ENROL_COOKIE = 'jays_admin_enrol';

function failure(path: string, error: unknown, extra: Record<string, string> = {}): never {
  const params = new URLSearchParams(extra);
  params.set('error', error instanceof ApiClientError ? error.code : 'INTERNAL');
  if (error instanceof ApiClientError && error.retryAfterSeconds)
    params.set('retryAfter', String(error.retryAfterSeconds));
  redirect(`${path}?${params.toString()}`);
}

export async function adminSignIn(formData: FormData) {
  const email = String(formData.get('email') ?? '');
  const returnTo = safeReturnTo(formData.get('returnTo'), '/admin/dashboard');
  try {
    const session = await (
      await serverApi()
    ).adminLogin(
      email,
      String(formData.get('password') ?? ''),
      String(formData.get('totpCode') ?? '').trim(),
    );
    await storeTokens(session.tokens);
  } catch (error) {
    failure('/sign-in', error, { email, returnTo });
  }
  redirect(returnTo);
}

/** Step 1: set a password. The enrolment secret is kept in a 10-minute HttpOnly cookie, never in a URL. */
export async function acceptInvite(formData: FormData) {
  const token = String(formData.get('token') ?? '');
  try {
    const enrolment = await (
      await serverApi()
    ).acceptAdminInvite({ token, password: String(formData.get('password') ?? '') });
    (await cookies()).set(ENROL_COOKIE, JSON.stringify({ token, ...enrolment }), {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/invite',
      maxAge: 600,
    });
  } catch (error) {
    failure('/invite', error, { token });
  }
  redirect('/invite/mfa');
}

export async function confirmMfa(formData: FormData) {
  const jar = await cookies();
  const raw = jar.get(ENROL_COOKIE)?.value;
  const token = raw ? (JSON.parse(raw) as { token: string }).token : '';
  try {
    const session = await (
      await serverApi()
    ).confirmAdminMfa({ token, totpCode: String(formData.get('totpCode') ?? '').trim() });
    await storeTokens(session.tokens);
    jar.delete({ name: ENROL_COOKIE, path: '/invite' });
  } catch (error) {
    failure('/invite/mfa', error);
  }
  redirect('/admin/dashboard');
}

export async function readEnrolment(): Promise<{ secret: string; otpauthUri: string } | null> {
  const raw = (await cookies()).get(ENROL_COOKIE)?.value;
  if (!raw) return null;
  try {
    const { secret, otpauthUri } = JSON.parse(raw) as { secret: string; otpauthUri: string };
    return { secret, otpauthUri };
  } catch {
    return null;
  }
}
