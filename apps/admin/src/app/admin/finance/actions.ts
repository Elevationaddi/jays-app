'use server';

import { ApiClientError } from '@jays/api-client';
import { redirect } from 'next/navigation';
import { serverApi } from '../../../lib/api';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AED = /^\d{1,9}(\.\d{1,2})?$/;

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

/** Only same-module paths are accepted as the place to return to. */
function backTo(f: FormData, fallback: string) {
  const back = str(f, 'back');
  return back.startsWith('/admin/finance') && !back.startsWith('//') ? back : fallback;
}

const withParam = (path: string, param: string) =>
  `${path}${path.includes('?') ? '&' : '?'}${param}`;

/** "12.50" AED to 1250 fils; null when not a valid amount. */
function filsOf(value: string): number | null {
  if (!AED.test(value)) return null;
  const [whole, frac = ''] = value.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

/** "10.5" percent to 1050 basis points. */
function bpsOf(value: string): number | null {
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(value)) return null;
  const [whole, frac = ''] = value.split('.');
  const bps = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return bps <= 10_000 ? bps : null;
}

/** datetime-local in Dubai time to an ISO instant; empty means "now" (undefined). */
function instantOf(value: string): string | undefined | null {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  return new Date(`${value}:00+04:00`).toISOString();
}

async function run(back: string, fn: () => Promise<unknown>, done = 'done=1') {
  try {
    await fn();
  } catch (error) {
    const code = error instanceof ApiClientError ? error.code : 'INTERNAL';
    redirect(withParam(back, `error=${encodeURIComponent(code)}`));
  }
  redirect(withParam(back, done));
}

const invalid = (back: string) => redirect(withParam(back, 'error=VALIDATION_FAILED'));

export async function createFeeRule(f: FormData) {
  const back = backTo(f, '/admin/finance');
  const mode = str(f, 'mode');
  const businessId = str(f, 'businessId');
  const categoryId = str(f, 'categoryId');
  const bps = bpsOf(str(f, 'percent'));
  const effectiveAt = instantOf(str(f, 'effectiveAt'));
  if (
    (mode !== 'shop' && mode !== 'services') ||
    (businessId && !UUID.test(businessId)) ||
    (categoryId && !UUID.test(categoryId)) ||
    bps === null ||
    effectiveAt === null
  ) {
    invalid(back);
  }
  await run(back, async () =>
    (await serverApi()).adminCreateFeeRule({
      mode: mode as 'shop' | 'services',
      businessId: businessId || null,
      categoryId: categoryId || null,
      commissionBps: bps as number,
      ...(effectiveAt ? { effectiveAt } : {}),
      reason: str(f, 'reason'),
    }),
  );
}

export async function createFinanceSetting(f: FormData) {
  const back = backTo(f, '/admin/finance');
  const key = str(f, 'key');
  const raw = str(f, 'value');
  const effectiveAt = instantOf(str(f, 'effectiveAt'));
  // Days, yes/no (1/0) and weekday (1 = Monday) are whole numbers; the VAT rate is a percentage;
  // the rest are AED amounts.
  const value = [
    'payout_dispute_window_days',
    'platform_vat_registered',
    'payout_weekday',
  ].includes(key)
    ? /^\d{1,3}$/.test(raw)
      ? Number(raw)
      : null
    : key === 'commission_vat_bps'
      ? bpsOf(raw)
      : filsOf(raw);
  if (
    ![
      'refund_approval_threshold_fils',
      'payout_dispute_window_days',
      'payout_minimum_fils',
      'platform_vat_registered',
      'commission_vat_bps',
      'payout_weekday',
    ].includes(key) ||
    value === null ||
    effectiveAt === null
  ) {
    invalid(back);
  }
  await run(back, async () =>
    (await serverApi()).adminCreateFinanceSetting({
      key: key as 'payout_dispute_window_days',
      value: value as number,
      ...(effectiveAt ? { effectiveAt } : {}),
      reason: str(f, 'reason'),
    }),
  );
}

export async function requestRefund(f: FormData) {
  const paymentId = str(f, 'paymentId');
  const back = backTo(f, '/admin/finance/payments');
  const merchantOrderId = str(f, 'merchantOrderId');
  const amountFils = filsOf(str(f, 'amount'));
  if (!UUID.test(paymentId) || (merchantOrderId && !UUID.test(merchantOrderId)) || !amountFils) {
    invalid(back);
  }
  await run(back, async () =>
    (await serverApi()).adminCreateRefundRequest({
      paymentId,
      merchantOrderId: merchantOrderId || null,
      amountFils: amountFils as number,
      reason: str(f, 'reason'),
    }),
  );
}

export async function decideRefund(f: FormData) {
  const id = str(f, 'requestId');
  const back = backTo(f, '/admin/finance/refunds');
  const decision = str(f, 'decision');
  if (!UUID.test(id) || (decision !== 'approve' && decision !== 'reject')) invalid(back);
  const note = str(f, 'note');
  await run(back, async () =>
    (await serverApi()).adminDecideRefundRequest(id, {
      decision: decision as 'approve' | 'reject',
      ...(note ? { note } : {}),
    }),
  );
}

export async function openDispute(f: FormData) {
  const earningId = str(f, 'earningId');
  const back = backTo(f, '/admin/finance/earnings');
  const amountFils = filsOf(str(f, 'amount'));
  if (!UUID.test(earningId) || !amountFils) invalid(back);
  await run(back, async () =>
    (await serverApi()).adminOpenDispute({
      earningId,
      amountFils: amountFils as number,
      reason: str(f, 'reason'),
    }),
  );
}

export async function resolveDispute(f: FormData) {
  const id = str(f, 'disputeId');
  const back = backTo(f, '/admin/finance/disputes');
  const outcome = str(f, 'outcome');
  if (!UUID.test(id) || (outcome !== 'won' && outcome !== 'lost')) invalid(back);
  await run(back, async () =>
    (await serverApi()).adminResolveDispute(id, {
      outcome: outcome as 'won' | 'lost',
      note: str(f, 'note'),
    }),
  );
}

export async function placeHold(f: FormData) {
  const businessId = str(f, 'businessId');
  const back = backTo(f, '/admin/finance/payouts');
  if (!UUID.test(businessId)) invalid(back);
  await run(back, async () =>
    (await serverApi()).adminPlacePayoutHold({ businessId, reason: str(f, 'reason') }),
  );
}

export async function releaseHold(f: FormData) {
  const id = str(f, 'holdId');
  const back = backTo(f, '/admin/finance/payouts');
  if (!UUID.test(id)) invalid(back);
  await run(back, async () => (await serverApi()).adminReleasePayoutHold(id));
}

/** Runs payouts and reports the counts back on the page. */
export async function runPayouts(f: FormData) {
  const back = backTo(f, '/admin/finance/payouts');
  let summary = '';
  try {
    const result = await (await serverApi()).adminRunPayouts();
    const reasons = new Map<string, number>();
    for (const s of result.skipped) reasons.set(s.reason, (reasons.get(s.reason) ?? 0) + 1);
    summary = [
      `paid=${result.payouts.filter((p) => p.status !== 'failed').length}`,
      `failed=${result.payouts.filter((p) => p.status === 'failed').length}`,
      `eligible=${result.madeEligible}`,
      ...[...reasons].map(([r, n]) => `skip_${r}=${n}`),
    ].join('&');
  } catch (error) {
    const code = error instanceof ApiClientError ? error.code : 'INTERNAL';
    redirect(withParam(back, `error=${encodeURIComponent(code)}`));
  }
  redirect(withParam(back, `ran=1&${summary}`));
}

export async function runReconciliation(f: FormData) {
  const back = backTo(f, '/admin/finance/reconciliation');
  const date = str(f, 'date');
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) invalid(back);
  await run(back, async () => (await serverApi()).adminRunReconciliation(date || undefined));
}

export async function resolveReconciliationItem(f: FormData) {
  const id = str(f, 'itemId');
  const back = backTo(f, '/admin/finance/reconciliation');
  if (!UUID.test(id)) invalid(back);
  await run(back, async () =>
    (await serverApi()).adminResolveReconciliationItem(id, str(f, 'note')),
  );
}

/** Records a seller's VAT registration and TRN (D4). */
export async function setBusinessTax(f: FormData) {
  const back = backTo(f, '/admin/finance/tax');
  const businessId = str(f, 'businessId');
  const registered = str(f, 'taxRegistered') === 'yes';
  const taxId = str(f, 'taxId');
  if (!UUID.test(businessId) || (taxId && !/^[0-9]{15}$/.test(taxId)) || (registered && !taxId)) {
    invalid(back);
  }
  await run(back, async () =>
    (await serverApi()).adminSetBusinessTax(businessId, {
      taxRegistered: registered,
      taxId: taxId || null,
      reason: str(f, 'reason'),
    }),
  );
}
