import { ErrorAlert } from '../../components/ErrorAlert';
import { TopBar } from '../../components/TopBar';
import { safeReturnTo } from '../../lib/api';
import { translator } from '../../lib/i18n';
import { resend, verify } from '../sign-in/actions';

type Search = Promise<Record<string, string | undefined>>;

export default async function VerifyPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const { locale, tr } = await translator();
  const c = params['c'] ?? '';
  const to = params['to'] ?? '';
  const returnTo = safeReturnTo(params['returnTo'], '/business/gateway');
  const hidden = (
    <>
      <input type="hidden" name="c" value={c} />
      <input type="hidden" name="to" value={to} />
      <input type="hidden" name="returnTo" value={returnTo} />
    </>
  );
  return (
    <>
      <TopBar
        locale={locale}
        returnTo={`/verify?${new URLSearchParams({ c, to, returnTo }).toString()}`}
        signedIn={false}
      />
      <main className="page narrow">
        <h1>{tr('auth.verify.title')}</h1>
        <p className="muted">{tr('auth.verify.sentTo', { destination: `⁦${to}⁩` })}</p>
        <ErrorAlert locale={locale} code={params['error']} retryAfter={params['retryAfter']} />
        <form action={verify}>
          {hidden}
          <div className="field">
            <label htmlFor="code">{tr('auth.code')}</label>
            <input
              id="code"
              name="code"
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
            {tr('common.continue')}
          </button>
        </form>
        <form action={resend} style={{ marginTop: 16 }}>
          {hidden}
          <button className="btn ghost" type="submit">
            {tr('auth.verify.resend')}
          </button>
        </form>
      </main>
    </>
  );
}
