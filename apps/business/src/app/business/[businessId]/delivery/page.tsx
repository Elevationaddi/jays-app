import { Workspace, aedInput, loadBusiness } from '../../../../components/Workspace';
import { serverApi } from '../../../../lib/api';
import { translator } from '../../../../lib/i18n';
import { DELIVERY_METHODS, RETURN_WINDOW_MAX_DAYS, RETURN_WINDOW_MIN_DAYS } from '@jays/domain';
import { saveDeliveryZones, saveReturnPolicy } from '../catalog-actions';

type Search = Promise<Record<string, string | undefined>>;

export default async function DeliveryPage({
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
  const path = `/business/${businessId}/delivery`;
  const frame = { locale, business, tab: 'delivery' as const, path, title: tr('delivery.title') };
  if (!business.myCapabilities.includes('storefront.manage')) {
    return (
      <Workspace {...frame}>
        <div className="alert info">{tr('business.team.noAccess')}</div>
      </Workspace>
    );
  }
  const api = await serverApi();
  const [emirates, zones, returns] = await Promise.all([
    api.emirates(),
    api.deliveryZones(businessId),
    api.returnPolicy(businessId),
  ]);
  const byKey = new Map(zones.items.map((z) => [`${z.emirate}:${z.method}`, z]));
  const rows = emirates.items.flatMap((e) => DELIVERY_METHODS.map((method) => ({ e, method })));
  return (
    <Workspace
      {...frame}
      intro={tr('delivery.intro')}
      error={query['error']}
      notice={query['saved'] ? tr('common.saved') : undefined}
    >
      <form action={saveDeliveryZones}>
        <input type="hidden" name="businessId" value={businessId} />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">{tr('delivery.covered')}</th>
                <th scope="col">{tr('delivery.method')}</th>
                <th scope="col">{tr('delivery.fee')}</th>
                <th scope="col">{tr('delivery.freeOver')}</th>
                <th scope="col">{tr('delivery.minDays')}</th>
                <th scope="col">{tr('delivery.maxDays')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ e, method }) => {
                const z = byKey.get(`${e.code}:${method}`);
                const k = method === 'standard' ? e.code : `${e.code}-${method}`;
                const label = `${e.name[locale]} · ${tr(`delivery.method.${method}`)}`;
                return (
                  <tr key={k}>
                    <td>
                      <label className="check">
                        <input
                          type="checkbox"
                          name={`on-${k}`}
                          aria-label={label}
                          defaultChecked={Boolean(z)}
                        />
                        <span>{method === 'standard' ? e.name[locale] : ''}</span>
                      </label>
                    </td>
                    <td>{tr(`delivery.method.${method}`)}</td>
                    <td>
                      <input
                        name={`fee-${k}`}
                        type="text"
                        aria-label={`${tr('delivery.fee')}: ${label}`}
                        dir="ltr"
                        inputMode="decimal"
                        style={{ width: 100 }}
                        defaultValue={
                          z ? aedInput(z.feeFils) : method === 'express' ? '30.00' : '15.00'
                        }
                      />
                    </td>
                    <td>
                      <input
                        name={`free-${k}`}
                        type="text"
                        aria-label={`${tr('delivery.freeOver')}: ${label}`}
                        dir="ltr"
                        inputMode="decimal"
                        style={{ width: 100 }}
                        defaultValue={z?.freeOverFils ? aedInput(z.freeOverFils) : ''}
                      />
                    </td>
                    <td>
                      <input
                        name={`min-${k}`}
                        aria-label={`${tr('delivery.minDays')}: ${label}`}
                        type="number"
                        min={0}
                        max={30}
                        dir="ltr"
                        style={{ width: 70 }}
                        defaultValue={z?.minDays ?? (method === 'express' ? 0 : 1)}
                      />
                    </td>
                    <td>
                      <input
                        name={`max-${k}`}
                        aria-label={`${tr('delivery.maxDays')}: ${label}`}
                        type="number"
                        min={0}
                        max={30}
                        dir="ltr"
                        style={{ width: 70 }}
                        defaultValue={z?.maxDays ?? (method === 'express' ? 1 : 3)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p>
          <button className="btn" type="submit">
            {tr('delivery.save')}
          </button>
        </p>
      </form>
      <section className="card" id="returns" aria-labelledby="returns-title">
        <h2 id="returns-title">{tr('returnPolicy.title')}</h2>
        <p className="muted">{tr('returnPolicy.intro', { days: RETURN_WINDOW_MIN_DAYS })}</p>
        <form action={saveReturnPolicy}>
          <input type="hidden" name="businessId" value={businessId} />
          <div className="field">
            <label htmlFor="windowDays">{tr('returnPolicy.window')}</label>
            <input
              id="windowDays"
              name="windowDays"
              type="number"
              min={RETURN_WINDOW_MIN_DAYS}
              max={RETURN_WINDOW_MAX_DAYS}
              dir="ltr"
              style={{ width: 90 }}
              defaultValue={returns.windowDays}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="noteEn">{tr('returnPolicy.noteEn')}</label>
            <textarea
              id="noteEn"
              name="noteEn"
              maxLength={500}
              rows={2}
              defaultValue={returns.note?.en ?? ''}
            />
          </div>
          <div className="field">
            <label htmlFor="noteAr">{tr('returnPolicy.noteAr')}</label>
            <textarea
              id="noteAr"
              name="noteAr"
              dir="rtl"
              maxLength={500}
              rows={2}
              defaultValue={returns.note?.ar ?? ''}
            />
          </div>
          <p className="muted">{tr('returnPolicy.excluded')}</p>
          <button className="btn" type="submit">
            {tr('common.save')}
          </button>
        </form>
      </section>
    </Workspace>
  );
}
