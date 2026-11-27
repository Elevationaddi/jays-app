import { ApiClientError } from '@jays/api-client';
import { BUSINESS_PERMISSIONS, MANAGER_GRANTABLE } from '@jays/domain';
import { notFound } from 'next/navigation';
import { BusinessNav } from '../../../../components/BusinessNav';
import { ErrorAlert } from '../../../../components/ErrorAlert';
import { TopBar } from '../../../../components/TopBar';
import { serverApi } from '../../../../lib/api';
import { translator } from '../../../../lib/i18n';
import { inviteMember, removeMember } from '../../actions';

type Search = Promise<Record<string, string | undefined>>;

export default async function TeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Search;
}) {
  const { businessId } = await params;
  const query = await searchParams;
  const { locale, tr } = await translator();
  const api = await serverApi();
  let business;
  try {
    business = await api.business(businessId);
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) notFound();
    throw error;
  }
  const canView = business.myCapabilities.includes('members.view');
  const canManage = business.myCapabilities.includes('members.manage');
  const members = canView ? (await api.members(businessId, { limit: 100 })).items : [];
  const grantable = business.myPermissions.includes('owner')
    ? BUSINESS_PERMISSIONS
    : MANAGER_GRANTABLE;
  const sep = locale === 'ar' ? '، ' : ', ';

  return (
    <>
      <TopBar locale={locale} returnTo={`/business/${businessId}/team`} signedIn />
      <main className="page">
        <p className="muted" style={{ marginBottom: 4 }}>
          {business.displayName[locale]}
        </p>
        <BusinessNav locale={locale} business={business} current="team" />
        <h1>{tr('business.team.title')}</h1>
        <ErrorAlert locale={locale} code={query['error']} />
        {!canView ? (
          <div className="alert info">{tr('business.team.noAccess')}</div>
        ) : (
          <ul className="list">
            {members.map((m) => (
              <li key={m.id} className="row">
                <div className="grow">
                  <strong>{m.displayName ?? m.contact}</strong>
                  <div className="muted ltr" style={{ fontSize: 14 }}>
                    {m.contact}
                  </div>
                </div>
                <span>{m.permissions.map((p) => tr(`permission.${p}`)).join(sep)}</span>
                <span className={`badge ${m.status}`}>
                  {tr(`business.team.status.${m.status}`)}
                </span>
                {canManage &&
                !(m.permissions.includes('owner') && !business.myPermissions.includes('owner')) ? (
                  <form action={removeMember}>
                    <input type="hidden" name="businessId" value={businessId} />
                    <input type="hidden" name="memberId" value={m.id} />
                    <button className="btn ghost" type="submit">
                      {m.status === 'invited'
                        ? tr('business.team.cancelInvite')
                        : tr('business.team.remove')}
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canManage ? (
          <section className="card" style={{ marginTop: 32, maxWidth: 560 }}>
            <h2 style={{ margin: 0 }}>{tr('business.team.invite')}</h2>
            <p className="muted" style={{ margin: 0 }}>
              {tr('business.team.invite.hint')}
            </p>
            <form action={inviteMember}>
              <input type="hidden" name="businessId" value={businessId} />
              <div className="field">
                <label htmlFor="identifier">{tr('auth.identifier')}</label>
                <input id="identifier" name="identifier" type="text" dir="ltr" required />
              </div>
              <fieldset>
                <legend>{tr('business.team.permissions')}</legend>
                <div className="chips">
                  {grantable.map((p) => (
                    <label key={p} className="check" style={{ marginInlineEnd: 16 }}>
                      <input type="checkbox" name="permissions" value={p} />
                      <span>{tr(`permission.${p}`)}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <button className="btn" type="submit">
                {tr('business.team.invite')}
              </button>
            </form>
          </section>
        ) : null}
      </main>
    </>
  );
}
