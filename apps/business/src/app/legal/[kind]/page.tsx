import { ApiClientError } from '@jays/api-client';
import { LEGAL_DOCUMENT_KINDS } from '@jays/domain';
import { notFound } from 'next/navigation';
import { TopBar } from '../../../components/TopBar';
import { serverApi } from '../../../lib/api';
import { translator } from '../../../lib/i18n';

/** The published version of a legal document (ADR-0028). Every one is a draft pending review. */
export default async function LegalDocumentPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!(LEGAL_DOCUMENT_KINDS as readonly string[]).includes(kind)) notFound();
  const { locale, tr } = await translator();
  let doc;
  try {
    doc = await (await serverApi()).legalDocument(kind);
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) notFound();
    throw error;
  }
  const date = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    dateStyle: 'medium',
    timeZone: 'Asia/Dubai',
  });
  return (
    <>
      <TopBar locale={locale} returnTo={`/legal/${kind}`} signedIn={false} />
      <main className="page narrow">
        <h1>{doc.title[locale]}</h1>
        <p className="muted">
          {tr('legal.version', { version: doc.version })} ·{' '}
          {tr('legal.effective', { date: date.format(new Date(doc.effectiveAt)) })}
        </p>
        <div className="alert info">{tr('legal.draftNotice')}</div>
        <article style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{doc.body[locale]}</article>
      </main>
    </>
  );
}
