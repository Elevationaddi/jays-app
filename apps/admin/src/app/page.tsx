import { t } from '@jays/i18n';
import { colors, spacing } from '@jays/ui';
import { cookies, headers } from 'next/headers';
import { LOCALE_COOKIE, resolveLocale } from '../lib/locale';

// Foundation page only: names the surface and states plainly that no features exist yet.
export default async function Home() {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
  const locale = resolveLocale(
    cookieStore.get(LOCALE_COOKIE)?.value,
    headerList.get('accept-language'),
  );
  return (
    <main style={{ padding: spacing[4], maxWidth: 720, marginInline: 'auto' }}>
      <h1 style={{ color: colors.accent }}>{t(locale, 'surface.admin')}</h1>
      <p style={{ color: colors.textMuted }}>{t(locale, 'app.scaffoldNotice')}</p>
    </main>
  );
}
