import Link from 'next/link';
import { BranchFields, ServiceFields, weekdayKey } from '../../../../components/ScheduleFields';
import { Workspace, loadBusiness, money } from '../../../../components/Workspace';
import { serverApi } from '../../../../lib/api';
import { translator } from '../../../../lib/i18n';
import { createBranch, createService } from '../schedule-actions';

type Search = Promise<Record<string, string | undefined>>;

/** Branches (opening hours) and services (price, duration, buffers, cancellation policy). */
export default async function ServicesPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Search;
}) {
  const { businessId } = await params;
  const query = await searchParams;
  const { locale, tr } = await translator();
  const business = await loadBusiness(businessId);
  const path = `/business/${businessId}/services`;
  const frame = { locale, business, tab: 'services' as const, path, title: tr('services.title') };
  if (!business.myCapabilities.includes('services.manage')) {
    return (
      <Workspace {...frame}>
        <div className="alert info">{tr('business.team.noAccess')}</div>
      </Workspace>
    );
  }
  const api = await serverApi();
  const [branches, services, emirates, categories, home] = await Promise.all([
    api.branches(businessId),
    api.services(businessId),
    api.emirates(),
    api.categories('services'),
    api.homeServices(businessId),
  ]);
  const active = branches.filter((b) => b.status === 'active');
  const emirateName = (code: string) =>
    emirates.items.find((e) => e.code === code)?.name[locale] ?? code;
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name[locale] ?? '';
  return (
    <Workspace
      {...frame}
      intro={tr('services.intro')}
      error={query['error']}
      notice={query['saved'] ? tr('common.saved') : undefined}
    >
      <div className="split">
        <div className="stack">
          <section>
            <h2>{tr('services.list')}</h2>
            {services.length === 0 ? (
              <p className="muted">{tr('services.none')}</p>
            ) : (
              <ul className="list">
                {services.map((s) => (
                  <li key={s.id} className="row">
                    <div className="grow">
                      <Link href={`${path}/${s.id}`}>
                        <strong>{s.title[locale]}</strong>
                      </Link>
                      <div className="muted" style={{ fontSize: 14 }}>
                        {tr('service.summary', {
                          duration: s.durationMin,
                          price: money(s.priceFils, locale),
                        })}{' '}
                        · {s.branchIds.map(branchName).join(', ')} ·{' '}
                        {tr('service.staffCount', { count: s.staffIds.length })} ·{' '}
                        {tr(`service.location.${s.locationMode}`)}
                      </div>
                    </div>
                    <span className={`badge ${s.status}`}>{tr(`service.status.${s.status}`)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="card">
            <h2>{tr('portfolio.title')}</h2>
            <p className="muted">{tr('portfolio.intro')}</p>
            <p>
              <Link className="btn secondary" href={`${path}/portfolio`}>
                {tr('portfolio.manage')}
              </Link>
            </p>
          </section>
          <section className="card">
            <h2>{tr('home.title')}</h2>
            <p>
              <span className={`badge ${home.status}`}>{tr(`home.status.${home.status}`)}</span>{' '}
              {home.active ? tr('home.activeNote') : null}
            </p>
            <p className="muted">{tr('home.intro')}</p>
            <p>
              <Link className="btn secondary" href={`${path}/home`}>
                {tr('home.manage')}
              </Link>
            </p>
          </section>
          <section>
            <h2>{tr('services.branches')}</h2>
            {branches.length === 0 ? (
              <p className="muted">{tr('services.noBranches')}</p>
            ) : (
              <ul className="list">
                {branches.map((b) => (
                  <li key={b.id} className="row">
                    <div className="grow">
                      <Link href={`${path}/branches/${b.id}`}>
                        <strong>{b.name[locale]}</strong>
                      </Link>
                      <div className="muted" style={{ fontSize: 14 }}>
                        {[b.building, b.street, b.area, emirateName(b.emirate)].join(', ')}
                      </div>
                      <div className="muted" style={{ fontSize: 14 }}>
                        {b.hours
                          .map(
                            (h) => `${tr(weekdayKey(h.weekday)).slice(0, 3)} ${h.start}–${h.end}`,
                          )
                          .join(' · ') || tr('branch.closed')}
                      </div>
                    </div>
                    {b.status === 'archived' ? (
                      <span className="badge">{tr('branch.archived')}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <div className="stack">
          {active.length > 0 ? (
            <details className="card" open={services.length === 0}>
              <summary>
                <strong>{tr('services.add')}</strong>
              </summary>
              <form action={createService}>
                <input type="hidden" name="businessId" value={businessId} />
                <ServiceFields
                  locale={locale}
                  service={null}
                  categories={categories.items.filter((c) => c.status === 'active')}
                  branches={active}
                  homeApproved={home.status === 'approved'}
                />
                <p>
                  <button className="btn" type="submit">
                    {tr('service.create')}
                  </button>
                </p>
              </form>
            </details>
          ) : null}
          <details className="card" open={branches.length === 0}>
            <summary>
              <strong>{tr('services.addBranch')}</strong>
            </summary>
            <form action={createBranch}>
              <input type="hidden" name="businessId" value={businessId} />
              <BranchFields locale={locale} branch={null} emirates={emirates.items} />
              <p>
                <button className="btn" type="submit">
                  {tr('branch.create')}
                </button>
              </p>
            </form>
          </details>
        </div>
      </div>
    </Workspace>
  );
}
