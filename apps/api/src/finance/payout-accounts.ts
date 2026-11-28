import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { PayoutAccountView } from '@jays/contracts';
import type { Db, PaymentProviderName } from '@jays/db';
import { writeAudit } from '../common/audit.js';
import { CLOCK, type Clock } from '../common/clock.js';
import { ApiError } from '../common/error.filter.js';
import type { RequestMeta } from '../common/request-context.js';
import { DB } from '../common/tokens.js';
import { API_ENV, type ApiEnv } from '../config.js';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
  type PayoutAccountStatus,
  type ProviderEvent,
} from '../payments/provider.js';
import type { Trx } from './ledger.js';

interface AccountRow {
  psp_account_id: string | null;
  psp_account_provider: PaymentProviderName | null;
  psp_details_submitted: boolean;
  psp_payouts_enabled: boolean;
  psp_account_updated_at: Date | null;
}

const ACCOUNT_COLUMNS = [
  'psp_account_id',
  'psp_account_provider',
  'psp_details_submitted',
  'psp_payouts_enabled',
  'psp_account_updated_at',
] as const;

/**
 * Applies a verified `account.updated` webhook: records what the provider reports about a
 * connected account. Only the flags change; the account id itself is never moved by a webhook.
 */
export async function applyAccountEvent(
  trx: Trx,
  provider: PaymentProviderName,
  event: ProviderEvent,
  now: Date,
): Promise<{ result: string }> {
  const account = event.account;
  if (!account) return { result: 'unknown_account' };
  const updated = await trx
    .updateTable('businesses')
    .set({
      psp_details_submitted: account.detailsSubmitted,
      psp_payouts_enabled: account.payoutsEnabled,
      psp_account_updated_at: now,
    })
    .where('psp_account_id', '=', account.accountId)
    .where('psp_account_provider', '=', provider)
    .returning(['id'])
    .executeTakeFirst();
  if (!updated) return { result: 'unknown_account' };
  await writeAudit(trx, {
    actorType: 'system',
    actorId: null,
    action: 'payout_account.updated',
    targetType: 'business',
    targetId: updated.id,
    businessId: updated.id,
    diff: { detailsSubmitted: account.detailsSubmitted, payoutsEnabled: account.payoutsEnabled },
  });
  return { result: account.payoutsEnabled ? 'account_enabled' : 'account_pending' };
}

/**
 * Connected payout accounts (ADR-0030). The owner opens the provider's hosted onboarding, where
 * the provider collects identity and bank details. JAYS never sees or stores them.
 */
@Injectable()
export class PayoutAccountsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  async status(businessId: string): Promise<PayoutAccountView> {
    const row = (await this.db
      .selectFrom('businesses')
      .select(ACCOUNT_COLUMNS)
      .where('id', '=', businessId)
      .executeTakeFirstOrThrow()) as AccountRow;
    return this.view(row);
  }

  /** Creates the connected account when needed and returns a hosted onboarding link. */
  async onboardingLink(userId: string, businessId: string, meta: RequestMeta) {
    const business = await this.db
      .selectFrom('businesses')
      .select(['status', ...ACCOUNT_COLUMNS])
      .where('id', '=', businessId)
      .executeTakeFirstOrThrow();
    if (business.status !== 'approved') {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'BUSINESS_NOT_APPROVED',
        'Payouts can be set up once the business is approved.',
      );
    }
    let accountId =
      business.psp_account_provider === this.provider.name ? business.psp_account_id : null;
    if (!accountId) {
      const created = await this.call(() =>
        this.provider.createPayoutAccount({
          businessId,
          idempotencyKey: `payout-account-${this.provider.name}-${businessId}`,
        }),
      );
      accountId = await this.store(userId, businessId, created, meta);
    }
    const base = this.env.BUSINESS_WEB_URL.replace(/\/$/, '');
    return this.call(() =>
      this.provider.createOnboardingLink({
        accountId: accountId as string,
        returnUrl: `${base}/business/${businessId}/finance?payoutAccount=return`,
        refreshUrl: `${base}/business/${businessId}/finance?payoutAccount=refresh`,
      }),
    );
  }

  /** Reads the account's status from the provider, for when the owner returns from onboarding. */
  async refresh(businessId: string): Promise<PayoutAccountView> {
    const row = (await this.db
      .selectFrom('businesses')
      .select(ACCOUNT_COLUMNS)
      .where('id', '=', businessId)
      .executeTakeFirstOrThrow()) as AccountRow;
    if (!row.psp_account_id || row.psp_account_provider !== this.provider.name) {
      return this.view(row);
    }
    const accountId = row.psp_account_id;
    const status = await this.call(() => this.provider.getPayoutAccount(accountId));
    const updated = (await this.db
      .updateTable('businesses')
      .set({
        psp_details_submitted: status.detailsSubmitted,
        psp_payouts_enabled: status.payoutsEnabled,
        psp_account_updated_at: this.clock.now(),
      })
      .where('id', '=', businessId)
      .where('psp_account_id', '=', accountId)
      .returning(ACCOUNT_COLUMNS)
      .executeTakeFirstOrThrow()) as AccountRow;
    return this.view(updated);
  }

  private async store(
    userId: string,
    businessId: string,
    account: PayoutAccountStatus,
    meta: RequestMeta,
  ): Promise<string> {
    return this.db.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom('businesses')
        .select(['psp_account_id', 'psp_account_provider'])
        .where('id', '=', businessId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      // A concurrent request stored the same account (the creation call is idempotent).
      if (row.psp_account_id && row.psp_account_provider === this.provider.name) {
        return row.psp_account_id;
      }
      await trx
        .updateTable('businesses')
        .set({
          psp_account_id: account.accountId,
          psp_account_provider: this.provider.name,
          psp_details_submitted: account.detailsSubmitted,
          psp_payouts_enabled: account.payoutsEnabled,
          psp_account_updated_at: this.clock.now(),
        })
        .where('id', '=', businessId)
        .execute();
      await writeAudit(trx, {
        actorType: 'user',
        actorId: userId,
        action: 'payout_account.created',
        targetType: 'business',
        targetId: businessId,
        businessId,
        diff: { provider: this.provider.name },
        requestId: meta.requestId,
      });
      return account.accountId;
    });
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch {
      throw new ApiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'PAYMENT_PROVIDER_UNAVAILABLE',
        'The payment provider could not be reached. Try again shortly.',
      );
    }
  }

  private view(row: AccountRow): PayoutAccountView {
    const current = row.psp_account_provider === this.provider.name ? row : null;
    return {
      provider: this.provider.name,
      required: this.provider.requiresPayoutAccount,
      status: !current?.psp_account_id
        ? 'none'
        : current.psp_payouts_enabled
          ? 'enabled'
          : 'pending',
      detailsSubmitted: current?.psp_details_submitted ?? false,
      payoutsEnabled: current?.psp_payouts_enabled ?? false,
      updatedAt: current?.psp_account_updated_at?.toISOString() ?? null,
    };
  }
}
