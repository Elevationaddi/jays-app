import Link from 'next/link';
import { PORTFOLIO_ITEMS_MAX } from '@jays/domain';
import { Workspace, loadBusiness } from '../../../../../components/Workspace';
import { serverApi } from '../../../../../lib/api';
import { translator } from '../../../../../lib/i18n';
import { removePortfolioPhoto, uploadPortfolioPhoto } from '../../schedule-actions';

type Search = Promise<Record<string, string | undefined>>;

/** Portfolio photos (phase 8.7): past work shown on the venue page, by service or professional. */
export default async function PortfolioPage({
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
  const path = `/business/${businessId}/services/portfolio`;
  const canManage = business.myCapabilities.includes('services.manage');
  const api = await serverApi();
  const [portfolio, services, staff] = await Promise.all([
    api.portfolio(businessId),
    api.services(businessId),
    api.staff(businessId),
  ]);
  const serviceName = (id: string | null) =>
    id ? (services.find((s) => s.id === id)?.title[locale] ?? '') : null;
  const staffName = (id: string | null) =>
    id ? (staff.find((s) => s.id === id)?.displayName ?? '') : null;
  return (
    <Workspace
      locale={locale}
      business={business}
      tab="services"
      path={path}
      title={tr('portfolio.title')}
      intro={tr('portfolio.intro')}
      error={query['error']}
      notice={query['saved'] ? tr('common.saved') : undefined}
    >
      <p>
        <Link href={`/business/${businessId}/services`}>{tr('services.title')}</Link>
      </p>
      {portfolio.items.length === 0 ? (
        <p className="muted">{tr('portfolio.none')}</p>
      ) : (
        <ul className="gallery">
          {portfolio.items.map((p) => (
            <li key={p.id}>
              <img src={p.imageUrl} alt={p.caption?.[locale] ?? ''} className="thumb product" />
              {p.caption ? <div style={{ fontSize: 14 }}>{p.caption[locale]}</div> : null}
              <div className="muted" style={{ fontSize: 13 }}>
                {[serviceName(p.serviceId), staffName(p.staffId)].filter(Boolean).join(' · ') ||
                  tr('portfolio.general')}
              </div>
              {canManage ? (
                <form action={removePortfolioPhoto}>
                  <input type="hidden" name="businessId" value={businessId} />
                  <input type="hidden" name="itemId" value={p.id} />
                  <button className="btn ghost" type="submit">
                    {tr('portfolio.remove')}
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canManage && portfolio.items.length < PORTFOLIO_ITEMS_MAX ? (
        <form action={uploadPortfolioPhoto} className="card" style={{ maxWidth: 760 }}>
          <h2>{tr('portfolio.add')}</h2>
          <input type="hidden" name="businessId" value={businessId} />
          <div className="field">
            <label htmlFor="portfolio-file">{tr('portfolio.file')}</label>
            <input
              id="portfolio-file"
              name="file"
              type="file"
              required
              accept="image/jpeg,image/png,image/webp"
              aria-describedby="portfolio-hint"
            />
            <p id="portfolio-hint" className="muted">
              {tr('portfolio.hint')}
            </p>
          </div>
          <div className="grid2">
            <div className="field">
              <label htmlFor="portfolio-service">{tr('portfolio.service')}</label>
              <select id="portfolio-service" name="serviceId" defaultValue="">
                <option value="">{tr('portfolio.anyService')}</option>
                {services
                  .filter((s) => s.status === 'active')
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title[locale]}
                    </option>
                  ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="portfolio-staff">{tr('portfolio.staff')}</label>
              <select id="portfolio-staff" name="staffId" defaultValue="">
                <option value="">{tr('portfolio.anyStaff')}</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.displayName}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid2">
            <div className="field">
              <label htmlFor="captionEn">{tr('portfolio.captionEn')}</label>
              <input id="captionEn" name="captionEn" type="text" maxLength={200} />
            </div>
            <div className="field">
              <label htmlFor="captionAr">{tr('portfolio.captionAr')}</label>
              <input id="captionAr" name="captionAr" type="text" dir="rtl" maxLength={200} />
            </div>
          </div>
          <button className="btn" type="submit">
            {tr('portfolio.upload')}
          </button>
        </form>
      ) : null}
    </Workspace>
  );
}
