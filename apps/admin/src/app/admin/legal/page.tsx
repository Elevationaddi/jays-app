import { LEGAL_DOCUMENT_KINDS } from '@jays/domain';
import Link from 'next/link';
import { ErrorAlert } from '../../../components/ErrorAlert';
import { Shell } from '../../../components/Shell';
import { requireAdmin } from '../../../lib/admin';
import { translator } from '../../../lib/i18n';
import { createLegalDraft } from './actions';

type Search = Promise<Record<string, string | undefined>>;

/** Legal documents (D13, ADR-0028): every version of each document, all drafts pending review. */
export default async function LegalPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const { locale, tr } = await translator();
  const { api, admin } = await requireAdmin('/admin/legal');
  if (!admin.capabilities.includes('legal.manage')) {
    return (
      <Shell locale={locale} admin={admin} current="legal">
        <div className="alert error">{tr('admin.forbidden')}</div>
      </Shell>
    );
  }
  const { items } = await api.adminLegal();
  const date = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    dateStyle: 'medium',
    timeZone: 'Asia/Dubai',
  });
  return (
    <Shell locale={locale} admin={admin} current="legal">
      <h1>{tr('admin.legal.title')}</h1>
      <p className="muted">{tr('admin.legal.intro')}</p>
      <div className="alert warning">{tr('admin.legal.reviewPending')}</div>
      <ErrorAlert locale={locale} code={params['error']} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">{tr('admin.legal.document')}</th>
              <th scope="col">{tr('admin.legal.inForce')}</th>
              <th scope="col">{tr('admin.legal.acceptances')}</th>
              <th scope="col">{tr('admin.legal.draft')}</th>
            </tr>
          </thead>
          <tbody>
            {LEGAL_DOCUMENT_KINDS.map((kind) => {
              const versions = items.filter((d) => d.kind === kind);
              const live = versions.find((d) => d.status === 'published');
              const draft = versions.find((d) => d.status === 'draft');
              const latest = versions.reduce<(typeof versions)[number] | undefined>(
                (a, d) => (a && a.version > d.version ? a : d),
                undefined,
              );
              return (
                <tr key={kind}>
                  <td>
                    <strong>
                      {(live ?? latest)?.title[locale] ?? tr(`admin.legal.kind.${kind}`)}
                    </strong>
                    <div className="muted">
                      {versions
                        .sort((a, b) => b.version - a.version)
                        .map((d) => (
                          <Link
                            key={d.id}
                            href={`/admin/legal/${d.id}`}
                            style={{ marginInlineEnd: 8 }}
                          >
                            v{d.version} ({tr(`admin.legal.status.${d.status}`)})
                          </Link>
                        ))}
                    </div>
                  </td>
                  <td>
                    {live && live.effectiveAt
                      ? `v${live.version} · ${date.format(new Date(live.effectiveAt))}`
                      : '—'}
                  </td>
                  <td>{live ? live.acceptances : '—'}</td>
                  <td>
                    {draft ? (
                      <Link href={`/admin/legal/${draft.id}`}>
                        {tr('admin.legal.editDraft', { version: draft.version })}
                      </Link>
                    ) : latest ? (
                      <form action={createLegalDraft}>
                        <input type="hidden" name="kind" value={kind} />
                        <input type="hidden" name="fromId" value={latest.id} />
                        <button className="btn secondary" type="submit">
                          {tr('admin.legal.newVersion')}
                        </button>
                      </form>
                    ) : (
                      <span className="muted">{tr('admin.legal.noVersions')}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
