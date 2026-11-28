import { ApiClientError } from '@jays/api-client';
import type { OnboardingView } from '@jays/contracts';
import { DOCUMENT_KINDS, EMIRATE_CODES } from '@jays/domain';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BusinessNav } from '../../../../components/BusinessNav';
import { ErrorAlert } from '../../../../components/ErrorAlert';
import { TopBar } from '../../../../components/TopBar';
import { serverApi } from '../../../../lib/api';
import { translator } from '../../../../lib/i18n';
import {
  acceptAgreement,
  removeDocument,
  saveLegalProfile,
  finishDocumentUpload,
  prepareDocumentUpload,
  submitForReview,
} from './actions';
import { DirectUploadForm } from '../../../../components/DirectUploadForm';

type Search = Promise<Record<string, string | undefined>>;

export default async function OnboardingPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Search;
}) {
  const { businessId } = await params;
  const query = await searchParams;
  const { locale, tr } = await translator();
  const api = await serverApi();
  let business;
  try {
    business = await api.business(businessId);
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) notFound();
    throw error;
  }
  const returnTo = `/business/${businessId}/onboarding`;
  const isOwner = business.myCapabilities.includes('onboarding.manage');
  if (!isOwner) {
    return (
      <>
        <TopBar locale={locale} returnTo={returnTo} signedIn />
        <main className="page narrow">
          <BusinessNav locale={locale} business={business} current="verification" />
          <div className="alert info">{tr('onboarding.ownerOnly')}</div>
        </main>
      </>
    );
  }
  const view: OnboardingView = await api.onboarding(businessId);
  const merchantAgreement = await api.merchantAgreement(businessId);
  const emirates = (await api.emirates()).items;
  const date = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    dateStyle: 'medium',
    timeZone: 'Asia/Dubai',
  });
  const disabled = !view.editable;
  const legal = view.legal;
  const banner =
    view.status === 'rejected'
      ? tr('onboarding.banner.rejected', { reason: view.reviewReason ?? '' })
      : view.status === 'suspended'
        ? tr('onboarding.banner.suspended', { reason: view.suspensionReason ?? '' })
        : tr(`onboarding.banner.${view.status}`);
  const done = view.checklist.filter((i) => i.done).length;

  return (
    <>
      <TopBar locale={locale} returnTo={returnTo} signedIn />
      <main className="page">
        <p className="muted" style={{ marginBottom: 4 }}>
          {view.displayName[locale]}
        </p>
        <BusinessNav locale={locale} business={business} current="verification" />
        <h1>{tr('onboarding.title')}</h1>
        <p className="muted">{tr('onboarding.intro')}</p>
        <ErrorAlert locale={locale} code={query['error']} />
        {query['saved'] === 'submitted' ? (
          <div className="alert info" role="status">
            {tr('onboarding.submitted')}
          </div>
        ) : query['saved'] ? (
          <div className="alert info" role="status">
            {tr('common.saved')}
          </div>
        ) : null}
        <div
          className={`alert ${view.status === 'rejected' || view.status === 'suspended' ? 'error' : 'info'}`}
          role="status"
        >
          <span className={`badge ${view.status}`}>{tr(`business.status.${view.status}`)}</span>{' '}
          {banner}
        </div>

        <div className="split">
          <div className="stack">
            <section className="card" id="legal" aria-labelledby="legal-title">
              <h2 id="legal-title">{tr('onboarding.legal.title')}</h2>
              {disabled ? <p className="muted">{tr('onboarding.locked')}</p> : null}
              <form action={saveLegalProfile}>
                <input type="hidden" name="businessId" value={businessId} />
                <fieldset disabled={disabled} className="plain">
                  <div className="field">
                    <label htmlFor="legalName">{tr('onboarding.legal.legalName')}</label>
                    <input
                      id="legalName"
                      name="legalName"
                      type="text"
                      maxLength={200}
                      defaultValue={legal.legalName ?? ''}
                    />
                  </div>
                  <div className="grid2">
                    <div className="field">
                      <label htmlFor="tradeLicenseNumber">
                        {tr('onboarding.legal.licenseNumber')}
                      </label>
                      <input
                        id="tradeLicenseNumber"
                        name="tradeLicenseNumber"
                        type="text"
                        dir="ltr"
                        maxLength={40}
                        defaultValue={legal.tradeLicenseNumber ?? ''}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="licenseExpiry">{tr('onboarding.legal.licenseExpiry')}</label>
                      <input
                        id="licenseExpiry"
                        name="licenseExpiry"
                        type="date"
                        dir="ltr"
                        defaultValue={legal.licenseExpiry ?? ''}
                      />
                    </div>
                  </div>
                  <div className="field">
                    <label htmlFor="licenseAuthority">
                      {tr('onboarding.legal.licenseAuthority')}
                    </label>
                    <input
                      id="licenseAuthority"
                      name="licenseAuthority"
                      type="text"
                      maxLength={120}
                      defaultValue={legal.licenseAuthority ?? ''}
                    />
                  </div>
                  <label className="check">
                    <input
                      type="checkbox"
                      name="taxRegistered"
                      defaultChecked={legal.taxRegistered}
                    />
                    <span>{tr('onboarding.legal.taxRegistered')}</span>
                  </label>
                  <div className="field">
                    <label htmlFor="taxId">{tr('onboarding.legal.taxId')}</label>
                    <input
                      id="taxId"
                      name="taxId"
                      type="text"
                      inputMode="numeric"
                      dir="ltr"
                      pattern="[0-9]{15}"
                      defaultValue={legal.taxId ?? ''}
                      aria-describedby="taxId-hint"
                    />
                    <span id="taxId-hint" className="hint">
                      {tr('onboarding.legal.taxId.hint')}
                    </span>
                  </div>
                  <h3>{tr('onboarding.address.title')}</h3>
                  <div className="grid2">
                    <div className="field">
                      <label htmlFor="emirate">{tr('onboarding.address.emirate')}</label>
                      <select
                        id="emirate"
                        name="emirate"
                        defaultValue={legal.address.emirate ?? ''}
                      >
                        <option value="">—</option>
                        {emirates
                          .filter((e) => (EMIRATE_CODES as readonly string[]).includes(e.code))
                          .map((e) => (
                            <option key={e.code} value={e.code}>
                              {e.name[locale]}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="area">{tr('onboarding.address.area')}</label>
                      <input
                        id="area"
                        name="area"
                        type="text"
                        maxLength={120}
                        defaultValue={legal.address.area ?? ''}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="street">{tr('onboarding.address.street')}</label>
                      <input
                        id="street"
                        name="street"
                        type="text"
                        maxLength={160}
                        defaultValue={legal.address.street ?? ''}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="building">{tr('onboarding.address.building')}</label>
                      <input
                        id="building"
                        name="building"
                        type="text"
                        maxLength={120}
                        defaultValue={legal.address.building ?? ''}
                      />
                    </div>
                  </div>
                  <div className="field">
                    <label htmlFor="unit">
                      {tr('onboarding.address.unit')}{' '}
                      <span className="muted">({tr('common.optional')})</span>
                    </label>
                    <input
                      id="unit"
                      name="unit"
                      type="text"
                      maxLength={40}
                      defaultValue={legal.address.unit ?? ''}
                    />
                  </div>
                  <button className="btn" type="submit">
                    {tr('onboarding.save')}
                  </button>
                </fieldset>
              </form>
            </section>

            <section className="card" id="documents" aria-labelledby="documents-title">
              <h2 id="documents-title">{tr('onboarding.documents.title')}</h2>
              <p className="muted">{tr('onboarding.documents.hint')}</p>
              {view.documents.length === 0 ? (
                <p>{tr('onboarding.documents.none')}</p>
              ) : (
                <ul className="list">
                  {view.documents.map((d) => (
                    <li key={d.id} className="row">
                      <div className="grow">
                        <strong>{tr(`document.kind.${d.kind}`)}</strong>
                        <div className="muted ltr-inline">{d.fileName}</div>
                      </div>
                      <span
                        className={`badge ${d.status === 'clean' ? 'approved' : d.status === 'pending_upload' ? 'draft' : 'rejected'}`}
                      >
                        {tr(`document.status.${d.status}`)}
                        {d.rejectionReason
                          ? ` · ${tr(`upload.rejection.${d.rejectionReason}`)}`
                          : ''}
                      </span>
                      {d.status === 'clean' ? (
                        <a
                          className="btn secondary"
                          href={`/business/${businessId}/documents/${d.id}/download`}
                        >
                          {tr('onboarding.documents.download')}
                        </a>
                      ) : null}
                      {view.editable ? (
                        <form action={removeDocument}>
                          <input type="hidden" name="businessId" value={businessId} />
                          <input type="hidden" name="documentId" value={d.id} />
                          <button className="btn ghost" type="submit">
                            {tr('onboarding.documents.remove')}
                          </button>
                        </form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {view.editable ? (
                <DirectUploadForm
                  prepare={prepareDocumentUpload}
                  finish={finishDocumentUpload}
                  className="upload"
                >
                  <input type="hidden" name="businessId" value={businessId} />
                  <div className="grid2">
                    <div className="field">
                      <label htmlFor="kind">{tr('onboarding.documents.kind')}</label>
                      <select id="kind" name="kind" defaultValue="trade_license">
                        {DOCUMENT_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {tr(`document.kind.${k}`)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="file">{tr('onboarding.documents.file')}</label>
                      <input
                        id="file"
                        name="file"
                        type="file"
                        required
                        accept="application/pdf,image/jpeg,image/png"
                      />
                    </div>
                  </div>
                  <button className="btn secondary" type="submit">
                    {tr('onboarding.documents.upload')}
                  </button>
                </DirectUploadForm>
              ) : null}
            </section>

            <section className="card" aria-labelledby="payouts-title">
              <h2 id="payouts-title">{tr('onboarding.payouts.title')}</h2>
              <p className="muted" style={{ margin: 0 }}>
                {tr('onboarding.payouts.note')}
              </p>
            </section>

            <section className="card" id="agreement" aria-labelledby="agreement-title">
              <h2 id="agreement-title">{tr('onboarding.agreement.title')}</h2>
              <p className="muted">
                {tr('onboarding.agreement.body', { version: view.agreement.currentVersion })}
              </p>
              {merchantAgreement.document ? (
                <p>
                  <Link href="/legal/merchant_agreement" target="_blank">
                    {merchantAgreement.document.title[locale]} (
                    {tr('legal.version', { version: merchantAgreement.document.version })})
                  </Link>
                  <br />
                  <span className="muted">{tr('legal.draftNotice')}</span>
                </p>
              ) : null}
              {view.agreement.acceptedVersion === view.agreement.currentVersion &&
              view.agreement.acceptedAt &&
              !merchantAgreement.required ? (
                <p>
                  ✓{' '}
                  {tr('onboarding.agreement.accepted', {
                    version: merchantAgreement.accepted
                      ? String(merchantAgreement.accepted.version)
                      : view.agreement.acceptedVersion,
                    date: date.format(
                      new Date(merchantAgreement.accepted?.acceptedAt ?? view.agreement.acceptedAt),
                    ),
                  })}
                </p>
              ) : (
                <form action={acceptAgreement}>
                  <input type="hidden" name="businessId" value={businessId} />
                  <input type="hidden" name="version" value={view.agreement.currentVersion} />
                  {view.agreement.acceptedVersion === view.agreement.currentVersion ? (
                    <input type="hidden" name="onboardingAccepted" value="1" />
                  ) : null}
                  {merchantAgreement.required && merchantAgreement.document ? (
                    <input
                      type="hidden"
                      name="legalVersion"
                      value={merchantAgreement.document.version}
                    />
                  ) : null}
                  <fieldset
                    disabled={
                      disabled &&
                      // A new agreement version can be accepted after approval too.
                      view.agreement.acceptedVersion !== view.agreement.currentVersion
                    }
                    className="plain"
                  >
                    <label className="check">
                      <input type="checkbox" name="accept" required />
                      <span>{tr('onboarding.agreement.accept')}</span>
                    </label>
                    <button className="btn secondary" type="submit">
                      {tr('common.continue')}
                    </button>
                  </fieldset>
                </form>
              )}
            </section>
          </div>

          <aside className="stack">
            <section className="card" aria-labelledby="checklist-title">
              <h2 id="checklist-title">
                {tr('onboarding.checklist')}{' '}
                <span className="muted" style={{ fontWeight: 400 }}>
                  {done}/{view.checklist.length}
                </span>
              </h2>
              <ul className="checklist">
                {view.checklist.map((i) => (
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
              <p className="muted">
                <Link href={`/business/${businessId}/storefront`}>
                  {tr('business.nav.storefront')} →
                </Link>
              </p>
            </section>
            <section className="card" aria-labelledby="modes-title">
              <h2 id="modes-title">{tr('onboarding.modes.title')}</h2>
              <ul className="list">
                {(['shop', 'services'] as const).map((mode) => (
                  <li key={mode}>
                    <strong>{tr(`business.mode.${mode}`)}</strong>{' '}
                    <span className={`badge ${view.modes[mode].status}`}>
                      {tr(`business.mode.status.${view.modes[mode].status}`)}
                    </span>
                    {view.modes[mode].status === 'rejected' && view.modes[mode].reviewReason ? (
                      <div className="muted">{view.modes[mode].reviewReason}</div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
            <section className="card">
              <form action={submitForReview}>
                <input type="hidden" name="businessId" value={businessId} />
                <button className="btn block" type="submit" disabled={!view.canSubmit}>
                  {view.status === 'rejected' ? tr('onboarding.resubmit') : tr('onboarding.submit')}
                </button>
              </form>
              <p className="muted" style={{ marginBottom: 0 }}>
                {view.canSubmit ? tr('onboarding.submit.hint') : tr('onboarding.submit.blocked')}
              </p>
            </section>
          </aside>
        </div>
      </main>
    </>
  );
}
