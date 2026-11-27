import { PRODUCT_STATUSES } from '@jays/domain';
import Link from 'next/link';
import { Workspace, loadBusiness, money } from '../../../../components/Workspace';
import { serverApi } from '../../../../lib/api';
import { translator } from '../../../../lib/i18n';

type Search = Promise<Record<string, string | undefined>>;

export default async function ProductsPage({
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
  const path = `/business/${businessId}/products`;
  const frame = { locale, business, tab: 'products' as const, path, title: tr('products.title') };
  if (!business.myCapabilities.includes('catalog.manage')) {
    return (
      <Workspace {...frame}>
        <div className="alert info">{tr('business.team.noAccess')}</div>
      </Workspace>
    );
  }
  const status = (PRODUCT_STATUSES as readonly string[]).includes(query['status'] ?? '')
    ? query['status']
    : undefined;
  const page = await (
    await serverApi()
  ).merchantProducts(businessId, {
    ...(status ? { status } : {}),
    ...(query['cursor'] ? { cursor: query['cursor'] } : {}),
    limit: 50,
  });
  return (
    <Workspace
      {...frame}
      intro={tr('products.intro')}
      error={query['error']}
      notice={query['saved'] ? tr('common.saved') : undefined}
    >
      <div className="row" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <nav className="chips grow" aria-label={tr('products.title')}>
          <Link className="btn ghost" href={path} aria-current={!status ? 'page' : undefined}>
            {tr('admin.products.filter.all')}
          </Link>
          {PRODUCT_STATUSES.map((s) => (
            <Link
              key={s}
              className="btn ghost"
              href={`${path}?status=${s}`}
              aria-current={status === s ? 'page' : undefined}
            >
              {tr(`productStatus.${s}`)}
            </Link>
          ))}
        </nav>
        <Link className="btn" href={`${path}/new`}>
          {tr('products.new')}
        </Link>
      </div>
      {page.items.length === 0 ? (
        <p className="muted">{tr('products.empty')}</p>
      ) : (
        <ul className="list">
          {page.items.map((p) => (
            <li key={p.id} className="row">
              {p.imageUrl ? (
                <img src={p.imageUrl} alt="" className="thumb product" />
              ) : (
                <span className="thumb product" aria-hidden="true" />
              )}
              <div className="grow">
                <Link href={`${path}/${p.id}`}>
                  <strong>{p.title[locale]}</strong>
                </Link>
                <div className="muted" style={{ fontSize: 14 }}>
                  {p.priceFromFils !== null
                    ? tr('products.priceFrom', { price: money(p.priceFromFils, locale) })
                    : null}
                  {' · '}
                  {tr('products.available', { count: p.stockAvailable })}
                </div>
              </div>
              {p.changesPending ? (
                <span className="badge submitted">{tr('products.changesPending')}</span>
              ) : null}
              <span className={`badge ${p.status}`}>{tr(`productStatus.${p.status}`)}</span>
            </li>
          ))}
        </ul>
      )}
      {page.nextCursor ? (
        <p>
          <Link
            className="btn secondary"
            href={`${path}?${new URLSearchParams({ ...(status ? { status } : {}), cursor: page.nextCursor })}`}
          >
            {tr('common.next')}
          </Link>
        </p>
      ) : null}
    </Workspace>
  );
}
