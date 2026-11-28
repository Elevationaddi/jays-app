'use server';

import { ApiClientError } from '@jays/api-client';
import { redirect } from 'next/navigation';
import { serverApi } from '../../../lib/api';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

function fail(error: unknown): never {
  const code = error instanceof ApiClientError ? error.code : 'INTERNAL';
  redirect(`/admin/pilot?error=${encodeURIComponent(code)}`);
}

/** datetime-local in UAE time to an ISO instant; empty means now. */
function instantOf(value: string): string | undefined | null {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  return new Date(`${value}:00+04:00`).toISOString();
}

/** Records one founder-approved pilot business's 0% commission for 30 days (ADR-0034). */
export async function createPromotion(f: FormData) {
  const businessId = str(f, 'businessId');
  const founderApproval = str(f, 'founderApproval');
  const startsAt = instantOf(str(f, 'startsAt'));
  if (!UUID.test(businessId) || founderApproval.length < 5 || startsAt === null) {
    redirect('/admin/pilot?error=VALIDATION_FAILED');
  }
  try {
    await (
      await serverApi()
    ).createPilotPromotion({ businessId, founderApproval, ...(startsAt ? { startsAt } : {}) });
  } catch (error) {
    fail(error);
  }
  redirect('/admin/pilot?saved=1');
}

export async function cancelPromotion(f: FormData) {
  const id = str(f, 'promotionId');
  const reason = str(f, 'reason');
  if (!UUID.test(id) || reason.length < 3) redirect('/admin/pilot?error=VALIDATION_FAILED');
  try {
    await (await serverApi()).cancelPilotPromotion(id, reason);
  } catch (error) {
    fail(error);
  }
  redirect('/admin/pilot?saved=1');
}
