import type { BusinessView } from '@jays/contracts';
import type { Db } from '@jays/db';
import { businessCapabilities, BUSINESS_CAPABILITIES } from '@jays/domain';

/** Builds gateway views for several businesses in two queries. */
export async function loadBusinessViews(
  db: Db,
  entries: { businessId: string; permissions: readonly string[] }[],
): Promise<Map<string, BusinessView>> {
  const ids = [...new Set(entries.map((e) => e.businessId))];
  const result = new Map<string, BusinessView>();
  if (ids.length === 0) return result;
  const [businesses, modes] = await Promise.all([
    db
      .selectFrom('businesses')
      .select(['id', 'display_name', 'status', 'created_at'])
      .where('id', 'in', ids)
      .execute(),
    db
      .selectFrom('business_modes')
      .select(['business_id', 'mode', 'status'])
      .where('business_id', 'in', ids)
      .execute(),
  ]);
  for (const entry of entries) {
    const business = businesses.find((b) => b.id === entry.businessId);
    if (!business) continue;
    const modeStatus = (mode: 'shop' | 'services') =>
      modes.find((m) => m.business_id === business.id && m.mode === mode)?.status ??
      'not_activated';
    const capabilities = businessCapabilities(entry.permissions);
    result.set(business.id, {
      id: business.id,
      displayName: business.display_name,
      status: business.status,
      modes: { shop: modeStatus('shop'), services: modeStatus('services') },
      myPermissions: entry.permissions as BusinessView['myPermissions'],
      // Stable order so clients and snapshots do not churn.
      myCapabilities: BUSINESS_CAPABILITIES.filter((c) => capabilities.has(c)),
      createdAt: business.created_at.toISOString(),
    });
  }
  return result;
}
