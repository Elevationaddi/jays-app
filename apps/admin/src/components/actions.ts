'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { serverApi, safeReturnTo } from '../lib/api';
import { LOCALE_COOKIE } from '../lib/locale';
import { REFRESH_COOKIE, clearTokens } from '../lib/session';

export async function setLanguage(formData: FormData) {
  const lang = formData.get('lang') === 'ar' ? 'ar' : 'en';
  (await cookies()).set(LOCALE_COOKIE, lang, {
    path: '/',
    sameSite: 'lax',
    maxAge: 365 * 24 * 3600,
  });
  redirect(safeReturnTo(formData.get('returnTo')));
}

export async function signOut() {
  const refresh = (await cookies()).get(REFRESH_COOKIE)?.value;
  if (refresh) await (await serverApi()).adminLogout(refresh).catch(() => undefined);
  await clearTokens();
  redirect('/sign-in');
}
