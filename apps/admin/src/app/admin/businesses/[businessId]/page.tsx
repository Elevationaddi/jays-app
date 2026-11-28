import { ApiClientError } from '@jays/api-client';
import type { AdminBusinessDetail, AdminView, StorefrontView } from '@jays/contracts';
import {
  ACTION_CAPABILITY,
  ACTIONS_REQUIRING_REASON,
  canApplyAction,
  MODES,
  type BusinessReviewAction,
  type Mode,
} from '@jays/domain';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ErrorAlert } from '../../../../components/ErrorAlert';
import { Shell } from '../../../../components/Shell';
import { requireAdmin } from '../../../../lib/admin';
import { translator } from '../../../../lib/i18n';
import { actOnBusiness } from '../actions';

type Search = Promise<Record<string, string | undefined>>;

/** One form per decision the reviewer can make now, given the status and their role. */
interface ActionForm {
  action: BusinessReviewAction;
  mode?: Mode;
}

function availableActions(b: AdminBusinessDetail, admin: AdminView): ActionForm[] {
  const allowed = (a: BusinessReviewAction) =>
    canApplyAction(b.status, a) && admin.capabilities.includes(ACTION_CAPABILITY[a]);
  const pendingModes = MODES.filter((m) => b.modes[m] === 'pending_review');
  const forms: ActionForm[] = [];
  if (allowed('start_review')) forms.push({ action: 'start_review' });
  if (allowed('approve')) forms.push({ action: 'approve' });
  if (allowed('reject')) forms.push({ action: 'reject' });
  for (const mode of pendingModes) {
    if (allowed('approve_mode')) forms.push({ action: 'approve_mode', mode });
    if (allowed('reject_mode')) forms.push({ action: 'reject_mode', mode });
  }
  if (b.storefront.changesPending) {
    if (allowed('approve_storefront_changes')) forms.push({ action: 'approve_storefront_changes' });
    if (allowed('reject_storefront_changes')) forms.push({ action: 'reject_storefront_changes' });
  }
  if (allowed('suspend')) forms.push({ action: 'suspend' });
  if (allowed('reactivate')) forms.push({ action: 'reactivate' });
  return forms;
}

export default async function BusinessReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Search;
}) {
  const { businessId } = await params;
  const query = await searchParams;
  const { locale, tr } = await translator();
  const { api, admin } = await requireAdmin(`/admin/businesses/${businessId}`);
  if (!admin.capabilities.includes('businesses.view')) {
    return (
      <Shell locale={locale} admin={admin} current="businesses">
        <div className="alert error">{tr('admin.forbidden')}</div>
      </Shell>
    );
  }
  let b: AdminBusinessDetail;
  try {
    b = await api.adminBusiness(businessId);
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) notFound();
    throw error;
  }
  const when = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Dubai',
  });
  const canDocs = admin.capabilities.includes('documents.view');
  const forms = availableActions(b, admin);
  const pendingModes = MODES.filter((m) => b.modes[m] === 'pending_review');
  const legal = b.legal;
  const done = query['done'];

  return (
    <Shell locale={locale} admin={admin} current="businesses">
      <p style={{ margin: 0 }}>
        <Link href="/admin/businesses">← {tr('admin.business.back')}</Link>
      </p>
      <h1 style={{ marginTop: 8 }}>{b.displayName[locale]}</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        <span className={`badge ${b.status}`}>{tr(`business.status.${b.status}`)}</span>{' '}
        {tr('admin.business.version', { version: String(b.version) })}
      </p>
      <ErrorAlert locale={locale} code={query['error']} />
      {done ? (
        <div className="alert info" role="status">
          {tr('admin.business.done', {
            action: tr(`admin.action.${done as BusinessReviewAction}`),
          })}
        </div>
      ) : null}
      {b.reviewReason || b.suspensionReason ? (
        <div className="alert info">
          <strong>{tr('admin.business.reviewReason')}:</strong>{' '}
          {b.suspensionReason ?? b.reviewReason}
        </div>
      ) : null}

      <div className="split">
        <div className="stack">
          <section className="card" aria-labelledby="legal-title">
            <h2 id="legal-title">{tr('admin.business.legal')}</h2>
            <dl className="kv">
              <dt>{tr('onboarding.legal.legalName')}</dt>
              <dd>{legal.legalName ?? '—'}</dd>
              <dt>{tr('onboarding.legal.licenseNumber')}</dt>
              <dd className="ltr-inline">{legal.tradeLicenseNumber ?? '—'}</dd>
              <dt>{tr('onboarding.legal.licenseAuthority')}</dt>
              <dd>{legal.licenseAuthority ?? '—'}</dd>
              <dt>{tr('onboarding.legal.licenseExpiry')}</dt>
              <dd>
                <span className="ltr-inline">{legal.licenseExpiry ?? '—'}</span>{' '}
                {legal.licenseExpiry ? (
                  <span className={`badge ${b.licenseValid ? 'approved' : 'rejected'}`}>
                    {tr(
                      b.licenseValid
                        ? 'admin.business.licenseValid'
                        : 'admin.business.licenseExpired',
                    )}
                  </span>
                ) : null}
              </dd>
              <dt>{tr('onboarding.legal.taxRegistered')}</dt>
              <dd>
                {legal.taxRegistered ? tr('common.yes') : tr('common.no')}
                {legal.taxId ? <span className="ltr-inline"> · {legal.taxId}</span> : null}
              </dd>
              <dt>{tr('onboarding.address.title')}</dt>
              <dd>
                {[
                  legal.address.unit,
                  legal.address.building,
                  legal.address.street,
                  legal.address.area,
                  legal.address.emirate,
                ]
                  .filter(Boolean)
                  .join(locale === 'ar' ? '، ' : ', ') || '—'}
              </dd>
              <dt>{tr('admin.business.owner')}</dt>
              <dd>
                {b.owner ? (
                  <>
                    {b.owner.displayName ?? '—'}{' '}
                    <span className="muted ltr-inline">{b.owner.contact}</span>
                  </>
                ) : (
                  '—'
                )}
              </dd>
              <dt>{tr('admin.business.agreement')}</dt>
              <dd>
                {b.agreement.acceptedVersion && b.agreement.acceptedAt ? (
                  <>
                    <span className="ltr-inline">{b.agreement.acceptedVersion}</span> ·{' '}
                    {when.format(new Date(b.agreement.acceptedAt))}
                  </>
                ) : (
                  '—'
                )}
              </dd>
            </dl>
          </section>

          <section className="card" aria-labelledby="docs-title">
            <h2 id="docs-title">{tr('admin.business.documents')}</h2>
            {!canDocs ? <p className="muted">{tr('admin.business.noDocumentAccess')}</p> : null}
            {b.documents.length === 0 ? (
              <p className="muted">{tr('onboarding.documents.none')}</p>
            ) : (
              <ul className="list">
                {b.documents.map((d) => (
                  <li key={d.id} className="row">
                    <div className="grow">
                      <strong>{tr(`document.kind.${d.kind}`)}</strong>
                      <div className="muted ltr-inline">{d.fileName}</div>
                    </div>
                    <span className={`badge ${d.status === 'clean' ? 'approved' : 'rejected'}`}>
                      {tr(`document.status.${d.status}`)}
                    </span>
                    {canDocs && d.status === 'clean' ? (
                      <a
                        className="btn secondary"
                        href={`/admin/businesses/${b.id}/documents/${d.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {tr('admin.business.viewDocument')}
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card" aria-labelledby="storefront-title">
            <h2 id="storefront-title">{tr('admin.business.storefront')}</h2>
            <div className="grid2" style={{ rowGap: 16 }}>
              <div>
                <h3>{tr('admin.business.storefront.draft')}</h3>
                <StorefrontContent content={b.storefront.draft} />
              </div>
              {b.storefront.live ? (
                <div>
                  <h3>{tr('admin.business.storefront.live')}</h3>
                  <StorefrontContent content={b.storefront.live} />
                </div>
              ) : null}
            </div>
          </section>

          <section className="card" aria-labelledby="history-title">
            <h2 id="history-title">{tr('admin.business.history')}</h2>
            <ol className="history">
              {b.history.map((h) => (
                <li key={h.id}>
                  <code className="ltr-inline">{h.action}</code>{' '}
                  <span className="muted">
                    · {tr(`admin.audit.actorType.${h.actorType}`)} ·{' '}
                    {when.format(new Date(h.createdAt))}
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
            {forms.length === 0 ? <p className="muted">{tr('admin.business.noActions')}</p> : null}
            {forms.map((f) => {
              const needsReason = ACTIONS_REQUIRING_REASON.includes(f.action);
              const fieldId = `reason-${f.action}-${f.mode ?? 'all'}`;
              const destructive = needsReason;
              return (
                <form key={fieldId} action={actOnBusiness} className="action-form">
                  <input type="hidden" name="businessId" value={b.id} />
                  <input type="hidden" name="action" value={f.action} />
                  <input type="hidden" name="expectedVersion" value={b.version} />
                  {f.mode ? <input type="hidden" name="mode" value={f.mode} /> : null}
                  {f.action === 'approve' && pendingModes.length > 1 ? (
                    <fieldset>
                      <legend>{tr('admin.business.modesToApprove')}</legend>
                      {pendingModes.map((m) => (
                        <label key={m} className="check">
                          <input type="checkbox" name="modes" value={m} defaultChecked />
                          <span>{tr(`business.mode.${m}`)}</span>
                        </label>
                      ))}
                    </fieldset>
                  ) : null}
                  <label htmlFor={fieldId} className={needsReason ? '' : 'muted'}>
                    {tr(needsReason ? 'admin.business.reason' : 'admin.business.reasonOptional')}
                  </label>
                  <textarea
                    id={fieldId}
                    name="reason"
                    rows={2}
                    minLength={5}
                    maxLength={1000}
                    required={needsReason}
                  />
                  <button className={destructive ? 'btn danger' : 'btn'} type="submit">
                    {tr(`admin.action.${f.action}`)}
                    {f.mode ? ` · ${tr(`business.mode.${f.mode}`)}` : ''}
                  </button>
                </form>
              );
            })}
          </section>

          <section className="card" aria-labelledby="modes-title">
            <h2 id="modes-title">{tr('admin.business.modes')}</h2>
            <ul className="list">
              {MODES.map((m) => (
                <li key={m}>
                  <strong>{tr(`business.mode.${m}`)}</strong>{' '}
                  <span className={`badge ${b.modes[m]}`}>
                    {tr(`business.mode.status.${b.modes[m]}`)}
                  </span>
                  {b.modeReviews[m].reviewReason ? (
                    <div className="muted">{b.modeReviews[m].reviewReason}</div>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>

          <section className="card" aria-labelledby="checklist-title">
            <h2 id="checklist-title">{tr('admin.business.checklist')}</h2>
            <ul className="checklist">
              {b.checklist.map((i) => (
                <li key={i.item} className={i.done ? 'done' : 'todo'}>
                  <span aria-hidden="true">{i.done ? '✓' : '○'}</span>
                  <span>
                    {tr(`onboarding.item.${i.item}`)}
                    <span className="sr-only">
                      {' '}
                      ({tr(i.done ? 'onboarding.done' : 'onboarding.todo')})
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </Shell>
  );
}

function StorefrontContent({ content }: { content: StorefrontView['draft'] }) {
  return (
    <div className="store-preview">
      <div className="store-banner">
        {content.banner?.previewUrl ? <img src={content.banner.previewUrl} alt="" /> : null}
      </div>
      <div className="store-head">
        {content.logo?.previewUrl ? (
          <img className="store-logo" src={content.logo.previewUrl} alt="" />
        ) : (
          <span className="store-logo" aria-hidden="true" />
        )}
        <strong>{content.name?.en ?? '—'}</strong>
      </div>
      <p style={{ margin: 0 }}>
        <bdi dir="rtl" lang="ar">
          {content.name?.ar ?? ''}
        </bdi>
      </p>
      <p className="muted" style={{ margin: 0 }}>
        {content.description?.en ?? '—'}
      </p>
      {content.description?.ar ? (
        <p className="muted" dir="rtl" lang="ar" style={{ margin: 0 }}>
          {content.description.ar}
        </p>
      ) : null}
    </div>
  );
}
