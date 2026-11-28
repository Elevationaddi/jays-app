import type { MessageKey } from '@jays/i18n';
import { PLATFORM_ROLES } from '@jays/domain';
import { ErrorAlert } from '../../../components/ErrorAlert';
import { Shell } from '../../../components/Shell';
import { requireAdmin } from '../../../lib/admin';
import { translator } from '../../../lib/i18n';
import { changeAdminStatus, inviteAdmin } from './actions';

type Search = Promise<Record<string, string | undefined>>;

export default async function SecurityPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const { locale, tr } = await translator();
  const { api, admin } = await requireAdmin('/admin/security');
  const canManage = admin.capabilities.includes('admins.manage');
  const canAudit = admin.capabilities.includes('audit.view');
  const [admins, audit] = await Promise.all([
    canManage ? api.admins({ limit: 50 }) : null,
    canAudit ? api.auditLogs({ limit: 20 }) : null,
  ]);
  const when = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Dubai',
  });
  const sep = locale === 'ar' ? '، ' : ', ';
  return (
    <Shell locale={locale} admin={admin} current="security">
      <ErrorAlert locale={locale} code={params['error']} />
      {params['suspended'] ? (
        <div className="alert info" role="status">
          {tr('admin.security.suspended')}
        </div>
      ) : params['reactivated'] ? (
        <div className="alert info" role="status">
          {tr('admin.security.reactivated')}
        </div>
      ) : null}
      {!canManage && !canAudit ? <div className="alert error">{tr('admin.forbidden')}</div> : null}
      {admins ? (
        <section>
          <h1>{tr('admin.security.title')}</h1>
          <table>
            <thead>
              <tr>
                <th>{tr('admin.security.displayName')}</th>
                <th>{tr('auth.email')}</th>
                <th>{tr('admin.roles')}</th>
                <th>{tr('admin.security.mfa')}</th>
                <th>{tr('admin.security.status')}</th>
                <th>{tr('admin.security.access')}</th>
              </tr>
            </thead>
            <tbody>
              {admins.items.map((a) => (
                <tr key={a.id}>
                  <td>{a.displayName}</td>
                  <td className="ltr">{a.email}</td>
                  <td>{a.roles.map((r) => tr(`role.${r}`)).join(sep)}</td>
                  <td>{a.mfaEnabled ? '✓ TOTP' : '—'}</td>
                  <td>
                    <span className={`badge ${a.status === 'active' ? 'active' : a.status}`}>
                      {tr(`admin.security.status.${a.status}`)}
                    </span>
                  </td>
                  <td>
                    {a.id === admin.id ? (
                      <span className="muted">{tr('admin.security.you')}</span>
                    ) : (
                      <form action={changeAdminStatus} className="stack" style={{ gap: 6 }}>
                        <input type="hidden" name="adminId" value={a.id} />
                        <input
                          type="hidden"
                          name="action"
                          value={a.status === 'suspended' ? 'reactivate' : 'suspend'}
                        />
                        <label htmlFor={`reason-${a.id}`} className="muted">
                          {tr('admin.audit.reason')}
                        </label>
                        <input
                          id={`reason-${a.id}`}
                          name="reason"
                          required
                          minLength={5}
                          maxLength={1000}
                        />
                        <button
                          className={a.status === 'suspended' ? 'btn secondary' : 'btn danger'}
                          type="submit"
                        >
                          {tr(
                            a.status === 'suspended'
                              ? 'admin.security.reactivate'
                              : 'admin.security.suspend',
                          )}
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <section className="card" style={{ marginTop: 24, maxWidth: 620 }}>
            <h2 style={{ margin: 0 }}>{tr('admin.security.invite')}</h2>
            <form action={inviteAdmin}>
              <div className="field">
                <label htmlFor="email">{tr('auth.email')}</label>
                <input id="email" name="email" type="email" dir="ltr" required />
              </div>
              <div className="field">
                <label htmlFor="displayName">{tr('admin.security.displayName')}</label>
                <input id="displayName" name="displayName" type="text" required maxLength={80} />
              </div>
              <fieldset>
                <legend>{tr('admin.roles')}</legend>
                <div className="chips">
                  {PLATFORM_ROLES.map((r) => (
                    <label key={r} className="check" style={{ marginInlineEnd: 16 }}>
                      <input type="checkbox" name="roles" value={r} />
                      <span>{tr(`role.${r}`)}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="field">
                <label htmlFor="reason">{tr('admin.security.reason')}</label>
                <input
                  id="reason"
                  name="reason"
                  type="text"
                  required
                  minLength={5}
                  maxLength={1000}
                />
              </div>
              <button className="btn" type="submit">
                {tr('admin.security.invite')}
              </button>
            </form>
          </section>
        </section>
      ) : null}
      {audit ? (
        <section>
          <h2>{tr('admin.audit.title')}</h2>
          <table>
            <thead>
              <tr>
                <th>{tr('admin.audit.when')}</th>
                <th>{tr('admin.audit.action')}</th>
                <th>{tr('admin.audit.actor')}</th>
                <th>{tr('admin.audit.reason')}</th>
              </tr>
            </thead>
            <tbody>
              {audit.items.map((e) => (
                <tr key={e.id}>
                  <td>{when.format(new Date(e.createdAt))}</td>
                  <td className="ltr">
                    <code>{e.action}</code>
                  </td>
                  <td>{tr(`admin.audit.actorType.${e.actorType}` as MessageKey)}</td>
                  <td>{e.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </Shell>
  );
}
