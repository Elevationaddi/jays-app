import { ErrorAlert } from '../../components/ErrorAlert';
import { TopBar } from '../../components/TopBar';
import { safeReturnTo } from '../../lib/api';
import { translator } from '../../lib/i18n';
import { adminSignIn } from './actions';

type Search = Promise<Record<string, string | undefined>>;

export default async function AdminSignInPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const { locale, tr } = await translator();
  return (
    <>
      <TopBar locale={locale} returnTo="/sign-in" signedIn={false} />
      <main className="page narrow">
        <h1>{tr('admin.signIn.title')}</h1>
        <p className="muted">{tr('admin.signIn.mfaNote')}</p>
        <ErrorAlert locale={locale} code={params['error']} retryAfter={params['retryAfter']} />
        <form action={adminSignIn}>
          <input
            type="hidden"
            name="returnTo"
            value={safeReturnTo(params['returnTo'], '/admin/dashboard')}
          />
          <div className="field">
            <label htmlFor="email">{tr('auth.email')}</label>
            <input
              id="email"
              name="email"
              type="email"
              dir="ltr"
              autoComplete="username"
              required
              defaultValue={params['email'] ?? ''}
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
          <div className="field">
            <label htmlFor="totpCode">{tr('admin.totp')}</label>
            <input
              id="totpCode"
              name="totpCode"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              dir="ltr"
              required
            />
          </div>
          <button className="btn block" type="submit">
            {tr('common.signIn')}
          </button>
        </form>
      </main>
    </>
  );
}
