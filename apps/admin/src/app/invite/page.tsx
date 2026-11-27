import { ErrorAlert } from '../../components/ErrorAlert';
import { TopBar } from '../../components/TopBar';
import { translator } from '../../lib/i18n';
import { acceptInvite } from '../sign-in/actions';

type Search = Promise<Record<string, string | undefined>>;

export default async function InvitePage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const { locale, tr } = await translator();
  return (
    <>
      <TopBar locale={locale} returnTo="/sign-in" signedIn={false} />
      <main className="page narrow">
        <h1>{tr('admin.invite.title')}</h1>
        <ErrorAlert
          locale={locale}
          code={params['error'] === 'INVITE_INVALID' ? 'INTERNAL' : params['error']}
        />
        <form action={acceptInvite}>
          <input type="hidden" name="token" value={params['token'] ?? ''} />
          <div className="field">
            <label htmlFor="password">{tr('admin.invite.passwordStep')}</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={10}
              required
              aria-describedby="hint"
            />
            <span id="hint" className="hint">
              {tr('auth.password.hint')}
            </span>
          </div>
          <button className="btn block" type="submit">
            {tr('common.continue')}
          </button>
        </form>
      </main>
    </>
  );
}
