import { ApiClientError } from '@jays/api-client';
import type { MediaView, StorefrontView } from '@jays/contracts';
import { notFound } from 'next/navigation';
import { BusinessNav } from '../../../../components/BusinessNav';
import { ErrorAlert } from '../../../../components/ErrorAlert';
import { TopBar } from '../../../../components/TopBar';
import { serverApi } from '../../../../lib/api';
import { translator } from '../../../../lib/i18n';
import { removeStorefrontImage, saveStorefront, uploadStorefrontImage } from './actions';

type Search = Promise<Record<string, string | undefined>>;
type Tr = Awaited<ReturnType<typeof translator>>['tr'];

export default async function StorefrontPage({
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
  const returnTo = `/business/${businessId}/storefront`;
  if (!business.myCapabilities.includes('storefront.manage')) {
    return (
      <>
        <TopBar locale={locale} returnTo={returnTo} signedIn />
        <main className="page narrow">
          <BusinessNav locale={locale} business={business} current="storefront" />
          <div className="alert info">{tr('business.team.noAccess')}</div>
        </main>
      </>
    );
  }
  const view: StorefrontView = await api.storefront(businessId);
  const locked = business.status === 'submitted' || business.status === 'under_review';
  const draft = view.draft;

  return (
    <>
      <TopBar locale={locale} returnTo={returnTo} signedIn />
      <main className="page">
        <p className="muted" style={{ marginBottom: 4 }}>
          {business.displayName[locale]}
        </p>
        <BusinessNav locale={locale} business={business} current="storefront" />
        <h1>{tr('storefront.title')}</h1>
        <p className="muted">{tr('storefront.intro')}</p>
        <ErrorAlert locale={locale} code={query['error']} />
        {query['saved'] ? (
          <div className="alert info" role="status">
            {tr('common.saved')}
          </div>
        ) : null}
        {locked ? (
          <div className="alert info">{tr('storefront.locked')}</div>
        ) : view.changesPending ? (
          <div className="alert info">{tr('storefront.pending')}</div>
        ) : view.changesReviewReason ? (
          <div className="alert error">
            {tr('storefront.changesRejected', { reason: view.changesReviewReason })}
          </div>
        ) : !view.publishedAt ? (
          <div className="alert info">{tr('storefront.notPublished')}</div>
        ) : null}

        <div className="split">
          <div className="stack">
            <section className="card" aria-labelledby="text-title">
              <h2 id="text-title">{tr('storefront.title')}</h2>
              <form action={saveStorefront}>
                <input type="hidden" name="businessId" value={businessId} />
                <fieldset disabled={locked} className="plain">
                  <div className="grid2">
                    <div className="field">
                      <label htmlFor="nameEn">{tr('storefront.name.en')}</label>
                      <input
                        id="nameEn"
                        name="nameEn"
                        type="text"
                        dir="ltr"
                        lang="en"
                        minLength={2}
                        maxLength={80}
                        required
                        defaultValue={draft.name?.en ?? ''}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="nameAr">{tr('storefront.name.ar')}</label>
                      <input
                        id="nameAr"
                        name="nameAr"
                        type="text"
                        dir="rtl"
                        lang="ar"
                        minLength={2}
                        maxLength={80}
                        required
                        defaultValue={draft.name?.ar ?? ''}
                      />
                    </div>
                  </div>
                  <div className="field">
                    <label htmlFor="descriptionEn">{tr('storefront.description.en')}</label>
                    <textarea
                      id="descriptionEn"
                      name="descriptionEn"
                      dir="ltr"
                      lang="en"
                      rows={4}
                      minLength={20}
                      maxLength={2000}
                      required
                      defaultValue={draft.description?.en ?? ''}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="descriptionAr">{tr('storefront.description.ar')}</label>
                    <textarea
                      id="descriptionAr"
                      name="descriptionAr"
                      dir="rtl"
                      lang="ar"
                      rows={4}
                      minLength={20}
                      maxLength={2000}
                      required
                      defaultValue={draft.description?.ar ?? ''}
                    />
                  </div>
                  <button className="btn" type="submit">
                    {tr('storefront.save')}
                  </button>
                </fieldset>
              </form>
            </section>
            <ImageCard
              tr={tr}
              businessId={businessId}
              purpose="storefront_logo"
              media={draft.logo}
              locked={locked}
            />
            <ImageCard
              tr={tr}
              businessId={businessId}
              purpose="storefront_banner"
              media={draft.banner}
              locked={locked}
            />
          </div>
          <aside className="stack">
            <section className="card" aria-labelledby="preview-title">
              <h2 id="preview-title">{tr('storefront.preview')}</h2>
              <Preview content={draft} locale={locale} tr={tr} />
            </section>
            {view.live && view.changesPending ? (
              <section className="card" aria-labelledby="live-title">
                <h2 id="live-title">{tr('storefront.live')}</h2>
                <Preview content={view.live} locale={locale} tr={tr} />
              </section>
            ) : null}
          </aside>
        </div>
      </main>
    </>
  );
}

function ImageCard({
  tr,
  businessId,
  purpose,
  media,
  locked,
}: {
  tr: Tr;
  businessId: string;
  purpose: 'storefront_logo' | 'storefront_banner';
  media: MediaView | null;
  locked: boolean;
}) {
  const key = purpose === 'storefront_logo' ? 'logo' : 'banner';
  return (
    <section className="card" aria-labelledby={`${key}-title`}>
      <h2 id={`${key}-title`}>{tr(`storefront.${key}`)}</h2>
      <p className="muted" style={{ margin: 0 }} id={`${key}-hint`}>
        {tr(`storefront.${key}.hint`)}
      </p>
      {media?.previewUrl ? (
        // Signed preview URLs straight from the API (next/image would proxy and cache them).
        <img
          src={media.previewUrl}
          alt=""
          className={key === 'logo' ? 'thumb logo' : 'thumb banner'}
        />
      ) : (
        <p className="muted">{tr('storefront.noImage')}</p>
      )}
      <fieldset disabled={locked} className="plain">
        <form action={uploadStorefrontImage} className="upload">
          <input type="hidden" name="businessId" value={businessId} />
          <input type="hidden" name="purpose" value={purpose} />
          <label className="sr-only" htmlFor={`${key}-file`}>
            {tr(`storefront.${key}`)}
          </label>
          <input
            id={`${key}-file`}
            name="file"
            type="file"
            required
            accept="image/jpeg,image/png,image/webp"
            aria-describedby={`${key}-hint`}
          />
          <button className="btn secondary" type="submit">
            {tr('storefront.upload')}
          </button>
        </form>
        {media ? (
          <form action={removeStorefrontImage}>
            <input type="hidden" name="businessId" value={businessId} />
            <input type="hidden" name="purpose" value={purpose} />
            <button className="btn ghost" type="submit">
              {tr('onboarding.documents.remove')}
            </button>
          </form>
        ) : null}
      </fieldset>
    </section>
  );
}

function Preview({
  content,
  locale,
  tr,
}: {
  content: StorefrontView['draft'];
  locale: 'en' | 'ar';
  tr: Tr;
}) {
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
        <strong>{content.name?.[locale] || tr(`storefront.name.${locale}`)}</strong>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        {content.description?.[locale] ?? ''}
      </p>
    </div>
  );
}
