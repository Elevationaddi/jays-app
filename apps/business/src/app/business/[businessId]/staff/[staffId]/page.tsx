import Link from 'next/link';
import { weekdayKey } from '../../../../../components/ScheduleFields';
import { StaffFields } from '../../../../../components/StaffFields';
import { Workspace, loadBusiness } from '../../../../../components/Workspace';
import { serverApi } from '../../../../../lib/api';
import { translator } from '../../../../../lib/i18n';
import { addBlock, removeBlock, saveShifts, updateStaff } from '../../schedule-actions';

type Search = Promise<Record<string, string | undefined>>;
const WEEK = [1, 2, 3, 4, 5, 6, 0] as const;

export default async function StaffMemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string; staffId: string }>;
  searchParams: Search;
}) {
  const { businessId, staffId } = await params;
  const query = await searchParams;
  const { locale, tr } = await translator();
  const business = await loadBusiness(businessId);
  const path = `/business/${businessId}/staff/${staffId}`;
  const canManage = business.myCapabilities.includes('services.manage');
  const api = await serverApi();
  const [staff, branches, services, members, blocks] = await Promise.all([
    api.staffMember(businessId, staffId),
    api.branches(businessId),
    api.services(businessId),
    canManage ? api.members(businessId, { limit: 100 }) : Promise.resolve({ items: [] }),
    api.blocks(businessId, { staffId, limit: 50 }),
  ]);
  const myBranches = branches.filter((b) => staff.branchIds.includes(b.id));
  const when = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Dubai',
  });
  const shiftInputs = (d: number, slot: 'a' | 'b', shift?: (typeof staff.shifts)[number]) => (
    <>
      <td>
        <select
          name={`branch-${d}-${slot}`}
          aria-label={`${tr(weekdayKey(d))}: ${tr('calendar.branch')}`}
          defaultValue={shift?.branchId ?? ''}
        >
          <option value="">{tr('staff.dayOff')}</option>
          {myBranches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name[locale]}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input
          type="time"
          name={`from-${d}-${slot}`}
          aria-label={`${tr(weekdayKey(d))}: ${tr('block.from')}`}
          step={300}
          dir="ltr"
          defaultValue={shift?.start ?? ''}
        />
      </td>
      <td>
        <input
          type="time"
          name={`to-${d}-${slot}`}
          aria-label={`${tr(weekdayKey(d))}: ${tr('block.to')}`}
          step={300}
          dir="ltr"
          defaultValue={shift?.end ?? ''}
        />
      </td>
    </>
  );
  return (
    <Workspace
      locale={locale}
      business={business}
      tab="staff"
      path={path}
      title={staff.displayName}
      error={query['error']}
      notice={query['saved'] ? tr('common.saved') : undefined}
    >
      <p>
        <Link href={`/business/${businessId}/staff`}>{tr('staff.title')}</Link>
      </p>
      <div className="split">
        <div className="stack">
          {canManage ? (
            <section className="card">
              <h2>{tr('staff.shifts')}</h2>
              <p className="muted">{tr('staff.shiftsIntro')}</p>
              <form action={saveShifts}>
                <input type="hidden" name="businessId" value={businessId} />
                <input type="hidden" name="staffId" value={staffId} />
                <div className="table-wrap">
                  <table>
                    <tbody>
                      {WEEK.map((d) => {
                        const day = staff.shifts.filter((s) => s.weekday === d);
                        return (
                          <tr key={d}>
                            <th scope="row">{tr(weekdayKey(d))}</th>
                            {shiftInputs(d, 'a', day[0])}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {staff.shifts
                  .filter((s, i, all) => all.findIndex((x) => x.weekday === s.weekday) !== i)
                  .map((s) => (
                    // A second shift on the same day is kept as is.
                    <span key={s.id}>
                      <input type="hidden" name={`branch-${s.weekday}-b`} value={s.branchId} />
                      <input type="hidden" name={`from-${s.weekday}-b`} value={s.start} />
                      <input type="hidden" name={`to-${s.weekday}-b`} value={s.end} />
                    </span>
                  ))}
                <p>
                  <button className="btn" type="submit">
                    {tr('staff.saveShifts')}
                  </button>
                </p>
              </form>
            </section>
          ) : null}
          <section className="card">
            <h2>{tr('staff.blocks')}</h2>
            {blocks.items.length === 0 ? (
              <p className="muted">{tr('staff.noBlocks')}</p>
            ) : (
              <ul className="list">
                {blocks.items.map((b) => (
                  <li key={b.id} className="row">
                    <div className="grow">
                      <strong>{tr(`block.kind.${b.kind}`)}</strong>
                      <div className="muted" style={{ fontSize: 14 }}>
                        <bdi>{when.format(new Date(b.startsAt))}</bdi> –{' '}
                        <bdi>{when.format(new Date(b.endsAt))}</bdi>
                        {b.reason ? ` · ${b.reason}` : ''}
                      </div>
                    </div>
                    <form action={removeBlock}>
                      <input type="hidden" name="businessId" value={businessId} />
                      <input type="hidden" name="staffId" value={staffId} />
                      <input type="hidden" name="blockId" value={b.id} />
                      <button className="btn secondary" type="submit">
                        {tr('block.remove')}
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <form action={addBlock}>
              <input type="hidden" name="businessId" value={businessId} />
              <input type="hidden" name="staffId" value={staffId} />
              <div className="grid2">
                <div className="field">
                  <label htmlFor="kind">{tr('block.kind')}</label>
                  <select id="kind" name="kind" defaultValue="break">
                    <option value="break">{tr('block.kind.break')}</option>
                    <option value="leave">{tr('block.kind.leave')}</option>
                    <option value="other">{tr('block.kind.other')}</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="reason">{tr('block.reason')}</label>
                  <input id="reason" name="reason" type="text" maxLength={200} />
                </div>
                <div className="field">
                  <label htmlFor="startsAt">{tr('block.from')}</label>
                  <input id="startsAt" name="startsAt" type="datetime-local" dir="ltr" required />
                </div>
                <div className="field">
                  <label htmlFor="endsAt">{tr('block.to')}</label>
                  <input id="endsAt" name="endsAt" type="datetime-local" dir="ltr" required />
                </div>
              </div>
              <button className="btn" type="submit">
                {tr('staff.addBlock')}
              </button>
            </form>
          </section>
        </div>
        {canManage ? (
          <form action={updateStaff} className="card">
            <input type="hidden" name="businessId" value={businessId} />
            <input type="hidden" name="staffId" value={staffId} />
            <StaffFields
              locale={locale}
              staff={staff}
              members={members.items}
              branches={branches.filter((b) => b.status === 'active')}
              services={services.filter((s) => s.status === 'active')}
            />
            <p className="inline-form">
              <button className="btn" type="submit">
                {tr('staff.save')}
              </button>
              <button className="btn secondary" type="submit" name="archive" value="1">
                {tr('staff.archive')}
              </button>
            </p>
          </form>
        ) : null}
      </div>
    </Workspace>
  );
}
