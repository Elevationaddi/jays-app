import { t, type Locale } from '@jays/i18n';
import Link from 'next/link';
import { setLanguage, signOut } from './actions';

export function TopBar({
  locale,
  returnTo,
  signedIn,
  name,
}: {
  locale: Locale;
  returnTo: string;
  signedIn: boolean;
  name?: string | null;
}) {
  return (
    <header className="topbar">
      <Link href={signedIn ? '/business/gateway' : '/sign-in'} className="brand">
        {t(locale, 'app.name')}
        <small>{t(locale, 'surface.business')}</small>
      </Link>
      {name ? <span className="muted topbar-name">{name}</span> : null}
      <form action={setLanguage}>
        <input type="hidden" name="lang" value={locale === 'ar' ? 'en' : 'ar'} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <button
          className="btn ghost"
          type="submit"
          lang={locale === 'ar' ? 'en' : 'ar'}
          aria-label={t(locale, 'language.label')}
        >
          {t(locale, 'language.switch')}
        </button>
      </form>
      {signedIn ? (
        <form action={signOut}>
          <button className="btn secondary" type="submit">
            {t(locale, 'common.signOut')}
          </button>
        </form>
      ) : null}
    </header>
  );
}
