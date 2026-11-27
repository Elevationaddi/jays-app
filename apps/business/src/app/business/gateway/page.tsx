import { ApiClientError } from '@jays/api-client';
import type { BusinessModeStatus, MyMembership } from '@jays/contracts';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ErrorAlert } from '../../../components/ErrorAlert';
import { TopBar } from '../../../components/TopBar';
import { serverApi } from '../../../lib/api';
import { translator } from '../../../lib/i18n';
import { WORKSPACE_COOKIE } from '../../../lib/session';
import { pickWorkspace } from '../../../lib/workspace';
import { activateMode, respondToInvitation, switchBusiness } from '../actions';

type Search = Promise<Record<string, string | undefined>>;

export default async function GatewayPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const { locale, tr } = await translator();
  const api = await serverApi();
  let me;
  let memberships: MyMembership[];
  try {
    [me, { items: memberships }] = await Promise.all([api.me(), api.memberships({ limit: 100 })]);
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 401)
      redirect('/sign-in?returnTo=/business/gateway');
    return (
      <>
        <TopBar locale={locale} returnTo="/business/gateway" signedIn />
        <main className="page">
          <ErrorAlert
            locale={locale}
            code={error instanceof ApiClientError ? error.code : 'INTERNAL'}
          />
          <Link className="btn" href="/business/gateway">
            {tr('common.retry')}
          </Link>
        </main>
      </>
    );
  }
  const preferred = (await cookies()).get(WORKSPACE_COOKIE)?.value;
  const current = pickWorkspace(memberships, preferred);
  const invitations = memberships.filter((m) => m.status === 'invited');
  const active = memberships.filter((m) => m.status === 'active');
  const name = (m: MyMembership) => m.business.displayName[locale];

  return (
    <>
      <TopBar
        locale={locale}
        returnTo="/business/gateway"
        signedIn
        name={me.displayName ?? me.email ?? me.phone}
      />
      <main className="page">
        <ErrorAlert locale={locale} code={params['error']} />
        {invitations.length > 0 ? (
          <section aria-labelledby="invitations">
            <h2 id="invitations">{tr('business.invitations')}</h2>
            <ul className="list">
              {invitations.map((m) => (
                <li key={m.membershipId} className="row">
                  <span className="grow">
                    {tr('business.invitation.from', {
                      business: name(m),
                      permissions: m.permissions
                        .map((p) => tr(`permission.${p}`))
                        .join(locale === 'ar' ? '، ' : ', '),
                    })}
                  </span>
                  <form action={respondToInvitation}>
                    <input type="hidden" name="membershipId" value={m.membershipId} />
                    <button className="btn" name="decision" value="accept" type="submit">
                      {tr('business.invitation.accept')}
                    </button>{' '}
                    <button className="btn secondary" name="decision" value="decline" type="submit">
                      {tr('business.invitation.decline')}
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {!current ? (
          <section className="card" style={{ marginTop: 32 }}>
            <h1>{tr('business.gateway.title')}</h1>
            <p className="muted">{tr('business.gateway.none')}</p>
            <div className="actions">
              <Link className="btn" href="/business/new">
                {tr('business.gateway.create')}
              </Link>
            </div>
          </section>
        ) : (
          <>
            <div
              style={{
                display: 'flex',
                gap: 16,
                alignItems: 'flex-end',
                flexWrap: 'wrap',
                marginTop: 16,
              }}
            >
              <div style={{ flex: 1, minWidth: 260 }}>
                <h1>{tr('business.gateway.title')}</h1>
                <p className="muted" style={{ margin: 0 }}>
                  {tr('business.gateway.subtitle', { business: name(current) })}{' '}
                  <span className={`badge ${current.business.status}`}>
                    {tr(`business.status.${current.business.status}`)}
                  </span>
                </p>
              </div>
              <form action={switchBusiness} className="switcher">
                <input type="hidden" name="returnTo" value="/business/gateway" />
                <label htmlFor="businessId" className="muted">
                  {tr('business.gateway.switch')}
                </label>
                <select id="businessId" name="businessId" defaultValue={current.business.id}>
                  {active.map((m) => (
                    <option key={m.business.id} value={m.business.id}>
                      {name(m)}
                    </option>
                  ))}
                </select>
                <button className="btn secondary" type="submit">
                  {tr('common.continue')}
                </button>
              </form>
            </div>
            <nav
              className="tabs"
              aria-label={tr('business.gateway.switch')}
              style={{ margin: '16px 0 24px' }}
            >
              <Link href="/business/gateway" aria-current="page">
                {tr('business.nav.gateway')}
              </Link>
              {current.business.myCapabilities.includes('members.view') ? (
                <Link href={`/business/${current.business.id}/team`}>
                  {tr('business.nav.team')}
                </Link>
              ) : null}
            </nav>
            <div className="cards">
              {(['shop', 'services'] as const).map((mode) => (
                <ModeCard key={mode} mode={mode} membership={current} tr={tr} />
              ))}
            </div>
          </>
        )}
        {current ? (
          <p style={{ marginTop: 32 }}>
            <Link href="/business/new">{tr('business.gateway.create')}</Link>
          </p>
        ) : null}
      </main>
    </>
  );
}

function ModeCard({
  mode,
  membership,
  tr,
}: {
  mode: 'shop' | 'services';
  membership: MyMembership;
  tr: Awaited<ReturnType<typeof translator>>['tr'];
}) {
  const status: BusinessModeStatus = membership.business.modes[mode];
  const canActivate = membership.business.myCapabilities.includes('modes.manage');
  const id = membership.business.id;
  return (
    <article className="card mode" aria-labelledby={`mode-${mode}`}>
      <div className="mode-icon" aria-hidden="true">
        {mode === 'shop' ? '🛍' : '📅'}
      </div>
      <h3 id={`mode-${mode}`}>{tr(`business.mode.${mode}`)}</h3>
      <span className={`badge ${status}`}>{tr(`business.mode.status.${status}`)}</span>
      <p className="muted" style={{ margin: 0 }}>
        {tr(`business.mode.${mode}.description`)}
      </p>
      <div className="actions">
        {status === 'not_activated' ? (
          canActivate ? (
            <form action={activateMode}>
              <input type="hidden" name="businessId" value={id} />
              <input type="hidden" name="mode" value={mode} />
              <button className="btn" type="submit">
                {tr('business.mode.activate')}
              </button>
            </form>
          ) : (
            <span className="muted">{tr('business.mode.activate.ownerOnly')}</span>
          )
        ) : status === 'active' ? (
          <span className="btn secondary" aria-disabled="true">
            {tr('business.mode.open')} · {tr('common.later')}
          </span>
        ) : (
          <Link className="btn secondary" href={`/business/${id}/onboarding/${mode}`}>
            {tr('business.mode.continueSetup')}
          </Link>
        )}
      </div>
    </article>
  );
}
