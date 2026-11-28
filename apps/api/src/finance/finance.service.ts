import { Inject, Injectable } from '@nestjs/common';
import type {
  EarningListQuery,
  FinanceSummary,
  LedgerLineView,
  LedgerListQuery,
} from '@jays/contracts';
import type { Db } from '@jays/db';
import { sql } from 'kysely';
import { CLOCK, type Clock } from '../common/clock.js';
import { afterCursor, cursorTs, decodeCursor, toPage } from '../common/pagination.js';
import { DB } from '../common/tokens.js';
import { setting } from './ledger.js';
import {
  EARNING_COLUMNS,
  earningView,
  type EarningRow,
  netSql,
  openDisputeExists,
} from './views.js';

/**
 * A business's read-only finance view (docs/03-business.md, /business/finance): balances from
 * the ledger, earnings with their payout status, ledger lines and payouts. Scoped to the
 * caller's business by BusinessAccessGuard; the `finance.view` capability is owner and finance.
 */
@Injectable()
export class FinanceService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async summary(businessId: string): Promise<FinanceSummary> {
    const accounts = await this.db
      .selectFrom('ledger_entries')
      .select(['account', sql<string>`sum(credit_fils - debit_fils)`.as('balance')])
      .where('business_id', '=', businessId)
      .groupBy('account')
      .execute();
    const balance = (a: string) => Number(accounts.find((r) => r.account === a)?.balance ?? 0);
    const byStatus = await this.db
      .selectFrom('merchant_earnings as e')
      .select([
        'e.status',
        netSql.as('net'),
        sql<string>`coalesce(sum(e.commission_fils - e.commission_refunded_fils), 0)`.as(
          'commission',
        ),
        sql<string>`coalesce(sum(e.refunded_fils), 0)`.as('refunded'),
      ])
      .where('e.business_id', '=', businessId)
      .groupBy('e.status')
      .execute();
    const net = (s: string) => Number(byStatus.find((r) => r.status === s)?.net ?? 0);
    const paid = await this.db
      .selectFrom('payouts')
      .select(sql<string>`coalesce(sum(amount_fils), 0)`.as('total'))
      .where('business_id', '=', businessId)
      .where('status', '=', 'paid')
      .executeTakeFirstOrThrow();
    const hold = await this.db
      .selectFrom('payout_holds')
      .select('reason')
      .where('business_id', '=', businessId)
      .where('released_at', 'is', null)
      .executeTakeFirst();
    const disputes = await this.db
      .selectFrom('disputes')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('business_id', '=', businessId)
      .where('status', '=', 'open')
      .executeTakeFirstOrThrow();
    return {
      currency: 'AED',
      payableBalanceFils: balance('merchant_payable'),
      inTransitFils: balance('payouts_in_transit'),
      pendingFils: net('pending'),
      eligibleFils: net('eligible'),
      paidOutFils: Number(paid.total),
      commissionFils: byStatus.reduce((t, r) => t + Number(r.commission), 0),
      refundedFils: byStatus.reduce((t, r) => t + Number(r.refunded), 0),
      onHold: !!hold,
      // The hold reason is internal to the platform; the business sees that payouts are held.
      holdReason: null,
      disputeWindowDays: await setting(this.db, 'payout_dispute_window_days', this.clock.now()),
      openDisputes: Number(disputes.n),
    };
  }

  async earnings(businessId: string, query: EarningListQuery) {
    const key = decodeCursor(query.cursor);
    let q = this.db
      .selectFrom('merchant_earnings as e')
      .leftJoin('merchant_orders as mo', 'mo.id', 'e.merchant_order_id')
      .select((eb) => [
        ...EARNING_COLUMNS,
        openDisputeExists(eb).as('disputed'),
        cursorTs('e.created_at').as('cursor_ts'),
      ])
      .where('e.business_id', '=', businessId);
    if (query.status) q = q.where('e.status', '=', query.status);
    if (key) q = q.where(afterCursor('e.created_at', 'e.id', key, 'desc'));
    const rows = await q
      .orderBy('e.created_at', 'desc')
      .orderBy('e.id', 'desc')
      .limit(query.limit + 1)
      .execute();
    return toPage(rows, query.limit, (r) => earningView(r as unknown as EarningRow));
  }

  async ledger(businessId: string, query: LedgerListQuery) {
    const key = decodeCursor(query.cursor);
    let q = this.db
      .selectFrom('ledger_entries as l')
      .innerJoin('ledger_transactions as t', 't.id', 'l.transaction_id')
      .select([
        'l.id',
        'l.transaction_id',
        't.kind',
        't.source_type',
        't.source_id',
        'l.account',
        'l.debit_fils',
        'l.credit_fils',
        't.occurred_at',
        cursorTs('l.created_at').as('cursor_ts'),
      ])
      .where('l.business_id', '=', businessId);
    if (key) q = q.where(afterCursor('l.created_at', 'l.id', key, 'desc'));
    const rows = await q
      .orderBy('l.created_at', 'desc')
      .orderBy('l.id', 'desc')
      .limit(query.limit + 1)
      .execute();
    return toPage(rows, query.limit, (r): LedgerLineView => ({
      id: r.id,
      transactionId: r.transaction_id,
      kind: r.kind,
      sourceType: r.source_type,
      sourceId: r.source_id,
      account: r.account,
      debitFils: r.debit_fils,
      creditFils: r.credit_fils,
      occurredAt: r.occurred_at.toISOString(),
    }));
  }
}
