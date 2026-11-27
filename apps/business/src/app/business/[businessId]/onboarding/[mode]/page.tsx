import { ApiClientError } from '@jays/api-client';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TopBar } from '../../../../../components/TopBar';
import { serverApi } from '../../../../../lib/api';
import { translator } from '../../../../../lib/i18n';

const STEPS = ['legal', 'address', 'payouts', 'storefront', 'agreement', 'review'] as const;

export default async function OnboardingPage({
  params,
}: {
  params: Promise<{ businessId: string; mode: string }>;
}) {
  const { businessId, mode } = await params;
  if (mode !== 'shop' && mode !== 'services') notFound();
  const { locale, tr } = await translator();
  let business;
  try {
    business = await (await serverApi()).business(businessId);
  } catch (error) {
    if (error instanceof ApiClientError && (error.status === 404 || error.status === 403))
      notFound();
    throw error;
  }
  const status = business.modes[mode];
  return (
    <>
      <TopBar locale={locale} returnTo={`/business/${businessId}/onboarding/${mode}`} signedIn />
      <main className="page narrow">
        <p>
          <Link href="/business/gateway">← {tr('business.nav.gateway')}</Link>
        </p>
        <h1>{tr('business.onboarding.title', { mode: tr(`business.mode.${mode}`) })}</h1>
        <p>
          <strong>{business.displayName[locale]}</strong>{' '}
          <span className={`badge ${status}`}>{tr(`business.mode.status.${status}`)}</span>
        </p>
        <p className="muted">{tr('business.onboarding.intro')}</p>
        <ol className="steps">
          {STEPS.map((step) => (
            <li key={step}>{tr(`business.onboarding.step.${step}`)}</li>
          ))}
        </ol>
      </main>
    </>
  );
}
