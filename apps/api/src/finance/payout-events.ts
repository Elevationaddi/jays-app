import { postings } from '@jays/domain';
import type { ProviderEvent } from '../payments/provider.js';
import { post, type Trx } from './ledger.js';

/**
 * Applies a verified `payout.paid` or `payout.failed` webhook (ADR-0015). Paid: the money left
 * the provider, so in-transit clears against the clearing account and the earnings are settled.
 * Failed: the amount goes back to what the business is owed and its earnings become eligible
 * again; the payout is flagged for finance. Each posting happens once per payout.
 */
export async function applyPayoutEvent(
  trx: Trx,
  event: ProviderEvent,
  now: Date,
): Promise<{ result: string }> {
  if (!event.payoutId) return { result: 'unknown_payout' };
  const byRef = await trx
    .selectFrom('payouts')
    .select(['id', 'business_id', 'amount_fils', 'status', 'provider_ref'])
    .where('provider_ref', '=', event.payoutId)
    .forUpdate()
    .executeTakeFirst();
  // The webhook can arrive before we stored the provider's id; match on our reference then.
  const payout =
    byRef ??
    (event.reference && /^[0-9a-f-]{36}$/i.test(event.reference)
      ? await trx
          .selectFrom('payouts')
          .select(['id', 'business_id', 'amount_fils', 'status', 'provider_ref'])
          .where('id', '=', event.reference)
          .where('provider_ref', 'is', null)
          .forUpdate()
          .executeTakeFirst()
      : undefined);
  if (!payout) return { result: 'unknown_payout' };
  if (!payout.provider_ref) {
    await trx
      .updateTable('payouts')
      .set({ provider_ref: event.payoutId })
      .where('id', '=', payout.id)
      .execute();
  }
  if (payout.status !== 'pending') return { result: 'already_settled' };
  if (event.amountFils !== payout.amount_fils) {
    await trx
      .updateTable('payouts')
      .set({ needs_attention: true })
      .where('id', '=', payout.id)
      .execute();
    return { result: 'amount_mismatch' };
  }
  const outbox = (type: string) =>
    trx
      .insertInto('outbox')
      .values({
        event_type: type,
        payload: JSON.stringify({ payoutId: payout.id, businessId: payout.business_id }),
        available_at: now,
      })
      .execute();
  if (event.type === 'payout.paid') {
    await trx
      .updateTable('payouts')
      .set({ status: 'paid', paid_at: now })
      .where('id', '=', payout.id)
      .execute();
    await trx
      .updateTable('merchant_earnings')
      .set({ status: 'paid_out' })
      .where('payout_id', '=', payout.id)
      .where('status', '=', 'in_payout')
      .execute();
    await post(
      trx,
      {
        kind: 'payout_paid',
        sourceType: 'payout',
        sourceId: payout.id,
        businessId: payout.business_id,
        occurredAt: now,
      },
      postings.payoutPaid(payout.business_id, payout.amount_fils),
    );
    await outbox('payout.paid');
    return { result: 'payout_paid' };
  }
  await trx
    .updateTable('payouts')
    .set({
      status: 'failed',
      failed_at: now,
      failure_code: event.failureCode ?? 'failed',
      needs_attention: true,
    })
    .where('id', '=', payout.id)
    .execute();
  await trx
    .updateTable('merchant_earnings')
    .set({ status: 'eligible', payout_id: null })
    .where('payout_id', '=', payout.id)
    .where('status', '=', 'in_payout')
    .execute();
  await post(
    trx,
    {
      kind: 'payout_failed',
      sourceType: 'payout',
      sourceId: payout.id,
      businessId: payout.business_id,
      occurredAt: now,
    },
    postings.payoutFailed(payout.business_id, payout.amount_fils),
  );
  await outbox('payout.failed');
  return { result: 'payout_failed' };
}
