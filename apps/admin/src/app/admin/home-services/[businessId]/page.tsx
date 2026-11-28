import { fils, formatAed } from '@jays/domain';
import Link from 'next/link';
import { ErrorAlert } from '../../../../components/ErrorAlert';
import { Shell } from '../../../../components/Shell';
import { requireAdmin } from '../../../../lib/admin';
import { translator } from '../../../../lib/i18n';
import { decideHomeServices } from '../actions';

type Search = Promise<Record<string, string | undefined>>;

/** One home-service application: licence, coverage and the decision forms. */
export default async function HomeServicePage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Search;
}) {
  const { businessId } = await params;
  const query = await searchParams;
  const { locale, tr } = await translator();
  const path = `/admin/home-services/${businessId}`;
  const { api, admin } = await requireAdmin(path);
  if (!admin.capabilities.includes('businesses.view')) {
    return (
      <Shell locale={locale} admin={admin} current="homeServices">
        <div className="alert error">{tr('admin.forbidden')}</div>
      </Shell>
    );
  }
  const p = await api.adminHomeService(businessId);
  const emirates = await api.emirates();
  const emirateName = (code: string) =>
    emirates.items.find((e) => e.code === code)?.name[locale] ?? code;
  const canReview = admin.capabilities.includes('businesses.review');
  const canDownload = admin.capabilities.includes('documents.view');
  const aed = (amount: number) => formatAed(fils(amount), locale);
  const decision = (
    value: 'approve' | 'reject' | 'suspend' | 'reinstate',
    needsReason: boolean,
    danger: boolean,
  ) => (
    <form action={decideHomeServices} className="inline-form">
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="expectedVersion" value={p.version} />
      <input type="hidden" name="decision" value={value} />
      {needsReason ? (
        <>
          <label className="sr-only" htmlFor={`reason-${value}`}>
            {tr('admin.home.reason')}
          </label>
          <input
            id={`reason-${value}`}
            name="reason"
            type="text"
            required
            minLength={3}
            maxLength={1000}
            placeholder={tr('admin.home.reason')}
          />
        </>
      ) : null}
      <button className={danger ? 'btn danger' : 'btn'} type="submit">
        {tr(`admin.home.${value}`)}
      </button>
    </form>
  );
  return (
    <Shell locale={locale} admin={admin} current="homeServices">
      <p>
        <Link href="/admin/home-services">{tr('admin.home.title')}</Link>
      </p>
      <h1>{p.business.name[locale]}</h1>
      <ErrorAlert locale={locale} code={query['error']} />
      {query['done'] ? (
        <div className="alert info" role="status">
          {tr('common.saved')}
        </div>
      ) : null}
      <p>
        <span className={`badge ${p.status}`}>{tr(`home.status.${p.status}`)}</span>{' '}
        {p.active ? tr('home.activeNote') : null}
      </p>
      {p.reviewReason ? (
        <p className="muted">{tr('home.reason', { reason: p.reviewReason })}</p>
      ) : null}
      <section className="card">
        <h2>{tr('home.licenceTitle')}</h2>
        <dl className="kv">
          <dt>{tr('home.licenseNumber')}</dt>
          <dd>
            <span className="ltr-inline">{p.licenseNumber ?? '—'}</span>
          </dd>
          <dt>{tr('home.licenseAuthority')}</dt>
          <dd>{p.licenseAuthority ?? '—'}</dd>
          <dt>{tr('home.licenseExpiry')}</dt>
          <dd>
            <span className="ltr-inline">{p.licenseExpiry ?? '—'}</span>
          </dd>
          <dt>{tr('home.licenseDocument')}</dt>
          <dd>
            {p.licenseDocument ? (
              canDownload ? (
                <a href={`/admin/businesses/${businessId}/documents/${p.licenseDocument.id}`}>
                  {p.licenseDocument.fileName}
                </a>
              ) : (
                p.licenseDocument.fileName
              )
            ) : (
              '—'
            )}
          </dd>
        </dl>
      </section>
      <section className="card">
        <h2>{tr('home.travelTitle')}</h2>
        <p>
          {tr('admin.home.terms', {
            buffer: p.travelBufferMin,
            minimum: aed(p.minOrderFils),
          })}
        </p>
        {p.areas.length === 0 ? (
          <p className="muted">{tr('admin.home.noAreas')}</p>
        ) : (
          <ul className="list">
            {p.areas.map((a) => (
              <li key={a.id} className="row">
                <span className="grow">
                  {emirateName(a.emirate)} · {a.area ?? tr('home.wholeEmirate')}
                </span>
                <span>{aed(a.travelFeeFils)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {canReview ? (
        <section className="card">
          <h2>{tr('admin.home.decision')}</h2>
          {p.status === 'pending' ? (
            <div className="stack">
              {decision('approve', false, false)}
              {decision('reject', true, true)}
            </div>
          ) : null}
          {p.status === 'approved' ? decision('suspend', true, true) : null}
          {p.status === 'suspended' ? decision('reinstate', false, false) : null}
          {p.status === 'rejected' || p.status === 'draft' ? (
            <p className="muted">{tr('admin.home.waiting')}</p>
          ) : null}
        </section>
      ) : null}
    </Shell>
  );
}
