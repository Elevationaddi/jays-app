import Link from 'next/link';
import { ServiceFields } from '../../../../../components/ScheduleFields';
import { Workspace, loadBusiness } from '../../../../../components/Workspace';
import { serverApi } from '../../../../../lib/api';
import { translator } from '../../../../../lib/i18n';
import { updateService } from '../../schedule-actions';

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
  const [service, branches, categories] = await Promise.all([
    api.service(businessId, serviceId),
    api.branches(businessId),
    api.categories('services'),
  ]);
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
    </Workspace>
  );
}
