import { redirect } from 'next/navigation';
import QRCode from 'qrcode';
import { ErrorAlert } from '../../../components/ErrorAlert';
import { TopBar } from '../../../components/TopBar';
import { translator } from '../../../lib/i18n';
import { confirmMfa, readEnrolment } from '../../sign-in/actions';

type Search = Promise<Record<string, string | undefined>>;

export default async function MfaPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const { locale, tr } = await translator();
  const enrolment = await readEnrolment();
  if (!enrolment) redirect('/invite');
  const svg = await QRCode.toString(enrolment.otpauthUri, { type: 'svg', margin: 1, width: 200 });
  const grouped = enrolment.secret.match(/.{1,4}/g)?.join(' ') ?? enrolment.secret;
  return (
    <>
      <TopBar locale={locale} returnTo="/invite/mfa" signedIn={false} />
      <main className="page narrow">
        <h1>{tr('admin.invite.title')}</h1>
        <p>{tr('admin.invite.mfaStep')}</p>
        <ErrorAlert
          locale={locale}
          code={params['error'] === 'TOTP_INVALID' ? 'OTP_INVALID' : params['error']}
        />
        <div className="card" style={{ alignItems: 'center' }}>
          {/* QR generated on the server from the otpauth URI; no third-party request is made. */}
          <div
            aria-hidden="true"
            style={{ width: 200, height: 200 }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          <div>
            <div className="muted">{tr('admin.invite.secret')}</div>
            <div className="secret">{grouped}</div>
          </div>
        </div>
        <form action={confirmMfa} style={{ marginTop: 24 }}>
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
            {tr('admin.invite.confirm')}
          </button>
        </form>
      </main>
    </>
  );
}
