import { Shell } from '../../../components/Shell';
import { ErrorAlert } from '../../../components/ErrorAlert';
import { requireAdmin } from '../../../lib/admin';
import { translator } from '../../../lib/i18n';
import { setEmirate } from '../aftercare-actions';

type Search = Promise<Record<string, string | undefined>>;

/**
 * Operations by emirate (D11). Switching an emirate off stops new addresses, delivery and
 * bookings there. Categories are switched off under Content and businesses by suspension.
 */
export default async function OperationsPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const { locale, tr } = await translator();
  const { api, admin } = await requireAdmin('/admin/operations');
  if (!admin.capabilities.includes('operations.manage')) {
    return (
      <Shell locale={locale} admin={admin} current="operations">
        <div className="alert error">{tr('admin.forbidden')}</div>
      </Shell>
    );
  }
  const { items } = await api.adminEmirates();
  return (
    <Shell locale={locale} admin={admin} current="operations">
      <h1>{tr('admin.operations.title')}</h1>
      <p className="muted">{tr('admin.operations.intro')}</p>
      {params['saved'] ? (
        <div className="alert info" role="status">
          {tr('common.saved')}
        </div>
      ) : null}
      <ErrorAlert locale={locale} code={params['error']} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{tr('admin.operations.emirate')}</th>
              <th>{tr('admin.operations.status')}</th>
              <th>{tr('admin.operations.branches')}</th>
              <th>{tr('admin.operations.customers')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((e) => (
              <tr key={e.code}>
                <td>
                  {e.name[locale]} <span className="muted ltr-inline">{e.code}</span>
                </td>
                <td>
                  {e.enabled ? (
                    <span className="badge active">{tr('admin.operations.on')}</span>
                  ) : (
                    <span className="badge pending">{tr('admin.operations.off')}</span>
                  )}
                </td>
                <td>{e.branches}</td>
                <td>{e.customers}</td>
                <td>
                  <form action={setEmirate}>
                    <input type="hidden" name="code" value={e.code} />
                    <input type="hidden" name="enabled" value={e.enabled ? 'off' : 'on'} />
                    <button className={e.enabled ? 'btn ghost' : 'btn secondary'} type="submit">
                      {e.enabled
                        ? tr('admin.operations.switchOff')
                        : tr('admin.operations.switchOn')}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
