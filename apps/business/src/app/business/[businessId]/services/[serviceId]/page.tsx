import Link from 'next/link';
import { ServiceFields } from '../../../../../components/ScheduleFields';
import { Workspace, aedInput, loadBusiness, money } from '../../../../../components/Workspace';
import { serverApi } from '../../../../../lib/api';
import { translator } from '../../../../../lib/i18n';
import { createAddon, updateAddon, updateService } from '../../schedule-actions';

type Search = Promise<Record<string, string | undefined>>;

export default async function ServicePage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string; serviceId: string }>;
  searchParams: Search;
}) {
  const { businessId, serviceId } = await params;
  const query = await searchParams;
  const { locale, tr } = await translator();
  const business = await loadBusiness(businessId);
  const path = `/business/${businessId}/services/${serviceId}`;
  const api = await serverApi();
  const [service, branches, categories, home, addons] = await Promise.all([
    api.service(businessId, serviceId),
    api.branches(businessId),
    api.categories('services'),
    api.homeServices(businessId),
    api.addons(businessId, serviceId),
  ]);
  const canManage = business.myCapabilities.includes('services.manage');
  const hidden = (
    <>
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="serviceId" value={serviceId} />
    </>
  );
  const addonFields = (a?: (typeof addons.items)[number]) => (
    <>
      <div className="grid2">
        <div className="field">
          <label htmlFor={`titleEn-${a?.id ?? 'new'}`}>{tr('addon.titleEn')}</label>
          <input
            id={`titleEn-${a?.id ?? 'new'}`}
            name="titleEn"
            type="text"
            minLength={2}
            maxLength={80}
            required
            defaultValue={a?.title.en ?? ''}
          />
        </div>
        <div className="field">
          <label htmlFor={`titleAr-${a?.id ?? 'new'}`}>{tr('addon.titleAr')}</label>
          <input
            id={`titleAr-${a?.id ?? 'new'}`}
            name="titleAr"
            type="text"
            dir="rtl"
            minLength={2}
            maxLength={80}
            required
            defaultValue={a?.title.ar ?? ''}
          />
        </div>
      </div>
      <div className="grid2">
        <div className="field">
          <label htmlFor={`price-${a?.id ?? 'new'}`}>{tr('addon.price')}</label>
          <input
            id={`price-${a?.id ?? 'new'}`}
            name="price"
            inputMode="decimal"
            dir="ltr"
            required
            defaultValue={a ? aedInput(a.priceFils) : ''}
          />
        </div>
        <div className="field">
          <label htmlFor={`duration-${a?.id ?? 'new'}`}>{tr('addon.duration')}</label>
          <input
            id={`duration-${a?.id ?? 'new'}`}
            name="durationMin"
            type="number"
            min={0}
            max={240}
            step={5}
            dir="ltr"
            required
            defaultValue={a?.durationMin ?? 0}
          />
        </div>
      </div>
    </>
  );
  return (
    <Workspace
      locale={locale}
      business={business}
      tab="services"
      path={path}
      title={service.title[locale]}
      error={query['error']}
      notice={query['saved'] ? tr('common.saved') : undefined}
    >
      <p>
        <Link href={`/business/${businessId}/services`}>{tr('services.title')}</Link>
      </p>
      <p>
        <span className={`badge ${service.status}`}>{tr(`service.status.${service.status}`)}</span>
      </p>
      {service.status === 'suspended' ? (
        <div className="alert error" role="alert">
          {tr('service.suspendedNote', { reason: service.suspensionReason ?? '' })}
        </div>
      ) : null}
      {service.locationMode !== 'in_venue' && !home.active ? (
        <div className="alert" role="status">
          {tr('service.homePaused')}{' '}
          <Link href={`/business/${businessId}/services/home`}>{tr('home.title')}</Link>
        </div>
      ) : null}
      <p className="muted">
        {tr('service.policy', {
          hours: service.cancelCutoffHours,
          percent: service.lateCancelRefundBps / 100,
        })}
      </p>
      <form action={updateService} className="card" style={{ maxWidth: 760 }}>
        <input type="hidden" name="businessId" value={businessId} />
        <input type="hidden" name="serviceId" value={serviceId} />
        <ServiceFields
          locale={locale}
          service={service}
          categories={categories.items.filter((c) => c.status === 'active')}
          branches={branches.filter((b) => b.status === 'active')}
          homeApproved={home.status === 'approved'}
        />
        <p className="inline-form">
          <button className="btn" type="submit">
            {tr('service.save')}
          </button>
          <button className="btn secondary" type="submit" name="archive" value="1">
            {tr('service.archive')}
          </button>
        </p>
      </form>
      <section className="card" id="addons" style={{ maxWidth: 760 }}>
        <h2>{tr('addon.title')}</h2>
        <p className="muted">{tr('addon.intro')}</p>
        {addons.items.length === 0 ? <p className="muted">{tr('addon.none')}</p> : null}
        <ul className="list">
          {addons.items.map((a) => (
            <li key={a.id} className="stack">
              <div className="row">
                <div className="grow">
                  <strong>{a.title[locale]}</strong>
                  <div className="muted" style={{ fontSize: 14 }}>
                    {tr('addon.summary', {
                      price: money(a.priceFils, locale),
                      minutes: a.durationMin,
                    })}
                  </div>
                </div>
                <span className={`badge ${a.status}`}>{tr(`addon.status.${a.status}`)}</span>
              </div>
              {canManage ? (
                <details>
                  <summary>{tr('addon.edit')}</summary>
                  <form action={updateAddon}>
                    {hidden}
                    <input type="hidden" name="addonId" value={a.id} />
                    {addonFields(a)}
                    <p className="inline-form">
                      <button className="btn secondary" type="submit">
                        {tr('addon.save')}
                      </button>
                      <button
                        className="btn ghost"
                        type="submit"
                        name="status"
                        value={a.status === 'active' ? 'archived' : 'active'}
                      >
                        {tr(a.status === 'active' ? 'addon.archive' : 'addon.restore')}
                      </button>
                    </p>
                  </form>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
        {canManage ? (
          <form action={createAddon}>
            <h3>{tr('addon.add')}</h3>
            {hidden}
            {addonFields()}
            <button className="btn" type="submit">
              {tr('addon.add')}
            </button>
          </form>
        ) : null}
      </section>
    </Workspace>
  );
}
