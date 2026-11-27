import Link from 'next/link';
import { BranchFields } from '../../../../../../components/ScheduleFields';
import { Workspace, loadBusiness } from '../../../../../../components/Workspace';
import { serverApi } from '../../../../../../lib/api';
import { translator } from '../../../../../../lib/i18n';
import { addClosure, removeClosure, updateBranch } from '../../../schedule-actions';

type Search = Promise<Record<string, string | undefined>>;

export default async function BranchPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string; branchId: string }>;
  searchParams: Search;
}) {
  const { businessId, branchId } = await params;
  const query = await searchParams;
  const { locale, tr } = await translator();
  const business = await loadBusiness(businessId);
  const path = `/business/${businessId}/services/branches/${branchId}`;
  const api = await serverApi();
  const [branch, closures, emirates] = await Promise.all([
    api.branch(businessId, branchId),
    api.closures(businessId, branchId),
    api.emirates(),
  ]);
  const when = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: branch.timezone,
  });
  return (
    <Workspace
      locale={locale}
      business={business}
      tab="services"
      path={path}
      title={branch.name[locale]}
      error={query['error']}
      notice={query['saved'] ? tr('common.saved') : undefined}
    >
      <p>
        <Link href={`/business/${businessId}/services`}>{tr('services.title')}</Link>
      </p>
      <div className="split">
        <form action={updateBranch} className="card">
          <input type="hidden" name="businessId" value={businessId} />
          <input type="hidden" name="branchId" value={branchId} />
          <BranchFields locale={locale} branch={branch} emirates={emirates.items} />
          <p className="inline-form">
            <button className="btn" type="submit">
              {tr('branch.save')}
            </button>
            {branch.status === 'active' ? (
              <button className="btn secondary" type="submit" name="archive" value="1">
                {tr('branch.archive')}
              </button>
            ) : null}
          </p>
        </form>
        <section className="card">
          <h2>{tr('branch.closures')}</h2>
          <p className="muted">{tr('branch.closuresIntro')}</p>
          {closures.length === 0 ? (
            <p className="muted">{tr('branch.noClosures')}</p>
          ) : (
            <ul className="list">
              {closures.map((c) => (
                <li key={c.id} className="row">
                  <div className="grow">
                    <strong>
                      <bdi>{when.format(new Date(c.startsAt))}</bdi> –{' '}
                      <bdi>{when.format(new Date(c.endsAt))}</bdi>
                    </strong>
                    {c.reason ? <div className="muted">{c.reason}</div> : null}
                  </div>
                  <form action={removeClosure}>
                    <input type="hidden" name="businessId" value={businessId} />
                    <input type="hidden" name="branchId" value={branchId} />
                    <input type="hidden" name="closureId" value={c.id} />
                    <button className="btn secondary" type="submit">
                      {tr('closure.remove')}
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <form action={addClosure}>
            <input type="hidden" name="businessId" value={businessId} />
            <input type="hidden" name="branchId" value={branchId} />
            <div className="field">
              <label htmlFor="startsAt">{tr('closure.from')}</label>
              <input id="startsAt" name="startsAt" type="datetime-local" dir="ltr" required />
            </div>
            <div className="field">
              <label htmlFor="endsAt">{tr('closure.to')}</label>
              <input id="endsAt" name="endsAt" type="datetime-local" dir="ltr" required />
            </div>
            <div className="field">
              <label htmlFor="reason">{tr('closure.reason')}</label>
              <input id="reason" name="reason" type="text" maxLength={200} />
            </div>
            <button className="btn" type="submit">
              {tr('branch.addClosure')}
            </button>
          </form>
        </section>
      </div>
    </Workspace>
  );
}
