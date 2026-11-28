import { fils, formatAed } from '@jays/domain';
import { ErrorAlert } from '../../../components/ErrorAlert';
import { Shell } from '../../../components/Shell';
import { requireAdmin } from '../../../lib/admin';
import { translator } from '../../../lib/i18n';
import { cancelPromotion, createPromotion } from './actions';

type Search = Promise<Record<string, string | undefined>>;

/**
 * The Abu Dhabi pilot (ADR-0034): targets, enrolled businesses and each founder-approved 0%
 * commission promotion. Recording a promotion needs `finance.manage` and the founder's approval
 * reference. The pilot itself is never started by the system.
 */
export default async function PilotPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const { locale, tr } = await translator();
  const { api, admin } = await requireAdmin('/admin/pilot');
  if (!admin.capabilities.includes('finance.view')) {
    return (
      <Shell locale={locale} admin={admin} current="pilot">
        <div className="alert error">{tr('admin.forbidden')}</div>
      </Shell>
    );
  }
  const d = await api.adminPilot();
  const canManage = admin.capabilities.includes('finance.manage');
  const date = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    dateStyle: 'medium',
    timeZone: 'Asia/Dubai',
  });
  const m = (n: number) => formatAed(fils(n), locale);
  return (
    <Shell locale={locale} admin={admin} current="pilot">
      <h1>{tr('admin.pilot.title')}</h1>
      <div className="alert info">{tr('admin.pilot.notLaunched')}</div>
      {params['saved'] ? (
        <div className="alert info" role="status">
          {tr('common.saved')}
        </div>
      ) : null}
      <ErrorAlert locale={locale} code={params['error']} />
      <div className="stats">
        <div className={`card stat`}>
          <span className="muted">{tr('admin.pilot.shops')}</span>
          <strong>
            {d.enrolled.shop} / {d.targets.shop}
          </strong>
        </div>
        <div className="card stat">
          <span className="muted">{tr('admin.pilot.services')}</span>
          <strong>
            {d.enrolled.services} / {d.targets.services}
          </strong>
        </div>
        <div className="card stat">
          <span className="muted">{tr('admin.pilot.offer')}</span>
          <strong>{tr('admin.pilot.offerValue')}</strong>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{tr('admin.pilot.business')}</th>
              <th>{tr('admin.pilot.window')}</th>
              <th>{tr('admin.pilot.state')}</th>
              <th>{tr('admin.pilot.sales')}</th>
              <th>{tr('admin.pilot.approval')}</th>
              {canManage ? <th /> : null}
            </tr>
          </thead>
          <tbody>
            {d.promotions.length === 0 ? (
              <tr>
                <td colSpan={canManage ? 6 : 5} className="muted">
                  {tr('admin.pilot.none')}
                </td>
              </tr>
            ) : (
              d.promotions.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.business.name[locale]}
                    <div className="muted">
                      {[
                        p.business.emirate ?? '—',
                        ...p.business.modes.map((x) => tr(`mode.${x}`)),
                      ].join(' · ')}
                    </div>
                    {p.business.emirate !== d.emirate ? (
                      <div className="muted">{tr('admin.pilot.outsideEmirate')}</div>
                    ) : null}
                  </td>
                  <td>
                    {date.format(new Date(p.startsAt))} – {date.format(new Date(p.endsAt))}
                  </td>
                  <td>
                    <span className={`badge ${p.state === 'active' ? 'active' : 'pending'}`}>
                      {tr(`admin.pilot.state.${p.state}`)}
                    </span>
                    {p.state === 'active' ? (
                      <div className="muted">
                        {tr('admin.pilot.daysLeft', { days: p.daysLeft })}
                      </div>
                    ) : null}
                    {p.cancelReason ? <div className="muted">{p.cancelReason}</div> : null}
                  </td>
                  <td>
                    {p.sales.count} · {m(p.sales.grossFils)}
                  </td>
                  <td className="muted">
                    {p.founderApproval}
                    {p.createdBy ? <div>{p.createdBy}</div> : null}
                  </td>
                  {canManage ? (
                    <td>
                      {p.state === 'active' || p.state === 'scheduled' ? (
                        <form action={cancelPromotion} className="inline-form">
                          <input type="hidden" name="promotionId" value={p.id} />
                          <label className="sr-only" htmlFor={`reason-${p.id}`}>
                            {tr('admin.pilot.cancelReason')}
                          </label>
                          <input
                            id={`reason-${p.id}`}
                            name="reason"
                            required
                            minLength={3}
                            placeholder={tr('admin.pilot.cancelReason')}
                          />
                          <button className="btn secondary" type="submit">
                            {tr('admin.pilot.cancel')}
                          </button>
                        </form>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {canManage ? (
        <section className="card" style={{ marginTop: 24, maxWidth: 640 }}>
          <h2>{tr('admin.pilot.add')}</h2>
          <p className="muted">{tr('admin.pilot.addIntro')}</p>
          <form action={createPromotion}>
            <div className="field">
              <label htmlFor="businessId">{tr('admin.pilot.businessId')}</label>
              <input id="businessId" name="businessId" required className="ltr" />
            </div>
            <div className="field">
              <label htmlFor="founderApproval">{tr('admin.pilot.approval')}</label>
              <input
                id="founderApproval"
                name="founderApproval"
                required
                minLength={5}
                maxLength={500}
              />
            </div>
            <div className="field">
              <label htmlFor="startsAt">{tr('admin.pilot.startsAt')}</label>
              <input id="startsAt" name="startsAt" type="datetime-local" />
            </div>
            <button className="btn" type="submit">
              {tr('admin.pilot.addButton')}
            </button>
          </form>
        </section>
      ) : null}
    </Shell>
  );
}
