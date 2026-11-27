import { Workspace, aedInput, loadBusiness } from '../../../../components/Workspace';
import { serverApi } from '../../../../lib/api';
import { translator } from '../../../../lib/i18n';
import { saveDeliveryZones } from '../catalog-actions';

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
  const [emirates, zones] = await Promise.all([api.emirates(), api.deliveryZones(businessId)]);
  const byCode = new Map(zones.items.map((z) => [z.emirate, z]));
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
                <th scope="col">{tr('delivery.fee')}</th>
                <th scope="col">{tr('delivery.freeOver')}</th>
                <th scope="col">{tr('delivery.minDays')}</th>
                <th scope="col">{tr('delivery.maxDays')}</th>
              </tr>
            </thead>
            <tbody>
              {emirates.items.map((e) => {
                const z = byCode.get(e.code);
                return (
                  <tr key={e.code}>
                    <td>
                      <label className="check">
                        <input type="checkbox" name={`on-${e.code}`} defaultChecked={Boolean(z)} />
                        <span>{e.name[locale]}</span>
                      </label>
                    </td>
                    <td>
                      <input
                        name={`fee-${e.code}`}
                        type="text"
                        aria-label={`${tr('delivery.fee')}: ${e.name[locale]}`}
                        dir="ltr"
                        inputMode="decimal"
                        style={{ width: 100 }}
                        defaultValue={z ? aedInput(z.feeFils) : '15.00'}
                      />
                    </td>
                    <td>
                      <input
                        name={`free-${e.code}`}
                        type="text"
                        aria-label={`${tr('delivery.freeOver')}: ${e.name[locale]}`}
                        dir="ltr"
                        inputMode="decimal"
                        style={{ width: 100 }}
                        defaultValue={z?.freeOverFils ? aedInput(z.freeOverFils) : ''}
                      />
                    </td>
                    <td>
                      <input
                        name={`min-${e.code}`}
                        aria-label={`${tr('delivery.minDays')}: ${e.name[locale]}`}
                        type="number"
                        min={0}
                        max={30}
                        dir="ltr"
                        style={{ width: 70 }}
                        defaultValue={z?.minDays ?? 1}
                      />
                    </td>
                    <td>
                      <input
                        name={`max-${e.code}`}
                        aria-label={`${tr('delivery.maxDays')}: ${e.name[locale]}`}
                        type="number"
                        min={0}
                        max={30}
                        dir="ltr"
                        style={{ width: 70 }}
                        defaultValue={z?.maxDays ?? 3}
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
    </Workspace>
  );
}
