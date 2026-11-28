import type { MessageKey } from '@jays/i18n';
import Link from 'next/link';
import { ErrorAlert } from '../../../components/ErrorAlert';
import { Shell } from '../../../components/Shell';
import { requireAdmin } from '../../../lib/admin';
import { translator } from '../../../lib/i18n';
import { createFeeRule, createFinanceSetting } from './actions';
import { can, dateTime, FinanceTabs, Forbidden, money, Notice, type Search } from './shared';

export default async function FinanceOverviewPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const { locale, tr } = await translator();
  const { api, admin } = await requireAdmin('/admin/finance');
  if (!can(admin, 'finance.view')) {
    return (
      <Shell locale={locale} admin={admin} current="finance">
        <Forbidden locale={locale} />
      </Shell>
    );
  }
  const [o, categories] = await Promise.all([api.adminFinanceOverview(), api.adminCategories()]);
  const when = dateTime(locale);
  const manage = can(admin, 'finance.manage');
  const settingValue = (key: string, value: number) => {
    if (key === 'payout_dispute_window_days') return tr('admin.finance.days', { n: value });
    if (key === 'platform_vat_registered') return tr(value === 1 ? 'common.yes' : 'common.no');
    if (key === 'commission_vat_bps') return `${(value / 100).toFixed(2)}%`;
    if (key === 'payout_weekday') return tr(`admin.finance.weekday.${value}` as MessageKey);
    return money(value, locale);
  };
  const attention: { key: MessageKey; n: number; href: string }[] = [
    {
      key: 'admin.finance.attn.refunds',
      n: o.refundRequestsPending,
      href: '/admin/finance/refunds?status=pending_approval',
    },
    {
      key: 'admin.finance.attn.payments',
      n: o.paymentsNeedingAttention,
      href: '/admin/finance/payments?attention=1',
    },
    {
      key: 'admin.finance.attn.payouts',
      n: o.payoutsNeedingAttention,
      href: '/admin/finance/payouts?status=failed',
    },
    {
      key: 'admin.finance.attn.disputes',
      n: o.openDisputes,
      href: '/admin/finance/disputes?status=open',
    },
    { key: 'admin.finance.attn.holds', n: o.activeHolds, href: '/admin/finance/payouts' },
    {
      key: 'admin.finance.attn.reconciliation',
      n: o.openReconciliationItems,
      href: '/admin/finance/reconciliation',
    },
  ];
  const balances: [MessageKey, number][] = [
    ['admin.finance.balance.clearing', o.balances.pspClearingFils],
    ['admin.finance.balance.payable', o.balances.merchantPayableFils],
    ['admin.finance.balance.inTransit', o.balances.payoutsInTransitFils],
    ['admin.finance.balance.commission', o.balances.platformCommissionFils],
    ['admin.finance.balance.outputVat', o.balances.platformOutputVatFils],
    ['admin.finance.balance.unallocated', o.balances.unallocatedReceiptsFils],
  ];
  return (
    <Shell locale={locale} admin={admin} current="finance">
      <h1>{tr('admin.finance.title')}</h1>
      <p className="muted">{tr('admin.finance.intro')}</p>
      <FinanceTabs locale={locale} current="overview" />
      <ErrorAlert locale={locale} code={params['error']} />
      <Notice locale={locale} params={params} />

      <div className="cards">
        <section className="card">
          <h2 style={{ margin: 0 }}>{tr('admin.finance.attention')}</h2>
          <ul className="list" style={{ gap: 6 }}>
            {attention.map((a) => (
              <li
                key={a.key}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  alignItems: 'center',
                }}
              >
                <Link href={a.href}>{tr(a.key)}</Link>
                <span className={`badge ${a.n > 0 ? 'held' : 'expired'}`}>{a.n}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="card">
          <h2 style={{ margin: 0 }}>{tr('admin.finance.balances')}</h2>
          <dl className="kv">
            {balances.map(([key, value]) => (
              <div key={key} style={{ display: 'contents' }}>
                <dt>{tr(key)}</dt>
                <dd>{money(value, locale)}</dd>
              </div>
            ))}
          </dl>
          <p className="muted" style={{ margin: 0 }}>
            {tr('admin.finance.balancesNote')}
          </p>
        </section>
        <section className="card">
          <h2 style={{ margin: 0 }}>{tr('admin.finance.lastReconciliation')}</h2>
          {o.lastReconciliation ? (
            <dl className="kv">
              <dt>{tr('admin.finance.recon.day')}</dt>
              <dd>{o.lastReconciliation.periodStart.slice(0, 10)}</dd>
              <dt>{tr('admin.bookings.status')}</dt>
              <dd>
                <span className={`badge ${o.lastReconciliation.status}`}>
                  {tr(`admin.finance.recon.status.${o.lastReconciliation.status}`)}
                </span>
              </dd>
              <dt>{tr('admin.finance.recon.recovered')}</dt>
              <dd>{o.lastReconciliation.recoveredCount}</dd>
              <dt>{tr('admin.finance.recon.mismatches')}</dt>
              <dd>{o.lastReconciliation.mismatchCount}</dd>
            </dl>
          ) : (
            <p className="muted">{tr('admin.finance.recon.none')}</p>
          )}
        </section>
      </div>

      <h2>{tr('admin.finance.settings')}</h2>
      <p className="muted">{tr('admin.finance.settingsIntro')}</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{tr('admin.finance.setting')}</th>
              <th>{tr('admin.finance.value')}</th>
              <th>{tr('admin.finance.effectiveAt')}</th>
              <th>{tr('admin.finance.reason')}</th>
            </tr>
          </thead>
          <tbody>
            {o.settings.map((s) => (
              <tr key={s.key}>
                <td>{tr(`admin.finance.setting.${s.key}`)}</td>
                <td>
                  {settingValue(s.key, s.value)}
                  {s.isDefault ? <div className="muted">{tr('admin.finance.default')}</div> : null}
                </td>
                <td>{when(s.effectiveAt)}</td>
                <td>
                  {s.reason ?? '—'}
                  {s.createdBy ? <div className="muted">{s.createdBy.name}</div> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {manage ? (
        <form
          action={createFinanceSetting}
          className="card"
          style={{ maxWidth: 640, marginBlock: 16 }}
        >
          <h3>{tr('admin.finance.newSetting')}</h3>
          <div className="field">
            <label htmlFor="setting-key">{tr('admin.finance.setting')}</label>
            <select id="setting-key" name="key" required>
              {o.settings.map((s) => (
                <option key={s.key} value={s.key}>
                  {tr(`admin.finance.setting.${s.key}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="setting-value">{tr('admin.finance.value')}</label>
            <input id="setting-value" name="value" inputMode="decimal" required className="ltr" />
            <small className="muted">{tr('admin.finance.valueHint')}</small>
          </div>
          <div className="field">
            <label htmlFor="setting-at">{tr('admin.finance.effectiveAt')}</label>
            <input id="setting-at" name="effectiveAt" type="datetime-local" />
            <small className="muted">{tr('admin.finance.effectiveHint')}</small>
          </div>
          <div className="field">
            <label htmlFor="setting-reason">{tr('admin.finance.reason')}</label>
            <input id="setting-reason" name="reason" required minLength={3} maxLength={500} />
          </div>
          <button className="btn" type="submit">
            {tr('admin.finance.schedule')}
          </button>
        </form>
      ) : null}

      <h2>{tr('admin.finance.feeRules')}</h2>
      <p className="muted">{tr('admin.finance.feeRulesIntro')}</p>
      {o.feeRules.length === 0 ? (
        <div className="alert info">{tr('admin.finance.noRules')}</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{tr('admin.finance.mode')}</th>
                <th>{tr('admin.finance.appliesTo')}</th>
                <th>{tr('admin.finance.rate')}</th>
                <th>{tr('admin.finance.effectiveAt')}</th>
                <th>{tr('admin.finance.reason')}</th>
              </tr>
            </thead>
            <tbody>
              {o.feeRules.map((r) => (
                <tr key={r.id}>
                  <td>{tr(r.mode === 'shop' ? 'mode.shop' : 'mode.services')}</td>
                  <td>
                    {r.business ? r.business.name[locale] : tr('admin.finance.platform')}
                    {r.category ? (
                      <div className="muted">
                        {tr('admin.finance.categoryLabel', { name: r.category.name[locale] })}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <bdi>{(r.commissionBps / 100).toFixed(2)}%</bdi>
                    {r.inForce ? (
                      <div>
                        <span className="badge active">{tr('admin.finance.inForce')}</span>
                      </div>
                    ) : null}
                  </td>
                  <td>{when(r.effectiveAt)}</td>
                  <td>
                    {r.reason}
                    {r.createdBy ? <div className="muted">{r.createdBy.name}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {manage ? (
        <form action={createFeeRule} className="card" style={{ maxWidth: 640, marginBlock: 16 }}>
          <h3>{tr('admin.finance.newRule')}</h3>
          <div className="field">
            <label htmlFor="rule-mode">{tr('admin.finance.mode')}</label>
            <select id="rule-mode" name="mode" required>
              <option value="shop">{tr('mode.shop')}</option>
              <option value="services">{tr('mode.services')}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="rule-business">{tr('admin.finance.businessIdOptional')}</label>
            <input id="rule-business" name="businessId" className="ltr" />
          </div>
          <div className="field">
            <label htmlFor="rule-category">{tr('admin.finance.categoryOptional')}</label>
            <select id="rule-category" name="categoryId" defaultValue="">
              <option value="">{tr('admin.finance.allCategories')}</option>
              {(['shop', 'services'] as const).map((m) => (
                <optgroup key={m} label={tr(m === 'shop' ? 'mode.shop' : 'mode.services')}>
                  {categories.items
                    .filter((c) => c.mode === m)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.parentId ? '— ' : ''}
                        {c.name[locale]}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
            <small className="muted">{tr('admin.finance.categoryHint')}</small>
          </div>
          <div className="field">
            <label htmlFor="rule-percent">{tr('admin.finance.ratePercent')}</label>
            <input id="rule-percent" name="percent" inputMode="decimal" required className="ltr" />
          </div>
          <div className="field">
            <label htmlFor="rule-at">{tr('admin.finance.effectiveAt')}</label>
            <input id="rule-at" name="effectiveAt" type="datetime-local" />
            <small className="muted">{tr('admin.finance.effectiveHint')}</small>
          </div>
          <div className="field">
            <label htmlFor="rule-reason">{tr('admin.finance.reason')}</label>
            <input id="rule-reason" name="reason" required minLength={3} maxLength={500} />
          </div>
          <button className="btn" type="submit">
            {tr('admin.finance.schedule')}
          </button>
        </form>
      ) : null}
    </Shell>
  );
}
