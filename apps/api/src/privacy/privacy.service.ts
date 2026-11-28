import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  AccountDeletion,
  ConsentRecord,
  DataExport,
  Privacy,
  UnsubscribeResult,
  UpdatePrivacyRequest,
} from '@jays/contracts';
import type { ConsentPurpose, ConsentSource, Db } from '@jays/db';
import { sql, type Transaction } from 'kysely';
import type { Database } from '@jays/db';
import { verifyPassword } from '../auth/crypto.js';
import { ACCOUNT_DELETION_GRACE_DAYS, LIMITS, MARKETING_POLICY_VERSION } from '../auth/policy.js';
import { toMe } from '../auth/users.js';
import { writeAudit } from '../common/audit.js';
import { CLOCK, type Clock } from '../common/clock.js';
import { enforce, RATE_LIMITER, type RateLimiter } from '../common/rate-limit.js';
import { ApiError } from '../common/error.filter.js';
import { afterCursor, cursorTs, decodeCursor, toPage } from '../common/pagination.js';
import type { RequestMeta } from '../common/request-context.js';
import { DB } from '../common/tokens.js';
import { API_ENV, type ApiEnv } from '../config.js';
import {
  signUnsubscribe,
  unsubscribeKey,
  verifyUnsubscribe,
  type UnsubscribeChannel,
} from './unsubscribe-token.js';

type Channel = 'email' | 'sms' | 'push';
const CHANNELS: readonly Channel[] = ['email', 'sms', 'push'];
const DAY_MS = 24 * 3600 * 1000;
type Trx = Transaction<Database>;

const marketingCol = (c: Channel) => `marketing_${c}` as const;
const notifyCol = (c: Channel) => `notify_${c}` as const;

type ConsentRow = {
  id: string;
  purpose: ConsentPurpose;
  granted: boolean;
  source: ConsentSource;
  locale: 'en' | 'ar';
  policy_version: string;
  created_at: Date;
};
const toConsent = (r: ConsentRow): ConsentRecord => ({
  id: r.id,
  purpose: r.purpose,
  granted: r.granted,
  source: r.source,
  locale: r.locale,
  policyVersion: r.policy_version,
  createdAt: r.created_at.toISOString(),
});

type DeletionRow = {
  id: string;
  status: 'pending' | 'canceled' | 'completed';
  requested_at: Date;
  scheduled_for: Date;
  postponed_reason: string | null;
};
const toDeletion = (r: DeletionRow): AccountDeletion => ({
  id: r.id,
  status: r.status,
  requestedAt: r.requested_at.toISOString(),
  scheduledFor: r.scheduled_for.toISOString(),
  postponedReason: (r.postponed_reason as AccountDeletion['postponedReason']) ?? null,
});

/**
 * Account and privacy (ADR-0018 D14, D15; ADR-0019): granular marketing consent with an
 * append-only history, transactional notification preferences, one-click unsubscribe, a data
 * export and account deletion with a grace period. Everything is scoped to the signed-in user.
 */
@Injectable()
export class PrivacyService {
  private readonly key: Buffer;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    @Inject(API_ENV) env: ApiEnv,
  ) {
    this.key = unsubscribeKey(env.OTP_SECRET);
  }

  async get(userId: string): Promise<Privacy> {
    const [user, deletion] = await Promise.all([
      this.db
        .selectFrom('users')
        .select([
          'marketing_email',
          'marketing_sms',
          'marketing_push',
          'notify_email',
          'notify_sms',
          'notify_push',
        ])
        .where('id', '=', userId)
        .executeTakeFirstOrThrow(),
      this.db
        .selectFrom('account_deletion_requests')
        .select(['id', 'status', 'requested_at', 'scheduled_for', 'postponed_reason'])
        .where('user_id', '=', userId)
        .where('status', '=', 'pending')
        .executeTakeFirst(),
    ]);
    return {
      marketing: {
        email: user.marketing_email,
        sms: user.marketing_sms,
        push: user.marketing_push,
      },
      notifications: { email: user.notify_email, sms: user.notify_sms, push: user.notify_push },
      marketingPolicyVersion: MARKETING_POLICY_VERSION,
      deletionGraceDays: ACCOUNT_DELETION_GRACE_DAYS,
      deletion: deletion ? toDeletion(deletion) : null,
    };
  }

  /**
   * Changes marketing consent and notification preferences. A marketing change that differs from
   * the current choice writes one consent record per channel; repeating the same choice records
   * nothing, so the history only holds real changes.
   */
  async update(userId: string, body: UpdatePrivacyRequest, meta: RequestMeta): Promise<Privacy> {
    await this.db.transaction().execute(async (trx) => {
      const user = await trx
        .selectFrom('users')
        .selectAll()
        .where('id', '=', userId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const locale = body.locale ?? user.locale;
      const marketingChanges = CHANNELS.filter(
        (c) => body.marketing?.[c] !== undefined && body.marketing[c] !== user[marketingCol(c)],
      ).map((c) => ({ channel: c, granted: body.marketing?.[c] === true }));
      const notifyChanges = CHANNELS.filter(
        (c) =>
          body.notifications?.[c] !== undefined && body.notifications[c] !== user[notifyCol(c)],
      );
      if (marketingChanges.length === 0 && notifyChanges.length === 0) return;
      await trx
        .updateTable('users')
        .set({
          ...Object.fromEntries(marketingChanges.map((m) => [marketingCol(m.channel), m.granted])),
          ...Object.fromEntries(
            notifyChanges.map((c) => [notifyCol(c), body.notifications?.[c] === true]),
          ),
        })
        .where('id', '=', userId)
        .execute();
      await this.recordConsent(trx, userId, marketingChanges, 'settings', locale, meta.requestId);
      await writeAudit(trx, {
        actorType: 'user',
        actorId: userId,
        action: 'user.preferences_changed',
        targetType: 'user',
        targetId: userId,
        diff: {
          marketing: Object.fromEntries(marketingChanges.map((m) => [m.channel, m.granted])),
          notifications: Object.fromEntries(
            notifyChanges.map((c) => [c, body.notifications?.[c] === true]),
          ),
        },
        requestId: meta.requestId,
      });
    });
    return this.get(userId);
  }

  async consentHistory(userId: string, query: { cursor?: string | undefined; limit: number }) {
    const cursor = decodeCursor(query.cursor);
    let q = this.db
      .selectFrom('consent_records')
      .select(['id', 'purpose', 'granted', 'source', 'locale', 'policy_version', 'created_at'])
      .select(cursorTs('created_at').as('cursor_ts'))
      .where('user_id', '=', userId);
    if (cursor) q = q.where(afterCursor('created_at', 'id', cursor, 'desc'));
    const rows = await q
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(query.limit + 1)
      .execute();
    return toPage(rows, query.limit, toConsent);
  }

  // Unsubscribe -----------------------------------------------------------------------------------

  /** A link for marketing messages to `userId` (used by the marketing sender when it exists). */
  unsubscribeToken(userId: string, channel: UnsubscribeChannel): string {
    return signUnsubscribe(this.key, userId, channel);
  }

  /**
   * One-click unsubscribe. `preview` only checks the link. Works without signing in; a deleted
   * account or an already withdrawn channel succeeds without writing anything.
   */
  async unsubscribe(
    token: string,
    preview: boolean,
    meta: RequestMeta,
  ): Promise<UnsubscribeResult> {
    await enforce(this.limiter, [[LIMITS.unsubscribePerIp, meta.ip]]);
    const parsed = verifyUnsubscribe(this.key, token);
    if (!parsed) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'INVALID_UNSUBSCRIBE_LINK',
        'This unsubscribe link is not valid.',
      );
    }
    if (preview) return { channel: parsed.channel, done: false };
    const channels: Channel[] = parsed.channel === 'all' ? [...CHANNELS] : [parsed.channel];
    await this.db.transaction().execute(async (trx) => {
      const user = await trx
        .selectFrom('users')
        .selectAll()
        .where('id', '=', parsed.userId)
        .forUpdate()
        .executeTakeFirst();
      if (!user || user.deleted_at) return;
      const changes = channels
        .filter((c) => user[marketingCol(c)])
        .map((c) => ({ channel: c, granted: false }));
      if (changes.length === 0) return;
      await trx
        .updateTable('users')
        .set(Object.fromEntries(changes.map((m) => [marketingCol(m.channel), false])))
        .where('id', '=', user.id)
        .execute();
      await this.recordConsent(
        trx,
        user.id,
        changes,
        'unsubscribe_link',
        user.locale,
        meta.requestId,
      );
      await writeAudit(trx, {
        actorType: 'user',
        actorId: user.id,
        action: 'user.unsubscribed',
        targetType: 'user',
        targetId: user.id,
        diff: { channels: changes.map((c) => c.channel) },
        requestId: meta.requestId,
      });
    });
    return { channel: parsed.channel, done: true };
  }

  // Deletion --------------------------------------------------------------------------------------

  /**
   * Schedules the account for anonymisation after the grace period. Needs the current password.
   * Refused while the person still has orders on the way, upcoming appointments, open returns or
   * an active business membership, because those need them reachable.
   */
  async requestDeletion(
    userId: string,
    body: { password: string; reason?: string | undefined },
    meta: RequestMeta,
  ): Promise<Privacy> {
    await enforce(this.limiter, [[LIMITS.deletionPerUser, userId]]);
    const user = await this.db
      .selectFrom('users')
      .select(['password_hash'])
      .where('id', '=', userId)
      .executeTakeFirstOrThrow();
    if (!(await verifyPassword(user.password_hash, body.password))) {
      throw new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'PASSWORD_INCORRECT',
        'The password is not correct.',
      );
    }
    const now = this.clock.now();
    await this.db.transaction().execute(async (trx) => {
      await trx.selectFrom('users').select('id').where('id', '=', userId).forUpdate().execute();
      const pending = await trx
        .selectFrom('account_deletion_requests')
        .select('id')
        .where('user_id', '=', userId)
        .where('status', '=', 'pending')
        .executeTakeFirst();
      if (pending) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'DELETION_PENDING',
          'Account deletion is already scheduled.',
        );
      }
      const { rows } = await sql<{ reason: string | null }>`
        SELECT account_open_activity(${userId}::uuid) AS reason`.execute(trx);
      const blocker = rows[0]?.reason ?? null;
      if (blocker) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'ACCOUNT_HAS_OPEN_ACTIVITY',
          'Finish or cancel open orders, appointments, returns and business memberships first.',
          { reason: [blocker] },
        );
      }
      const row = await trx
        .insertInto('account_deletion_requests')
        .values({
          user_id: userId,
          reason: body.reason ?? null,
          requested_at: now,
          scheduled_for: new Date(now.getTime() + ACCOUNT_DELETION_GRACE_DAYS * DAY_MS),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await writeAudit(trx, {
        actorType: 'user',
        actorId: userId,
        action: 'user.deletion_requested',
        targetType: 'account_deletion_request',
        targetId: row.id,
        requestId: meta.requestId,
      });
    });
    return this.get(userId);
  }

  async cancelDeletion(userId: string, meta: RequestMeta): Promise<Privacy> {
    const now = this.clock.now();
    const row = await this.db
      .updateTable('account_deletion_requests')
      .set({ status: 'canceled', canceled_at: now })
      .where('user_id', '=', userId)
      .where('status', '=', 'pending')
      .returning('id')
      .executeTakeFirst();
    if (!row) {
      throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'No deletion is scheduled.');
    }
    await writeAudit(this.db, {
      actorType: 'user',
      actorId: userId,
      action: 'user.deletion_canceled',
      targetType: 'account_deletion_request',
      targetId: row.id,
      requestId: meta.requestId,
    });
    return this.get(userId);
  }

  /** Runs the completion sweep now (the worker does this on a schedule). */
  async completeDueDeletions(limit = 50): Promise<number> {
    const { rows } = await sql<{ n: number }>`
      SELECT complete_account_deletions(${this.clock.now()}, ${limit}) AS n`.execute(this.db);
    return Number(rows[0]?.n ?? 0);
  }

  // Export ----------------------------------------------------------------------------------------

  /** The person's data as one JSON document (right of access and portability). */
  async export(userId: string): Promise<DataExport> {
    const user = await this.db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', userId)
      .executeTakeFirstOrThrow();
    const [me, privacy, consents, addresses, orders, bookings, reviews, tickets] =
      await Promise.all([
        toMe(this.db, user),
        this.get(userId),
        this.db
          .selectFrom('consent_records')
          .select(['id', 'purpose', 'granted', 'source', 'locale', 'policy_version', 'created_at'])
          .where('user_id', '=', userId)
          .orderBy('created_at')
          .orderBy('id')
          .execute(),
        this.db
          .selectFrom('addresses')
          .select([
            'id',
            'label',
            'emirate_code',
            'area',
            'street',
            'building',
            'unit',
            'directions',
            'is_default',
            'archived_at',
            'created_at',
          ])
          .where('user_id', '=', userId)
          .orderBy('created_at')
          .execute(),
        this.db
          .selectFrom('orders')
          .select(['id', 'status', 'total_fils', 'currency', 'created_at'])
          .where('user_id', '=', userId)
          .orderBy('created_at')
          .execute(),
        this.db
          .selectFrom('bookings')
          .select(['id', 'business_id', 'start_at', 'end_at', 'status', 'created_at'])
          .where('user_id', '=', userId)
          .orderBy('start_at')
          .execute(),
        this.db
          .selectFrom('reviews')
          .select(['id', 'target_type', 'rating', 'body', 'status', 'created_at'])
          .where('user_id', '=', userId)
          .orderBy('created_at')
          .execute(),
        this.db
          .selectFrom('support_tickets')
          .select(['id', 'type', 'subject', 'status', 'created_at'])
          .where('user_id', '=', userId)
          .orderBy('created_at')
          .execute(),
      ]);
    const iso = <T extends Record<string, unknown>>(rows: T[]) =>
      rows.map((r) =>
        Object.fromEntries(
          Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]),
        ),
      );
    return {
      generatedAt: this.clock.now().toISOString(),
      profile: {
        ...me,
        termsVersion: user.terms_version,
        termsAcceptedAt: user.terms_accepted_at.toISOString(),
      },
      privacy,
      consentHistory: consents.map(toConsent),
      addresses: iso(addresses),
      orders: iso(orders),
      bookings: iso(bookings),
      reviews: iso(reviews),
      tickets: iso(tickets),
    };
  }

  private async recordConsent(
    trx: Trx,
    userId: string,
    changes: { channel: Channel; granted: boolean }[],
    source: ConsentSource,
    locale: 'en' | 'ar',
    requestId: string | null,
  ) {
    if (changes.length === 0) return;
    await trx
      .insertInto('consent_records')
      .values(
        changes.map((m) => ({
          user_id: userId,
          purpose: `marketing_${m.channel}` as const,
          granted: m.granted,
          source,
          locale,
          policy_version: MARKETING_POLICY_VERSION,
          request_id: requestId,
        })),
      )
      .execute();
  }
}
