import { randomUUID } from 'node:crypto';
import { STOCK_ADJUST_REASONS } from '@jays/domain';
import Link from 'next/link';
import { Workspace, loadBusiness } from '../../../../components/Workspace';
import { serverApi } from '../../../../lib/api';
import { translator } from '../../../../lib/i18n';
import { adjustStock } from '../catalog-actions';

type Search = Promise<Record<string, string | undefined>>;

export default async function InventoryPage({
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
  const path = `/business/${businessId}/inventory`;
  const frame = { locale, business, tab: 'inventory' as const, path, title: tr('inventory.title') };
  if (!business.myCapabilities.includes('inventory.adjust')) {
    return (
      <Workspace {...frame}>
        <div className="alert info">{tr('business.team.noAccess')}</div>
      </Workspace>
    );
  }
  const lowOnly = query['low'] === '1';
  const page = await (
    await serverApi()
  ).inventory(businessId, { ...(lowOnly ? { lowStock: 'true' as const } : {}), limit: 100 });
  return (
    <Workspace
      {...frame}
      intro={tr('inventory.intro')}
      error={query['error']}
      notice={query['saved'] ? tr('inventory.saved') : undefined}
    >
      <nav className="chips" style={{ marginBottom: 16 }} aria-label={tr('inventory.title')}>
        <Link className="btn ghost" href={path} aria-current={!lowOnly ? 'page' : undefined}>
          {tr('inventory.all')}
        </Link>
        <Link
          className="btn ghost"
          href={`${path}?low=1`}
          aria-current={lowOnly ? 'page' : undefined}
        >
          {tr('inventory.lowOnly')}
        </Link>
      </nav>
      {page.items.length === 0 ? (
        <p className="muted">{tr('inventory.empty')}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">{tr('products.title')}</th>
                <th scope="col">{tr('product.variant.sku')}</th>
                <th scope="col">{tr('inventory.onHand')}</th>
                <th scope="col">{tr('inventory.reserved')}</th>
                <th scope="col">{tr('inventory.available')}</th>
                <th scope="col">{tr('inventory.adjust')}</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((i) => (
                <tr key={i.variantId}>
                  <td>
                    <strong>{i.productTitle[locale]}</strong>
                    <div className="muted">{i.variantName[locale]}</div>
                    {i.lowStock ? (
                      <span className="badge rejected">{tr('inventory.low')}</span>
                    ) : null}
                  </td>
                  <td className="ltr">{i.sku}</td>
                  <td>{i.stockOnHand}</td>
                  <td>{i.stockReserved}</td>
                  <td>
                    <strong>{i.stockAvailable}</strong>
                  </td>
                  <td>
                    <form action={adjustStock} className="inline-form">
                      <input type="hidden" name="businessId" value={businessId} />
                      <input type="hidden" name="variantId" value={i.variantId} />
                      <input type="hidden" name="idempotencyKey" value={`stock-${randomUUID()}`} />
                      <label className="sr-only" htmlFor={`d-${i.variantId}`}>
                        {tr('inventory.delta')}
                      </label>
                      <input
                        id={`d-${i.variantId}`}
                        name="delta"
                        type="number"
                        required
                        min={-100000}
                        max={100000}
                        dir="ltr"
                        style={{ width: 90 }}
                        title={tr('inventory.delta')}
                      />
                      <label className="sr-only" htmlFor={`r-${i.variantId}`}>
                        {tr('inventory.reason')}
                      </label>
                      <select id={`r-${i.variantId}`} name="reason" defaultValue="restock">
                        {STOCK_ADJUST_REASONS.map((r) => (
                          <option key={r} value={r}>
                            {tr(`stockReason.${r}`)}
                          </option>
                        ))}
                      </select>
                      <button className="btn secondary" type="submit">
                        {tr('inventory.adjust')}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Workspace>
  );
}
