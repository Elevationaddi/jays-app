import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PayoutListQuery, PayoutRunResult, PayoutView } from '@jays/contracts';
import { netOf, payoutAmount, postings } from '@jays/domain';
import type { Db } from '@jays/db';
import { sql } from 'kysely';
import { writeAudit } from '../common/audit.js';
import { CLOCK, type Clock } from '../common/clock.js';
import { afterCursor, cursorTs, decodeCursor, toPage } from '../common/pagination.js';
import type { RequestMeta } from '../common/request-context.js';
import { DB } from '../common/tokens.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from '../payments/provider.js';
import { payableBalance, post, setting } from './ledger.js';
import { businessName, type Localized, payoutQuery, payoutView } from './views.js';

type Skip = PayoutRunResult['skipped'][number]['reason'];

/**
 * Payout runs (docs/05-workflows.md, payouts; ADR-0015). Eligible earnings without an open
 * dispute or a pending refund are paid to businesses that are not on hold or suspended. The
 * amount is the eligible net capped by what the ledger says the business is owed, so a negative
 * carry from a chargeback or a refund after payout is recovered first. Each business is locked
 * while its payout is created, so two runs cannot pay the same earnings twice.
 */
@Injectable()
export class PayoutsService {
  private readonly log = new Logger(PayoutsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  async list(query: PayoutListQuery, businessId?: string) {
    const key = decodeCursor(query.cursor);
    let q = payoutQuery(this.db).select(cursorTs('p.created_at').as('cursor_ts'));
    const scope = businessId ?? query.businessId;
    if (scope) q = q.where('p.business_id', '=', scope);
    if (query.status) q = q.where('p.status', '=', query.status);
    if (key) q = q.where(afterCursor('p.created_at', 'p.id', key, 'desc'));
    const rows = await q
      .orderBy('p.created_at', 'desc')
      .orderBy('p.id', 'desc')
      .limit(query.limit + 1)
      .execute();
    return toPage(rows, query.limit, payoutView);
  }

  async run(adminId: string | null, meta?: RequestMeta): Promise<PayoutRunResult> {
    const now = this.clock.now();
    const windowDays = await setting(this.db, 'payout_dispute_window_days', now);
    const minimum = await setting(this.db, 'payout_minimum_fils', now);
    const { rows } = await sql<{ n: number }>`
      SELECT mark_earnings_eligible(${now}, ${windowDays}) AS n`.execute(this.db);
    const madeEligible = Number(rows[0]?.n ?? 0);

    const businesses = await this.db
      .selectFrom('merchant_earnings as e')
      .innerJoin('businesses as b', 'b.id', 'e.business_id')
      .leftJoin('storefronts as sf', 'sf.business_id', 'b.id')
      .select(['e.business_id', 'b.display_name', 'sf.live_name'])
      .where('e.status', '=', 'eligible')
      .groupBy(['e.business_id', 'b.display_name', 'sf.live_name'])
      .orderBy('e.business_id')
      .execute();

    const payouts: PayoutView[] = [];
    const skipped: PayoutRunResult['skipped'] = [];
    for (const b of businesses) {
      const name = businessName(b.live_name as Localized | null, b.display_name as Localized);
      const outcome = await this.payBusiness(b.business_id, minimum, adminId, now, meta);
      if ('skip' in outcome) {
        skipped.push({ business: { id: b.business_id, name }, reason: outcome.skip });
        continue;
      }
      const sent = await this.send(outcome.payoutId, b.business_id, outcome.amount);
      if (sent) payouts.push(sent);
    }
    return { madeEligible, payouts, skipped };
  }

  private async payBusiness(
    businessId: string,
    minimum: number,
    adminId: string | null,
    now: Date,
    meta?: RequestMeta,
  ): Promise<{ payoutId: string; amount: number } | { skip: Skip }> {
    return this.db.transaction().execute(async (trx) => {
      const business = await trx
        .selectFrom('businesses')
        .select(['id', 'status', 'psp_account_id', 'psp_account_provider', 'psp_payouts_enabled'])
        .where('id', '=', businessId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (business.status === 'suspended') return { skip: 'suspended' as const };
      // A real provider pays only an onboarded connected account (ADR-0030). The earnings stay
      // eligible, so the next run pays them once the account is ready.
      if (
        this.provider.requiresPayoutAccount &&
        (!business.psp_account_id ||
          business.psp_account_provider !== this.provider.name ||
          !business.psp_payouts_enabled)
      ) {
        return { skip: 'no_payout_account' as const };
      }
      const hold = await trx
        .selectFrom('payout_holds')
        .select('id')
        .where('business_id', '=', businessId)
        .where('released_at', 'is', null)
        .executeTakeFirst();
      if (hold) return { skip: 'on_hold' as const };

      const earnings = await trx
        .selectFrom('merchant_earnings as e')
        .select([
          'e.id',
          'e.gross_fils',
          'e.commission_fils',
          'e.refunded_fils',
          'e.commission_refunded_fils',
          'e.commission_vat_fils',
          'e.commission_vat_refunded_fils',
          (eb) =>
            eb
              .exists(
                eb
                  .selectFrom('refunds as r')
                  .select('r.id')
                  .whereRef('r.payment_id', '=', 'e.payment_id')
                  .where('r.status', '=', 'pending')
                  .where((w) =>
                    w.or([
                      w('e.booking_id', 'is not', null),
                      w('r.merchant_order_id', '=', w.ref('e.merchant_order_id')),
                    ]),
                  ),
              )
              .as('refund_pending'),
        ])
        .where('e.business_id', '=', businessId)
        .where('e.status', '=', 'eligible')
        .where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom('disputes as d')
                .select('d.id')
                .whereRef('d.earning_id', '=', 'e.id')
                .where('d.status', '=', 'open'),
            ),
          ),
        )
        .orderBy('e.id')
        .forUpdate()
        .execute();
      const payable = earnings.filter((e) => !e.refund_pending);
      if (payable.length === 0) {
        return {
          skip: earnings.length > 0 ? ('pending_refund' as const) : ('nothing_owed' as const),
        };
      }
      const eligibleNet = payable.reduce(
        (total, e) =>
          total +
          netOf({
            grossFils: e.gross_fils,
            commissionFils: e.commission_fils,
            refundedFils: e.refunded_fils,
            commissionRefundedFils: e.commission_refunded_fils,
            commissionVatFils: e.commission_vat_fils,
            commissionVatRefundedFils: e.commission_vat_refunded_fils,
          }),
        0,
      );
      const balance = await payableBalance(trx, businessId);
      const amount = payoutAmount({
        eligibleNetFils: eligibleNet,
        payableBalanceFils: balance,
        minimumFils: minimum,
      });
      if (amount === null) {
        return {
          skip:
            Math.min(eligibleNet, balance) <= 0
              ? ('nothing_owed' as const)
              : ('below_minimum' as const),
        };
      }
      const payout = await trx
        .insertInto('payouts')
        .values({
          business_id: businessId,
          amount_fils: amount,
          provider: this.provider.name,
          created_by: adminId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .updateTable('merchant_earnings')
        .set({ status: 'in_payout', payout_id: payout.id })
        .where(
          'id',
          'in',
          payable.map((e) => e.id),
        )
        .execute();
      await post(
        trx,
        {
          kind: 'payout_initiated',
          sourceType: 'payout',
          sourceId: payout.id,
          businessId,
          occurredAt: now,
        },
        postings.payoutInitiated(businessId, amount),
      );
      await writeAudit(trx, {
        actorType: adminId ? 'admin' : 'system',
        actorId: adminId,
        action: 'payout.created',
        targetType: 'payout',
        targetId: payout.id,
        businessId,
        diff: { amountFils: amount, earnings: payable.length },
        requestId: meta?.requestId ?? null,
      });
      return { payoutId: payout.id, amount };
    });
  }

  /** Asks the provider to pay, outside the transaction. A refusal fails the payout visibly. */
  private async send(payoutId: string, businessId: string, amount: number) {
    try {
      const account = await this.db
        .selectFrom('businesses')
        .select(['psp_account_id', 'psp_account_provider'])
        .where('id', '=', businessId)
        .executeTakeFirstOrThrow();
      const { payoutId: ref } = await this.provider.createPayout({
        reference: payoutId,
        businessId,
        destinationAccount:
          account.psp_account_provider === this.provider.name ? account.psp_account_id : null,
        amountFils: amount,
        currency: 'AED',
        idempotencyKey: `payout-${payoutId}`,
      });
      await this.db
        .updateTable('payouts')
        .set({ provider_ref: ref })
        .where('id', '=', payoutId)
        .where('provider_ref', 'is', null)
        .execute();
    } catch (error) {
      this.log.error({ err: error, payoutId }, 'payout request failed');
      const now = this.clock.now();
      await this.db.transaction().execute(async (trx) => {
        const p = await trx
          .selectFrom('payouts')
          .select(['status'])
          .where('id', '=', payoutId)
          .forUpdate()
          .executeTakeFirstOrThrow();
        if (p.status !== 'pending') return;
        await trx
          .updateTable('payouts')
          .set({
            status: 'failed',
            failed_at: now,
            failure_code: 'provider_refused',
            needs_attention: true,
          })
          .where('id', '=', payoutId)
          .execute();
        await trx
          .updateTable('merchant_earnings')
          .set({ status: 'eligible', payout_id: null })
          .where('payout_id', '=', payoutId)
          .execute();
        await post(
          trx,
          {
            kind: 'payout_failed',
            sourceType: 'payout',
            sourceId: payoutId,
            businessId,
            occurredAt: now,
          },
          postings.payoutFailed(businessId, amount),
        );
      });
    }
    const row = await payoutQuery(this.db).where('p.id', '=', payoutId).executeTakeFirst();
    return row ? payoutView(row) : null;
  }
}
