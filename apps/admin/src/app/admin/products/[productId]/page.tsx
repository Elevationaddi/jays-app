import { ApiClientError } from '@jays/api-client';
import type { AdminProductDetail } from '@jays/contracts';
import {
  PRODUCT_REVIEW_ACTIONS,
  canApplyProductAction,
  fils,
  formatAed,
  type ProductReviewAction,
} from '@jays/domain';
import type { Locale } from '@jays/i18n';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ErrorAlert } from '../../../../components/ErrorAlert';
import { Shell } from '../../../../components/Shell';
import { requireAdmin } from '../../../../lib/admin';
import { translator } from '../../../../lib/i18n';
import { actOnProduct } from '../actions';

type Search = Promise<Record<string, string | undefined>>;
const NEEDS_REASON: ProductReviewAction[] = ['reject', 'suspend', 'reinstate'];

export default async function ProductReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ productId: string }>;
  searchParams: Search;
}) {
  const { productId } = await params;
  const query = await searchParams;
  const { locale, tr } = await translator();
  const { api, admin } = await requireAdmin(`/admin/products/${productId}`);
  if (!admin.capabilities.includes('products.view')) {
    return (
      <Shell locale={locale} admin={admin} current="products">
        <div className="alert error">{tr('admin.forbidden')}</div>
      </Shell>
    );
  }
  let p: AdminProductDetail;
  try {
    p = await api.adminProduct(productId);
  } catch (error) {
    if (error instanceof ApiClientError && [400, 404].includes(error.status)) notFound();
    throw error;
  }
  const can = (c: string) => admin.capabilities.includes(c as never);
  const actions = PRODUCT_REVIEW_ACTIONS.filter(
    (a) =>
      canApplyProductAction(p.status, p.changesPending, a) &&
      (a === 'approve' || a === 'reject' ? can('products.review') : can('products.takedown')),
  );
  const when = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Dubai',
  });
  const done = PRODUCT_REVIEW_ACTIONS.find((a) => a === query['done']);

  return (
    <Shell locale={locale} admin={admin} current="products">
      <p>
        <Link href="/admin/products">{tr('admin.product.back')}</Link>
      </p>
      <h1>{p.draft.title[locale]}</h1>
      <p className="meta">
        <span className={`badge ${p.status}`}>{tr(`productStatus.${p.status}`)}</span>
        {p.changesPending ? (
          <span className="badge submitted">{tr('admin.products.changes')}</span>
        ) : null}
        <span className="muted">
          {tr('admin.product.store')}: {p.business.name[locale]} ·{' '}
          {tr('admin.business.version', { version: p.version })}
        </span>
      </p>
      <ErrorAlert locale={locale} code={query['error']} />
      {done ? (
        <div className="alert info" role="status">
          {tr('admin.business.done', { action: tr(`admin.productAction.${done}`) })}
        </div>
      ) : null}
      <div className="split">
        <div className="stack">
          <section className="card">
            <h2>{tr('admin.business.storefront.draft')}</h2>
            <Content content={p.draft} locale={locale} />
          </section>
          {p.live && p.changesPending ? (
            <section className="card">
              <h2>{tr('admin.product.live')}</h2>
              <Content content={p.live} locale={locale} />
            </section>
          ) : null}
          <section className="card">
            <h2>{tr('product.variants')}</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{tr('product.variant.sku')}</th>
                    <th>{tr('product.variant.nameEn')}</th>
                    <th>{tr('product.variant.price')}</th>
                    <th>{tr('product.variant.taxClass')}</th>
                    <th>{tr('inventory.available')}</th>
                  </tr>
                </thead>
                <tbody>
                  {p.variants.map((v) => (
                    <tr key={v.id}>
                      <td className="ltr">{v.sku}</td>
                      <td>
                        {v.name.en} / <span lang="ar">{v.name.ar}</span>
                      </td>
                      <td>{formatAed(fils(v.priceFils), locale)}</td>
                      <td>{tr(`taxClass.${v.taxClass}`)}</td>
                      <td>{v.stockAvailable}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="card" aria-labelledby="history-title">
            <h2 id="history-title">{tr('admin.business.history')}</h2>
            <ol className="history">
              {p.history.map((h) => (
                <li key={h.id}>
                  <strong className="ltr-inline">{h.action}</strong>{' '}
                  <span className="muted">
                    · {h.actorType} · {when.format(new Date(h.createdAt))}
                  </span>
                  {h.reason ? <div>{h.reason}</div> : null}
                </li>
              ))}
            </ol>
          </section>
        </div>
        <aside className="stack">
          <section className="card" aria-labelledby="actions-title">
            <h2 id="actions-title">{tr('admin.business.actions')}</h2>
            {actions.length === 0 ? (
              <p className="muted">{tr('admin.business.noActions')}</p>
            ) : null}
            {actions.map((a) => {
              const needsReason = NEEDS_REASON.includes(a);
              return (
                <form key={a} action={actOnProduct} className="action-form">
                  <input type="hidden" name="productId" value={p.id} />
                  <input type="hidden" name="action" value={a} />
                  <input type="hidden" name="expectedVersion" value={p.version} />
                  <label htmlFor={`reason-${a}`} className={needsReason ? '' : 'muted'}>
                    {tr(needsReason ? 'admin.business.reason' : 'admin.business.reasonOptional')}
                  </label>
                  <textarea
                    id={`reason-${a}`}
                    name="reason"
                    rows={2}
                    minLength={3}
                    maxLength={1000}
                    required={needsReason}
                  />
                  <button
                    className={a === 'approve' || a === 'reinstate' ? 'btn' : 'btn danger'}
                    type="submit"
                  >
                    {tr(`admin.productAction.${a}`)}
                  </button>
                </form>
              );
            })}
          </section>
        </aside>
      </div>
    </Shell>
  );
}

function Content({ content }: { content: AdminProductDetail['draft']; locale: Locale }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      {content.images.length > 0 ? (
        <div className="chips">
          {content.images.map((img) =>
            img.url ? (
              <img
                key={img.id}
                src={img.url}
                alt=""
                style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 8 }}
              />
            ) : null,
          )}
        </div>
      ) : null}
      <div className="grid2">
        <div lang="en" dir="ltr">
          <strong>{content.title.en}</strong>
          <p style={{ whiteSpace: 'pre-wrap' }}>{content.description.en}</p>
        </div>
        <div lang="ar" dir="rtl">
          <strong>{content.title.ar}</strong>
          <p style={{ whiteSpace: 'pre-wrap' }}>{content.description.ar}</p>
        </div>
      </div>
    </div>
  );
}
