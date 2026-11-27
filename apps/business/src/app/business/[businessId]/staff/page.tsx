import Link from 'next/link';
import { StaffFields } from '../../../../components/StaffFields';
import { Workspace, loadBusiness } from '../../../../components/Workspace';
import { serverApi } from '../../../../lib/api';
import { translator } from '../../../../lib/i18n';
import { createStaff } from '../schedule-actions';

type Search = Promise<Record<string, string | undefined>>;

export default async function StaffPage({
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
  const path = `/business/${businessId}/staff`;
  const frame = { locale, business, tab: 'staff' as const, path, title: tr('staff.title') };
  const canManage = business.myCapabilities.includes('services.manage');
  if (!canManage && !business.myCapabilities.includes('bookings.schedule')) {
    return (
      <Workspace {...frame}>
        <div className="alert info">{tr('business.team.noAccess')}</div>
      </Workspace>
    );
  }
  const api = await serverApi();
  const [staff, branches, services, members] = await Promise.all([
    api.staff(businessId),
    api.branches(businessId),
    api.services(businessId),
    canManage ? api.members(businessId, { limit: 100 }) : Promise.resolve({ items: [] }),
  ]);
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name[locale] ?? '';
  const serviceName = (id: string) => services.find((s) => s.id === id)?.title[locale] ?? '';
  return (
    <Workspace
      {...frame}
      intro={tr('staff.intro')}
      error={query['error']}
      notice={query['saved'] ? tr('common.saved') : undefined}
    >
      <div className="split">
        <section>
          {staff.length === 0 ? (
            <p className="muted">{tr('staff.none')}</p>
          ) : (
            <ul className="list">
              {staff.map((s) => (
                <li key={s.id} className="row">
                  <div className="grow">
                    <Link href={`${path}/${s.id}`}>
                      <strong>{s.displayName}</strong>
                    </Link>
                    <div className="muted" style={{ fontSize: 14 }}>
                      {s.branchIds.map(branchName).join(', ')} ·{' '}
                      {tr('staff.shiftCount', { count: s.shifts.length })}
                    </div>
                    <div className="muted" style={{ fontSize: 14 }}>
                      {s.serviceIds.map(serviceName).join(', ')}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        {canManage && branches.some((b) => b.status === 'active') ? (
          <details className="card" open={staff.length === 0}>
            <summary>
              <strong>{tr('staff.add')}</strong>
            </summary>
            <form action={createStaff}>
              <input type="hidden" name="businessId" value={businessId} />
              <StaffFields
                locale={locale}
                staff={null}
                members={members.items}
                branches={branches.filter((b) => b.status === 'active')}
                services={services.filter((s) => s.status === 'active')}
              />
              <p>
                <button className="btn" type="submit">
                  {tr('staff.create')}
                </button>
              </p>
            </form>
          </details>
        ) : null}
      </div>
    </Workspace>
  );
}
