import { redirect } from 'next/navigation';

/** Phase 1 linked setup per mode; verification is per business, so this forwards there. */
export default async function OnboardingModeRedirect({
  params,
}: {
  params: Promise<{ businessId: string; mode: string }>;
}) {
  const { businessId } = await params;
  redirect(`/business/${encodeURIComponent(businessId)}/onboarding`);
}
