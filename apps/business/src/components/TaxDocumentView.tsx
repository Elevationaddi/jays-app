import type { TaxDocument } from '@jays/contracts';
import { t, type Locale, type MessageKey } from '@jays/i18n';

const money = (fils: number, locale: Locale) =>
  new Intl.NumberFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    style: 'currency',
    currency: 'AED',
  }).format(fils / 100);

/** The title a document carries: tax invoice only when the issuer was VAT registered (D4). */
export function documentTitle(locale: Locale, d: Pick<TaxDocument, 'kind' | 'taxDocument'>) {
  const credit = d.kind.endsWith('credit_note');
  const key = credit
    ? d.taxDocument
      ? 'tax.title.taxCreditNote'
      : 'tax.title.creditNote'
    : d.taxDocument
      ? 'tax.title.taxInvoice'
      : 'tax.title.invoice';
  return t(locale, key as MessageKey);
}

/** A printable invoice or credit note. Drafts say so until the tax rules are approved. */
export function TaxDocumentView({ doc, locale }: { doc: TaxDocument; locale: Locale }) {
  const tr = (key: MessageKey, vars?: Record<string, string | number>) => t(locale, key, vars);
  const date = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    dateStyle: 'long',
    timeZone: 'Asia/Dubai',
  }).format(new Date(doc.issuedAt));
  const party = (p: TaxDocument['seller']) => (
    <>
      <strong>{p.name[locale]}</strong>
      {p.address ? <div className="ltr">{p.address}</div> : null}
      {p.email ? <div className="ltr">{p.email}</div> : null}
      {p.trn ? <div>{tr('tax.trn', { trn: p.trn })}</div> : null}
    </>
  );
  return (
    <article className="card tax-doc">
      {!doc.rulesApproved ? <div className="alert info">{tr('tax.draftBanner')}</div> : null}
      <header
        style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}
      >
        <div>
          <h2 style={{ margin: 0 }}>{documentTitle(locale, doc)}</h2>
          <div className="ltr">{doc.number}</div>
          <div className="muted">{date}</div>
          {doc.credits ? (
            <div className="muted">{tr('tax.credits', { number: doc.credits.number })}</div>
          ) : null}
        </div>
        <div>{tr(doc.issuer === 'platform' ? 'tax.issuedByPlatform' : 'tax.issuedBySeller')}</div>
      </header>
      <div className="cards" style={{ marginBlock: 12 }}>
        <section>
          <h3 style={{ margin: 0 }}>{tr('tax.from')}</h3>
          {party(doc.seller)}
        </section>
        <section>
          <h3 style={{ margin: 0 }}>{tr('tax.to')}</h3>
          {party(doc.buyer)}
        </section>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{tr('tax.description')}</th>
              <th>{tr('tax.qty')}</th>
              <th>{tr('tax.vatRate')}</th>
              <th>{tr('tax.vat')}</th>
              <th>{tr('tax.lineTotal')}</th>
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((l, i) => (
              <tr key={i}>
                <td>{l.description[locale]}</td>
                <td>{l.qty}</td>
                <td>
                  <bdi>{(l.vatRateBps / 100).toFixed(2)}%</bdi>
                </td>
                <td>{money(l.vatFils, locale)}</td>
                <td>{money(l.totalFils, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="kv" style={{ maxWidth: 360, marginInlineStart: 'auto' }}>
        <dt>{tr('tax.net')}</dt>
        <dd>{money(doc.netFils, locale)}</dd>
        <dt>{tr('tax.vat')}</dt>
        <dd>{money(doc.vatFils, locale)}</dd>
        <dt>
          <strong>{tr('tax.total')}</strong>
        </dt>
        <dd>
          <strong>{money(doc.totalFils, locale)}</strong>
        </dd>
      </dl>
      {doc.issuer === 'business' ? <p className="muted">{tr('tax.intermediaryNote')}</p> : null}
    </article>
  );
}
