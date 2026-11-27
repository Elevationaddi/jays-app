import Link from 'next/link';
import { ErrorAlert } from '../../components/ErrorAlert';
import { TopBar } from '../../components/TopBar';
import { translator } from '../../lib/i18n';
import { register } from '../sign-in/actions';

type Search = Promise<Record<string, string | undefined>>;

export default async function RegisterPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const { locale, tr } = await translator();
  const phone = params['channel'] === 'phone';
  return (
    <>
      <TopBar
        locale={locale}
        returnTo={phone ? '/register?channel=phone' : '/register'}
        signedIn={false}
      />
      <main className="page narrow">
        <h1>{tr('auth.register.title')}</h1>
        <ErrorAlert locale={locale} code={params['error']} retryAfter={params['retryAfter']} />
        <form action={register}>
          <input type="hidden" name="channel" value={phone ? 'phone' : 'email'} />
          <input type="hidden" name="locale" value={locale} />
          <div className="field">
            <label htmlFor="contact">{phone ? tr('auth.phone') : tr('auth.email')}</label>
            <input
              id="contact"
              name="contact"
              type={phone ? 'tel' : 'email'}
              dir="ltr"
              autoComplete={phone ? 'tel' : 'email'}
              required
              defaultValue={params['contact'] ?? ''}
              aria-describedby={phone ? 'contact-hint' : undefined}
            />
            {phone ? (
              <span id="contact-hint" className="hint">
                {tr('auth.phone.hint')}
              </span>
            ) : null}
          </div>
          <p>
            <Link href={phone ? '/register' : '/register?channel=phone'}>
              {phone ? tr('auth.useEmail') : tr('auth.usePhone')}
            </Link>
          </p>
          <div className="field">
            <label htmlFor="password">{tr('auth.password')}</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={10}
              required
              aria-describedby="password-hint"
            />
            <span id="password-hint" className="hint">
              {tr('auth.password.hint')}
            </span>
          </div>
          <label className="check">
            <input type="checkbox" name="acceptTerms" required />
            <span>{tr('auth.terms')}</span>
          </label>
          <label className="check">
            <input type="checkbox" name="marketingConsent" />
            <span>{tr('auth.marketing')}</span>
          </label>
          <button className="btn block" type="submit">
            {tr('common.continue')}
          </button>
        </form>
        <p>
          <Link href="/sign-in">{tr('auth.haveAccount')}</Link>
        </p>
      </main>
    </>
  );
}
