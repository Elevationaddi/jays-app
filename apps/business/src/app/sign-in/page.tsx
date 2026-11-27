import Link from 'next/link';
import { ErrorAlert } from '../../components/ErrorAlert';
import { TopBar } from '../../components/TopBar';
import { safeReturnTo } from '../../lib/api';
import { translator } from '../../lib/i18n';
import { signIn } from './actions';

type Search = Promise<Record<string, string | undefined>>;

export default async function SignInPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const { locale, tr } = await translator();
  const returnTo = safeReturnTo(params['returnTo'], '/business/gateway');
  return (
    <>
      <TopBar locale={locale} returnTo="/sign-in" signedIn={false} />
      <main className="page narrow">
        <h1>{tr('auth.signIn.title')}</h1>
        <p className="muted">{tr('surface.business')}</p>
        <ErrorAlert locale={locale} code={params['error']} retryAfter={params['retryAfter']} />
        <form action={signIn}>
          <input type="hidden" name="returnTo" value={returnTo} />
          <div className="field">
            <label htmlFor="identifier">{tr('auth.identifier')}</label>
            <input
              id="identifier"
              name="identifier"
              type="text"
              dir="ltr"
              autoComplete="username"
              required
              defaultValue={params['identifier'] ?? ''}
            />
          </div>
          <div className="field">
            <label htmlFor="password">{tr('auth.password')}</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          <button className="btn block" type="submit">
            {tr('common.signIn')}
          </button>
        </form>
        <p>
          <Link href="/register">{tr('auth.noAccount')}</Link>
        </p>
      </main>
    </>
  );
}
