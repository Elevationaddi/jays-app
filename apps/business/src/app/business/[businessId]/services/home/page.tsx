import Link from 'next/link';
import { Workspace, aedInput, loadBusiness } from '../../../../../components/Workspace';
import { serverApi } from '../../../../../lib/api';
import { translator } from '../../../../../lib/i18n';
import { DirectUploadForm } from '../../../../../components/DirectUploadForm';
import {
  finishHomeLicenceUpload,
  prepareHomeLicenceUpload,
  saveHomeServices,
  submitHomeServices,
} from '../../home-actions';

type Search = Promise<Record<string, string | undefined>>;

const BLANK_ROWS = 3;

/** Home visits (D9): licence, travel buffer, minimum, coverage areas and the review status. */
export default async function HomeServicesPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Search;
}) {
  const { businessId } = await params;
  const query = await searchParams;
  const { locale, tr } = await translator();
  const business = await loadBusiness(businessId);
  const path = `/business/${businessId}/services/home`;
  const frame = { locale, business, tab: 'services' as const, path, title: tr('home.title') };
  const owner = business.myCapabilities.includes('onboarding.manage');
  const api = await serverApi();
  const [home, emirates, onboarding] = await Promise.all([
    api.homeServices(businessId),
    api.emirates(),
    owner ? api.onboarding(businessId) : Promise.resolve(null),
  ]);
  const licences = (onboarding?.documents ?? []).filter(
    (d) => d.kind === 'home_service_license' && d.status === 'clean',
  );
  const editable = owner && home.licenseEditable;
  const rows = [...home.areas, ...Array.from({ length: BLANK_ROWS }, () => null)];
  return (
    <Workspace
      {...frame}
      intro={tr('home.intro')}
      error={query['error']}
      notice={query['saved'] ? tr('common.saved') : undefined}
    >
      <p>
        <Link href={`/business/${businessId}/services`}>{tr('services.title')}</Link>
      </p>
      <section className="card" aria-labelledby="home-status">
        <h2 id="home-status">{tr('home.statusTitle')}</h2>
        <p>
          <span className={`badge ${home.status}`}>{tr(`home.status.${home.status}`)}</span>{' '}
          {home.active ? tr('home.activeNote') : null}
        </p>
        {home.reviewReason && (home.status === 'rejected' || home.status === 'suspended') ? (
          <div className="alert error" role="alert">
            {tr('home.reason', { reason: home.reviewReason })}
          </div>
        ) : null}
        {home.status === 'approved' && !home.active ? (
          <div className="alert error" role="alert">
            {tr('home.expired')}
          </div>
        ) : null}
        {owner && home.licenseEditable ? (
          <form action={submitHomeServices}>
            <input type="hidden" name="businessId" value={businessId} />
            <p className="muted">{tr('home.submitHint')}</p>
            <button className="btn" type="submit">
              {tr('home.submit')}
            </button>
          </form>
        ) : null}
      </section>

      {!owner ? <div className="alert info">{tr('home.ownerOnly')}</div> : null}

      {owner && editable ? (
        <section className="card" aria-labelledby="home-upload">
          <h2 id="home-upload">{tr('home.uploadTitle')}</h2>
          <DirectUploadForm
            prepare={prepareHomeLicenceUpload}
            finish={finishHomeLicenceUpload}
            className="inline-form"
          >
            <input type="hidden" name="businessId" value={businessId} />
            <label htmlFor="licenceFile" className="sr-only">
              {tr('home.uploadTitle')}
            </label>
            <input
              id="licenceFile"
              name="file"
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              required
            />
            <button className="btn secondary" type="submit">
              {tr('home.upload')}
            </button>
          </DirectUploadForm>
        </section>
      ) : null}

      <form action={saveHomeServices} className="card" aria-labelledby="home-licence">
        <input type="hidden" name="businessId" value={businessId} />
        <h2 id="home-licence">{tr('home.licenceTitle')}</h2>
        {!home.licenseEditable ? <p className="muted">{tr('home.licenceLocked')}</p> : null}
        <fieldset className="plain" disabled={!editable}>
          <div className="grid2">
            <div className="field">
              <label htmlFor="licenseNumber">{tr('home.licenseNumber')}</label>
              <input
                id="licenseNumber"
                name="licenseNumber"
                type="text"
                dir="ltr"
                maxLength={40}
                defaultValue={home.licenseNumber ?? ''}
              />
            </div>
            <div className="field">
              <label htmlFor="licenseAuthority">{tr('home.licenseAuthority')}</label>
              <input
                id="licenseAuthority"
                name="licenseAuthority"
                type="text"
                maxLength={120}
                defaultValue={home.licenseAuthority ?? ''}
              />
            </div>
            <div className="field">
              <label htmlFor="licenseExpiry">{tr('home.licenseExpiry')}</label>
              <input
                id="licenseExpiry"
                name="licenseExpiry"
                type="date"
                dir="ltr"
                defaultValue={home.licenseExpiry ?? ''}
              />
            </div>
            <div className="field">
              <label htmlFor="licenseDocumentId">{tr('home.licenseDocument')}</label>
              <select
                id="licenseDocumentId"
                name="licenseDocumentId"
                defaultValue={home.licenseDocument?.id ?? ''}
              >
                <option value="">{tr('home.noDocument')}</option>
                {home.licenseDocument &&
                !licences.some((d) => d.id === home.licenseDocument?.id) ? (
                  <option value={home.licenseDocument.id}>{home.licenseDocument.fileName}</option>
                ) : null}
                {licences.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.fileName}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </fieldset>
        {/* Locked licence fields still travel with the form, unchanged. */}
        {!editable ? (
          <>
            <input type="hidden" name="licenseNumber" value={home.licenseNumber ?? ''} />
            <input type="hidden" name="licenseAuthority" value={home.licenseAuthority ?? ''} />
            <input type="hidden" name="licenseExpiry" value={home.licenseExpiry ?? ''} />
            <input type="hidden" name="licenseDocumentId" value={home.licenseDocument?.id ?? ''} />
          </>
        ) : null}

        <h2>{tr('home.travelTitle')}</h2>
        <fieldset className="plain" disabled={!owner}>
          <div className="grid2">
            <div className="field">
              <label htmlFor="travelBufferMin">{tr('home.travelBuffer')}</label>
              <input
                id="travelBufferMin"
                name="travelBufferMin"
                type="number"
                dir="ltr"
                min={0}
                max={120}
                step={5}
                required
                defaultValue={home.travelBufferMin}
                aria-describedby="travelBufferHint"
              />
              <p id="travelBufferHint" className="hint">
                {tr('home.travelBufferHint')}
              </p>
            </div>
            <div className="field">
              <label htmlFor="minOrder">{tr('home.minOrder')}</label>
              <input
                id="minOrder"
                name="minOrder"
                type="text"
                dir="ltr"
                inputMode="decimal"
                defaultValue={aedInput(home.minOrderFils)}
                aria-describedby="minOrderHint"
              />
              <p id="minOrderHint" className="hint">
                {tr('home.minOrderHint')}
              </p>
            </div>
          </div>
          <h3>{tr('home.areasTitle')}</h3>
          <p className="muted">{tr('home.areasHint')}</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{tr('home.emirate')}</th>
                  <th scope="col">{tr('home.area')}</th>
                  <th scope="col">{tr('home.travelFee')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a, i) => (
                  <tr key={a?.id ?? `new-${i}`}>
                    <td>
                      <select
                        name={`emirate-${i}`}
                        aria-label={`${tr('home.emirate')} ${i + 1}`}
                        defaultValue={a?.emirate ?? ''}
                      >
                        <option value="">{tr('home.noArea')}</option>
                        {emirates.items.map((e) => (
                          <option key={e.code} value={e.code}>
                            {e.name[locale]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        name={`area-${i}`}
                        type="text"
                        maxLength={120}
                        aria-label={`${tr('home.area')} ${i + 1}`}
                        placeholder={tr('home.wholeEmirate')}
                        defaultValue={a?.area ?? ''}
                      />
                    </td>
                    <td>
                      <input
                        name={`fee-${i}`}
                        type="text"
                        dir="ltr"
                        inputMode="decimal"
                        style={{ width: 100 }}
                        aria-label={`${tr('home.travelFee')} ${i + 1}`}
                        defaultValue={a ? aedInput(a.travelFeeFils) : ''}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </fieldset>
        {owner ? (
          <p>
            <button className="btn" type="submit">
              {tr('home.save')}
            </button>
          </p>
        ) : null}
      </form>
    </Workspace>
  );
}
