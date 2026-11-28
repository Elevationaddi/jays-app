import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  AdminPilotPromotion,
  BusinessPromotion,
  CreatePilotPromotionRequest,
  PilotDashboard,
  PilotPromotion,
} from '@jays/contracts';
import type { Db } from '@jays/db';
import {
  type EmirateCode,
  PILOT,
  PILOT_NOTICE_DAYS,
  promotionDaysLeft,
  promotionEndsAt,
  promotionState,
} from '@jays/domain';
import { sql } from 'kysely';
import { writeAudit } from '../common/audit.js';
import { CLOCK, type Clock } from '../common/clock.js';
import { ApiError } from '../common/error.filter.js';
import type { RequestMeta } from '../common/request-context.js';
import { DB } from '../common/tokens.js';
import { feeRules } from './ledger.js';
import { adminNames, businessName, type Localized } from './views.js';

const DAY_MS = 86_400_000;

interface Row {
  id: string;
  starts_at: Date;
  ends_at: Date;
  cancelled_at: Date | null;
}

/**
 * The pilot promotion (ADR-0025, ADR-0034): 0% platform commission for an approved pilot
 * merchant's first 30 days. A finance admin records each business with the founder's approval
 * reference; the commission engine applies it at capture time. Nothing here starts the pilot:
 * recording a promotion is the founder's per-business approval, made by a person.
 */
@Injectable()
export class PilotService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private view(r: Row, now: Date): PilotPromotion {
    const window = { startsAt: r.starts_at, endsAt: r.ends_at, cancelledAt: r.cancelled_at };
    return {
      id: r.id,
      startsAt: r.starts_at.toISOString(),
      endsAt: r.ends_at.toISOString(),
      cancelledAt: r.cancelled_at?.toISOString() ?? null,
      state: promotionState(window, now),
      daysLeft: promotionDaysLeft(window, now),
    };
  }

  async create(adminId: string, input: CreatePilotPromotionRequest, meta: RequestMeta) {
    const now = this.clock.now();
    const startsAt = input.startsAt ? new Date(input.startsAt) : now;
    // Earlier sales keep the rate in force when they were captured (a minute of clock skew).
    if (startsAt.getTime() < now.getTime() - 60_000) {
      throw new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'EFFECTIVE_IN_PAST',
        'A promotion can start now or later, not in the past.',
        { startsAt: ['must not be in the past'] },
      );
    }
    const id = await this.db.transaction().execute(async (trx) => {
      const business = await trx
        .selectFrom('businesses')
        .select(['id', 'status'])
        .where('id', '=', input.businessId)
        .forUpdate()
        .executeTakeFirst();
      if (!business) {
        throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'The business was not found.');
      }
      if (business.status !== 'approved') {
        throw new ApiError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'BUSINESS_NOT_APPROVED',
          'Only an approved business can join the pilot.',
        );
      }
      const row = await trx
        .insertInto('pilot_promotions')
        .values({
          business_id: input.businessId,
          starts_at: startsAt,
          ends_at: promotionEndsAt(startsAt),
          founder_approval: input.founderApproval,
          created_by: adminId,
        })
        .onConflict((oc) => oc.column('business_id').doNothing())
        .returning('id')
        .executeTakeFirst();
      if (!row) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'PROMOTION_EXISTS',
          'This business already has its pilot promotion. It is offered once.',
        );
      }
      await writeAudit(trx, {
        actorType: 'admin',
        actorId: adminId,
        action: 'pilot.promotion_created',
        targetType: 'pilot_promotion',
        targetId: row.id,
        businessId: input.businessId,
        reason: input.founderApproval,
        diff: { startsAt, endsAt: promotionEndsAt(startsAt), commissionBps: 0 },
        requestId: meta.requestId,
      });
      return row.id;
    });
    return (await this.dashboard()).promotions.find((p) => p.id === id);
  }

  async cancel(adminId: string, id: string, reason: string, meta: RequestMeta) {
    const now = this.clock.now();
    await this.db.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom('pilot_promotions')
        .select(['id', 'business_id', 'starts_at', 'ends_at', 'cancelled_at'])
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!row) {
        throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'The promotion was not found.');
      }
      if (row.cancelled_at || row.ends_at <= now) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'INVALID_TRANSITION',
          'This promotion has already ended.',
        );
      }
      await trx
        .updateTable('pilot_promotions')
        .set({ cancelled_at: now, cancelled_by: adminId, cancel_reason: reason })
        .where('id', '=', id)
        .execute();
      await writeAudit(trx, {
        actorType: 'admin',
        actorId: adminId,
        action: 'pilot.promotion_cancelled',
        targetType: 'pilot_promotion',
        targetId: id,
        businessId: row.business_id,
        reason,
        diff: { cancelledAt: now },
        requestId: meta.requestId,
      });
    });
    return (await this.dashboard()).promotions.find((p) => p.id === id);
  }

  async dashboard(): Promise<PilotDashboard> {
    const now = this.clock.now();
    const rows = await this.db
      .selectFrom('pilot_promotions as p')
      .innerJoin('businesses as b', 'b.id', 'p.business_id')
      .leftJoin('storefronts as sf', 'sf.business_id', 'b.id')
      .select([
        'p.id',
        'p.business_id',
        'p.starts_at',
        'p.ends_at',
        'p.cancelled_at',
        'p.cancel_reason',
        'p.founder_approval',
        'p.created_by',
        'b.display_name',
        'sf.live_name',
        'b.address_emirate_code',
        sql<string[]>`coalesce((SELECT array_agg(m.mode ORDER BY m.mode) FROM business_modes m
          WHERE m.business_id = b.id AND m.status = 'active'), '{}')`.as('modes'),
        sql<string>`(SELECT count(*) FROM merchant_earnings e WHERE e.pilot_promotion_id = p.id)`.as(
          'sales',
        ),
        sql<string>`(SELECT coalesce(sum(e.gross_fils), 0) FROM merchant_earnings e
          WHERE e.pilot_promotion_id = p.id)`.as('gross'),
        sql<string>`(SELECT coalesce(sum(e.commission_base_fils), 0) FROM merchant_earnings e
          WHERE e.pilot_promotion_id = p.id)`.as('base'),
      ])
      .orderBy('p.starts_at', 'desc')
      .execute();
    const names = await adminNames(
      this.db,
      rows.map((r) => r.created_by),
    );
    const promotions: AdminPilotPromotion[] = rows.map((r) => ({
      ...this.view(r, now),
      business: {
        id: r.business_id,
        name: businessName(r.live_name as Localized | null, r.display_name as Localized),
        emirate: (r.address_emirate_code as EmirateCode | null) ?? null,
        modes: r.modes.filter((m): m is 'shop' | 'services' => m === 'shop' || m === 'services'),
      },
      founderApproval: r.founder_approval,
      createdBy: names.get(r.created_by) ?? null,
      cancelReason: r.cancel_reason,
      sales: {
        count: Number(r.sales),
        grossFils: Number(r.gross),
        commissionBaseFils: Number(r.base),
      },
    }));
    const live = promotions.filter((p) => p.state === 'scheduled' || p.state === 'active');
    return {
      emirate: PILOT.emirate,
      durationDays: PILOT.durationDays,
      targets: { ...PILOT.targets },
      enrolled: {
        shop: live.filter((p) => p.business.modes.includes('shop')).length,
        services: live.filter((p) => p.business.modes.includes('services')).length,
      },
      launch: 'founder_approval_required',
      promotions,
      checkedAt: now.toISOString(),
    };
  }

  /** The business portal's view: its promotion, and the standard rate that follows it. */
  async forBusiness(businessId: string): Promise<BusinessPromotion> {
    const now = this.clock.now();
    const row = await this.db
      .selectFrom('pilot_promotions')
      .select(['id', 'starts_at', 'ends_at', 'cancelled_at'])
      .where('business_id', '=', businessId)
      .executeTakeFirst();
    const after = row ? new Date(Math.max(row.ends_at.getTime(), now.getTime())) : now;
    const [shop, services] = await Promise.all([
      feeRules(this.db, 'shop', businessId, after),
      feeRules(this.db, 'services', businessId, after),
    ]);
    return {
      promotion: row ? this.view(row, now) : null,
      standardBps: { shop: shop?.commissionBps ?? null, services: services?.commissionBps ?? null },
    };
  }

  /**
   * Queues the "commission changes soon" notices, 7 days and 1 day before the end (ADR-0025).
   * Each notice is claimed on its row first, so overlapping cron runs send it once.
   */
  async queueEndingNotices(now = this.clock.now()): Promise<number> {
    let queued = 0;
    for (const days of PILOT_NOTICE_DAYS) {
      const column = days === 7 ? 'notified_7d_at' : 'notified_1d_at';
      const claimed = await this.db.transaction().execute(async (trx) => {
        const rows = await trx
          .updateTable('pilot_promotions')
          .set({ [column]: now })
          .where(column, 'is', null)
          .where('cancelled_at', 'is', null)
          .where('starts_at', '<=', now)
          .where('ends_at', '>', now)
          .where('ends_at', '<=', new Date(now.getTime() + days * DAY_MS))
          // Within the last day only the last-day notice goes out.
          .$if(days === 7, (qb) => qb.where('ends_at', '>', new Date(now.getTime() + DAY_MS)))
          .returning(['id', 'business_id', 'ends_at'])
          .execute();
        for (const r of rows) {
          await trx
            .insertInto('outbox')
            .values({
              event_type: 'pilot.promotion_ending',
              payload: JSON.stringify({
                promotionId: r.id,
                businessId: r.business_id,
                endsAt: r.ends_at.toISOString(),
                days,
              }),
              available_at: now,
            })
            .execute();
        }
        return rows.length;
      });
      queued += claimed;
    }
    return queued;
  }
}
