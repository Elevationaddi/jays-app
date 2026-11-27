import type { AdminProductListQuery } from '@jays/contracts';
import { PRODUCT_STATUSES } from '@jays/domain';
import Link from 'next/link';
import { ErrorAlert } from '../../../components/ErrorAlert';
import { Shell } from '../../../components/Shell';
import { requireAdmin } from '../../../lib/admin';
import { translator } from '../../../lib/i18n';

type Search = Promise<Record<string, string | undefined>>;
const FILTERS = ['pending', ...PRODUCT_STATUSES, 'all'] as const;

export default async function ProductsPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const { locale, tr } = await translator();
  const { api, admin } = await requireAdmin('/admin/products');
  if (!admin.capabilities.includes('products.view')) {
    return (
      <Shell locale={locale} admin={admin} current="products">
        <div className="alert error">{tr('admin.forbidden')}</div>
      </Shell>
    );
  }
  const status = (FILTERS as readonly string[]).includes(params['status'] ?? '')
    ? (params['status'] as AdminProductListQuery['status'])
    : 'pending';
  const page = await api.adminProducts({
    status,
    limit: 50,
    ...(params['cursor'] ? { cursor: params['cursor'] } : {}),
  });
  const when = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Dubai',
  });
  const label = (f: (typeof FILTERS)[number]) =>
    f === 'pending' || f === 'all' ? tr(`admin.products.filter.${f}`) : tr(`productStatus.${f}`);

  return (
    <Shell locale={locale} admin={admin} current="products">
      <h1>{tr('admin.products.title')}</h1>
      <ErrorAlert locale={locale} code={params['error']} />
      <nav className="tabs filters" aria-label={tr('admin.businesses.status')}>
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={`/admin/products?status=${f}`}
            aria-current={status === f ? 'page' : undefined}
          >
            {label(f)}
          </Link>
        ))}
      </nav>
      {page.items.length === 0 ? (
        <p className="muted">{tr('admin.products.empty')}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{tr('products.title')}</th>
                <th>{tr('admin.product.store')}</th>
                <th>{tr('admin.businesses.status')}</th>
                <th>{tr('admin.businesses.submitted')}</th>
                <th>
                  <span className="sr-only">{tr('admin.businesses.open')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.title[locale]}</strong>
                  </td>
                  <td>{p.business.name[locale]}</td>
                  <td>
                    <span className={`badge ${p.status}`}>{tr(`productStatus.${p.status}`)}</span>
                    {p.changesPending ? (
                      <div className="muted">{tr('admin.products.changes')}</div>
                    ) : null}
                  </td>
                  <td>{p.submittedAt ? when.format(new Date(p.submittedAt)) : '—'}</td>
                  <td>
                    <Link className="btn secondary" href={`/admin/products/${p.id}`}>
                      {tr('admin.businesses.open')}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {page.nextCursor ? (
        <p>
          <Link
            href={`/admin/products?status=${status}&cursor=${encodeURIComponent(page.nextCursor)}`}
          >
            {tr('common.next')} →
          </Link>
        </p>
      ) : null}
    </Shell>
  );
}
