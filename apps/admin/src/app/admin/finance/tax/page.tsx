import type { MessageKey } from '@jays/i18n';
import Link from 'next/link';
import { ErrorAlert } from '../../../../components/ErrorAlert';
import { Shell } from '../../../../components/Shell';
import { documentTitle } from '../../../../components/TaxDocumentView';
import { requireAdmin } from '../../../../lib/admin';
import { translator } from '../../../../lib/i18n';
import { setBusinessTax } from '../actions';
import { can, dateTime, FinanceTabs, Forbidden, money, Notice, type Search } from '../shared';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** UAE today and the first of its month. */
function defaultRange() {
  const today = new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);
  return { from: `${today.slice(0, 8)}01`, to: today };
}

/**
 * /admin/finance/tax: the VAT report for a period, every tax document, and sellers' VAT
 * registration (D3, D4; ADR-0021). Everything is a draft until a UAE tax professional approves the
 * tax rules.
 */
export default async function TaxPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const { locale, tr } = await translator();
  const { api, admin } = await requireAdmin('/admin/finance/tax');
  if (!can(admin, 'finance.view')) {
    return (
      <Shell locale={locale} admin={admin} current="finance">
        <Forbidden locale={locale} />
      </Shell>
    );
  }
  const range = defaultRange();
  const from = DATE.test(params['from'] ?? '') ? (params['from'] as string) : range.from;
  const to = DATE.test(params['to'] ?? '') ? (params['to'] as string) : range.to;
  const [report, docs] = await Promise.all([
    api.adminVatReport(from, to),
    api.adminTaxDocuments({
      limit: 50,
      ...(params['businessId'] ? { businessId: params['businessId'] } : {}),
    }),
  ]);
  const when = dateTime(locale);
  const manage = can(admin, 'finance.manage');
  const totals = (t: { netFils: number; vatFils: number; totalFils: number; documents: number }) =>
    `${money(t.vatFils, locale)} · ${tr('admin.tax.documentsCount', { n: t.documents })}`;
  return (
    <Shell locale={locale} admin={admin} current="finance">
      <h1>{tr('admin.tax.title')}</h1>
      <p className="muted">{tr('admin.tax.intro')}</p>
      <FinanceTabs locale={locale} current="tax" />
      <ErrorAlert locale={locale} code={params['error']} />
      <Notice locale={locale} params={params} />
      {!report.rulesApproved ? <div className="alert warning">{tr('tax.draftBanner')}</div> : null}

      <h2>{tr('admin.tax.report')}</h2>
      <form method="get" className="filters" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div className="field">
          <label htmlFor="from">{tr('admin.tax.from')}</label>
          <input id="from" name="from" type="date" defaultValue={from} />
        </div>
        <div className="field">
          <label htmlFor="to">{tr('admin.tax.to')}</label>
          <input id="to" name="to" type="date" defaultValue={to} />
        </div>
        <button className="btn secondary" type="submit" style={{ alignSelf: 'end' }}>
          {tr('admin.tax.show')}
        </button>
      </form>
      <section className="card" style={{ marginBlock: 12 }}>
        <h3 style={{ margin: 0 }}>{tr('admin.tax.platform')}</h3>
        <p className="muted" style={{ margin: 0 }}>
          {tr(
            report.platform.registered
              ? 'admin.tax.platformRegistered'
              : 'admin.tax.platformNotRegistered',
          )}
        </p>
        <dl className="kv">
          <dt>{tr('admin.tax.commissionInvoiced')}</dt>
          <dd>
            {money(report.platform.invoiced.netFils, locale)} · {totals(report.platform.invoiced)}
          </dd>
          <dt>{tr('admin.tax.commissionCredited')}</dt>
          <dd>
            {money(report.platform.credited.netFils, locale)} · {totals(report.platform.credited)}
          </dd>
          <dt>{tr('admin.tax.netVat')}</dt>
          <dd>{money(report.platform.netVatFils, locale)}</dd>
        </dl>
      </section>
      <p className="muted">{tr('admin.tax.sellersIntro')}</p>
      {report.businesses.length === 0 ? (
        <div className="alert info">{tr('admin.tax.none')}</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{tr('admin.tax.seller')}</th>
                <th>{tr('admin.tax.trn')}</th>
                <th>{tr('admin.tax.sales')}</th>
                <th>{tr('admin.tax.credits')}</th>
                <th>{tr('admin.tax.netVat')}</th>
              </tr>
            </thead>
            <tbody>
              {report.businesses.map((b) => (
                <tr key={b.business.id}>
                  <td>
                    <Link href={`/admin/finance/tax?businessId=${b.business.id}`}>
                      {b.business.name[locale]}
                    </Link>
                  </td>
                  <td className="ltr">
                    {b.taxRegistered && b.trn ? b.trn : tr('admin.tax.notRegistered')}
                  </td>
                  <td>
                    {money(b.invoiced.totalFils, locale)}
                    <div className="muted">{totals(b.invoiced)}</div>
                  </td>
                  <td>
                    {money(b.credited.totalFils, locale)}
                    <div className="muted">{totals(b.credited)}</div>
                  </td>
                  <td>{money(b.netVatFils, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>{tr('admin.tax.documents')}</h2>
      {docs.items.length === 0 ? (
        <div className="alert info">{tr('admin.tax.noDocuments')}</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{tr('admin.tax.number')}</th>
                <th>{tr('admin.tax.kind')}</th>
                <th>{tr('admin.tax.issued')}</th>
                <th>{tr('tax.vat')}</th>
                <th>{tr('tax.total')}</th>
              </tr>
            </thead>
            <tbody>
              {docs.items.map((d) => (
                <tr key={d.id}>
                  <td className="ltr">
                    <Link href={`/admin/finance/tax/${d.id}`}>{d.number}</Link>
                  </td>
                  <td>
                    {documentTitle(locale, d)}
                    <div className="muted">{tr(`admin.tax.issuer.${d.issuer}` as MessageKey)}</div>
                  </td>
                  <td>{when(d.issuedAt)}</td>
                  <td>{money(d.vatFils, locale)}</td>
                  <td>{money(d.totalFils, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {manage ? (
        <form action={setBusinessTax} className="card" style={{ maxWidth: 640, marginBlock: 16 }}>
          <h3>{tr('admin.tax.registration')}</h3>
          <p className="muted">{tr('admin.tax.registrationHint')}</p>
          <input type="hidden" name="back" value="/admin/finance/tax" />
          <div className="field">
            <label htmlFor="tax-business">{tr('admin.finance.businessId')}</label>
            <input
              id="tax-business"
              name="businessId"
              required
              className="ltr"
              defaultValue={params['businessId'] ?? ''}
            />
          </div>
          <fieldset className="field">
            <legend>{tr('admin.tax.registered')}</legend>
            <label>
              <input type="radio" name="taxRegistered" value="yes" required /> {tr('common.yes')}
            </label>{' '}
            <label>
              <input type="radio" name="taxRegistered" value="no" /> {tr('common.no')}
            </label>
          </fieldset>
          <div className="field">
            <label htmlFor="tax-trn">{tr('admin.tax.trn')}</label>
            <input
              id="tax-trn"
              name="taxId"
              inputMode="numeric"
              pattern="[0-9]{15}"
              className="ltr"
            />
            <small className="muted">{tr('admin.tax.trnHint')}</small>
          </div>
          <div className="field">
            <label htmlFor="tax-reason">{tr('admin.finance.reason')}</label>
            <input id="tax-reason" name="reason" required minLength={3} maxLength={500} />
          </div>
          <button className="btn" type="submit">
            {tr('admin.tax.save')}
          </button>
        </form>
      ) : null}
    </Shell>
  );
}
