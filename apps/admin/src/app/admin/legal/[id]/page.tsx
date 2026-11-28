import Link from 'next/link';
import { ErrorAlert } from '../../../../components/ErrorAlert';
import { Shell } from '../../../../components/Shell';
import { requireAdmin } from '../../../../lib/admin';
import { translator } from '../../../../lib/i18n';
import { publishLegalDraft, updateLegalDraft } from '../actions';

type Search = Promise<Record<string, string | undefined>>;

/** One version of a legal document: its text, and for a draft the edit and publish forms. */
export default async function LegalVersionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Search;
}) {
  const { id } = await params;
  const query = await searchParams;
  const { locale, tr } = await translator();
  const { api, admin } = await requireAdmin(`/admin/legal/${id}`);
  if (!admin.capabilities.includes('legal.manage')) {
    return (
      <Shell locale={locale} admin={admin} current="legal">
        <div className="alert error">{tr('admin.forbidden')}</div>
      </Shell>
    );
  }
  const d = await api.adminLegalDocument(id);
  const date = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Dubai',
  });
  const draft = d.status === 'draft';
  return (
    <Shell locale={locale} admin={admin} current="legal">
      <p>
        <Link href="/admin/legal">{tr('admin.legal.title')}</Link>
      </p>
      <h1>
        {d.title[locale]} <span className="muted">v{d.version}</span>{' '}
        <span className={`badge ${d.status}`}>{tr(`admin.legal.status.${d.status}`)}</span>
      </h1>
      <div className="alert warning">{tr('admin.legal.reviewPending')}</div>
      <ErrorAlert locale={locale} code={query['error']} />
      {query['done'] ? (
        <div className="alert info" role="status">
          {tr(query['done'] === 'published' ? 'admin.legal.published' : 'common.saved')}
        </div>
      ) : null}
      <dl className="facts">
        <dt>{tr('admin.legal.effectiveAt')}</dt>
        <dd>{d.effectiveAt ? date.format(new Date(d.effectiveAt)) : '—'}</dd>
        <dt>{tr('admin.legal.acceptances')}</dt>
        <dd>{d.acceptances}</dd>
        <dt>{tr('admin.legal.summary')}</dt>
        <dd>{d.summaryOfChanges ?? '—'}</dd>
      </dl>
      {draft ? (
        <>
          <form action={updateLegalDraft} className="card">
            <input type="hidden" name="id" value={d.id} />
            <h2>{tr('admin.legal.editTitle')}</h2>
            {(['en', 'ar'] as const).map((l) => (
              <div key={l} dir={l === 'ar' ? 'rtl' : 'ltr'}>
                <div className="field">
                  <label htmlFor={`title-${l}`}>{tr(`admin.legal.titleField.${l}`)}</label>
                  <input
                    id={`title-${l}`}
                    name={l === 'en' ? 'titleEn' : 'titleAr'}
                    defaultValue={d.title[l]}
                    required
                    maxLength={200}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`body-${l}`}>{tr(`admin.legal.bodyField.${l}`)}</label>
                  <textarea
                    id={`body-${l}`}
                    name={l === 'en' ? 'bodyEn' : 'bodyAr'}
                    defaultValue={d.body[l]}
                    required
                    maxLength={60000}
                    rows={16}
                  />
                </div>
              </div>
            ))}
            <div className="field">
              <label htmlFor="summary">{tr('admin.legal.summary')}</label>
              <input
                id="summary"
                name="summaryOfChanges"
                defaultValue={d.summaryOfChanges ?? ''}
                maxLength={1000}
              />
            </div>
            <button className="btn" type="submit">
              {tr('common.save')}
            </button>
          </form>
          <form action={publishLegalDraft} className="card">
            <input type="hidden" name="id" value={d.id} />
            <h2>{tr('admin.legal.publishTitle')}</h2>
            <p className="muted">{tr('admin.legal.publishHint')}</p>
            <div className="field">
              <label htmlFor="effectiveAt">{tr('admin.legal.effectiveAt')}</label>
              <input id="effectiveAt" name="effectiveAt" type="datetime-local" />
            </div>
            <label className="check">
              <input type="checkbox" name="confirm" required />
              <span>{tr('admin.legal.publishConfirm')}</span>
            </label>
            <button className="btn" type="submit">
              {tr('admin.legal.publish')}
            </button>
          </form>
        </>
      ) : null}
      {(['en', 'ar'] as const).map((l) => (
        <section key={l} className="card" dir={l === 'ar' ? 'rtl' : 'ltr'} lang={l}>
          <h2>{d.title[l]}</h2>
          <article style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{d.body[l]}</article>
        </section>
      ))}
    </Shell>
  );
}
