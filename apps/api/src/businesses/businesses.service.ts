import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { BusinessView, CreateBusinessRequest, Member } from '@jays/contracts';
import type { Db } from '@jays/db';
import { canAssignPermissions, type Mode } from '@jays/domain';
import { sql } from 'kysely';
import { writeAudit } from '../common/audit.js';
import { CLOCK, type Clock } from '../common/clock.js';
import { ApiError } from '../common/error.filter.js';
import {
  afterCursor,
  cursorTs,
  decodeCursor,
  type ListQuery,
  toPage,
} from '../common/pagination.js';
import { enforce, RATE_LIMITER, type RateLimiter } from '../common/rate-limit.js';
import type { RequestMeta } from '../common/request-context.js';
import { DB } from '../common/tokens.js';
import { maskContact } from '../auth/crypto.js';
import { LIMITS } from '../auth/policy.js';
import { normalizeIdentifier } from '../auth/users.js';
import type { BusinessContext } from './business-access.guard.js';
import { loadBusinessViews } from './business-view.js';

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found.');
const forbidden = (message: string) => new ApiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', message);

interface MemberRow {
  id: string;
  user_id: string;
  permissions: string[];
  status: string;
  created_at: Date;
  accepted_at: Date | null;
  display_name: string | null;
  email: string | null;
  phone: string | null;
}

function toMember(row: MemberRow): Member {
  return {
    id: row.id,
    userId: row.user_id,
    displayName: row.display_name,
    contact: maskContact(row.email ?? row.phone ?? ''),
    permissions: row.permissions as Member['permissions'],
    status: row.status as Member['status'],
    invitedAt: row.created_at.toISOString(),
    acceptedAt: row.accepted_at?.toISOString() ?? null,
  };
}

@Injectable()
export class BusinessesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
  ) {}

  /** Any verified user can start a business. They become its owner; it starts as a draft. */
  async create(
    userId: string,
    body: CreateBusinessRequest,
    meta: RequestMeta,
  ): Promise<BusinessView> {
    await enforce(this.limiter, [[LIMITS.createBusinessPerUser, userId]]);
    const now = this.clock.now();
    const businessId = await this.db.transaction().execute(async (trx) => {
      const business = await trx
        .insertInto('businesses')
        .values({ display_name: JSON.stringify(body.displayName), created_by: userId })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('memberships')
        .values({
          business_id: business.id,
          user_id: userId,
          permissions: ['owner'],
          status: 'active',
          accepted_at: now,
        })
        .execute();
      await trx
        .insertInto('business_modes')
        .values(
          body.modes.map((mode) => ({ business_id: business.id, mode, activated_by: userId })),
        )
        .execute();
      await writeAudit(trx, {
        actorType: 'user',
        actorId: userId,
        action: 'business.created',
        targetType: 'business',
        targetId: business.id,
        businessId: business.id,
        diff: { modes: body.modes },
        requestId: meta.requestId,
      });
      return business.id;
    });
    return this.view(businessId, ['owner']);
  }

  view(businessId: string, permissions: string[]): Promise<BusinessView> {
    return loadBusinessViews(this.db, [{ businessId, permissions }]).then((m) => {
      const view = m.get(businessId);
      if (!view) throw notFound();
      return view;
    });
  }

  /**
   * Starts onboarding for a mode. Activation never makes a mode public: it becomes `active` only
   * after admin approval (phase 2). Idempotent.
   */
  async activateMode(
    ctx: BusinessContext,
    userId: string,
    mode: Mode,
    meta: RequestMeta,
  ): Promise<BusinessView> {
    await this.db.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto('business_modes')
        .values({ business_id: ctx.businessId, mode, activated_by: userId })
        .onConflict((oc) => oc.columns(['business_id', 'mode']).doNothing())
        .returning('id')
        .executeTakeFirst();
      if (inserted) {
        await writeAudit(trx, {
          actorType: 'user',
          actorId: userId,
          action: 'business.mode_activated',
          targetType: 'business',
          targetId: ctx.businessId,
          businessId: ctx.businessId,
          diff: { mode, status: 'onboarding' },
          requestId: meta.requestId,
        });
      }
    });
    return this.view(ctx.businessId, ctx.permissions);
  }

  async listMembers(ctx: BusinessContext, query: ListQuery) {
    const cursor = decodeCursor(query.cursor);
    let q = this.db
      .selectFrom('memberships as m')
      .innerJoin('users as u', 'u.id', 'm.user_id')
      .select([
        'm.id',
        'm.user_id',
        'm.permissions',
        'm.status',
        'm.created_at',
        'm.accepted_at',
        'u.display_name',
        'u.email',
        'u.phone',
      ])
      .select(cursorTs('m.created_at').as('cursor_ts'))
      .where('m.business_id', '=', ctx.businessId)
      .where('m.status', 'in', ['invited', 'active']);
    if (cursor) q = q.where(afterCursor('m.created_at', 'm.id', cursor));
    const rows = await q
      .orderBy('m.created_at')
      .orderBy('m.id')
      .limit(query.limit + 1)
      .execute();
    return toPage(rows, query.limit, toMember);
  }

  /**
   * Invites an existing verified account. The invitee must accept before getting any access.
   * Delivery of the invitation message is queued in the outbox (sent by the worker in phase 6);
   * the invitation also shows on the invitee's business gateway.
   */
  async inviteMember(
    ctx: BusinessContext,
    actorId: string,
    identifier: string,
    permissions: string[],
    meta: RequestMeta,
  ): Promise<Member> {
    await enforce(this.limiter, [[LIMITS.inviteMemberPerUser, actorId]]);
    const check = canAssignPermissions(ctx.permissions, [], permissions);
    if (!check.allowed) throw forbidden(check.reason);
    const { kind, value } = normalizeIdentifier(identifier);
    const now = this.clock.now();
    const memberId = await this.db.transaction().execute(async (trx) => {
      await trx
        .selectFrom('businesses')
        .select('id')
        .where('id', '=', ctx.businessId)
        .forUpdate()
        .execute();
      const invitee = await trx
        .selectFrom('users')
        .select(['id', 'status'])
        .where(kind, '=', value)
        .where(kind === 'email' ? 'email_verified_at' : 'phone_verified_at', 'is not', null)
        .executeTakeFirst();
      if (!invitee || invitee.status !== 'active') {
        throw new ApiError(
          HttpStatus.NOT_FOUND,
          'USER_NOT_FOUND',
          'No verified account uses that email or phone. Ask them to sign up first.',
        );
      }
      const existing = await trx
        .selectFrom('memberships')
        .select(['id', 'status'])
        .where('business_id', '=', ctx.businessId)
        .where('user_id', '=', invitee.id)
        .executeTakeFirst();
      if (existing && existing.status !== 'removed') {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'ALREADY_MEMBER',
          'This person is already a member or has a pending invitation.',
        );
      }
      const row = existing
        ? await trx
            .updateTable('memberships')
            .set({
              permissions,
              status: 'invited',
              invited_by: actorId,
              accepted_at: null,
              removed_at: null,
            })
            .where('id', '=', existing.id)
            .returning('id')
            .executeTakeFirstOrThrow()
        : await trx
            .insertInto('memberships')
            .values({
              business_id: ctx.businessId,
              user_id: invitee.id,
              permissions,
              status: 'invited',
              invited_by: actorId,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
      await trx
        .insertInto('outbox')
        .values({
          event_type: 'business.member_invited',
          payload: JSON.stringify({
            membershipId: row.id,
            businessId: ctx.businessId,
            inviteeId: invitee.id,
          }),
          available_at: now,
        })
        .execute();
      await writeAudit(trx, {
        actorType: 'user',
        actorId,
        action: 'membership.invited',
        targetType: 'membership',
        targetId: row.id,
        businessId: ctx.businessId,
        diff: { permissions },
        requestId: meta.requestId,
      });
      return row.id;
    });
    return this.getMember(ctx.businessId, memberId);
  }

  async updateMember(
    ctx: BusinessContext,
    actorId: string,
    memberId: string,
    permissions: string[],
    meta: RequestMeta,
  ): Promise<Member> {
    await this.db.transaction().execute(async (trx) => {
      await trx
        .selectFrom('businesses')
        .select('id')
        .where('id', '=', ctx.businessId)
        .forUpdate()
        .execute();
      const target = await this.lockMember(trx, ctx.businessId, memberId);
      const check = canAssignPermissions(ctx.permissions, target.permissions, permissions);
      if (!check.allowed) throw forbidden(check.reason);
      if (
        target.status === 'active' &&
        target.permissions.includes('owner') &&
        !permissions.includes('owner')
      ) {
        await this.assertAnotherOwner(trx, ctx.businessId, target.id);
      }
      await trx
        .updateTable('memberships')
        .set({ permissions })
        .where('id', '=', target.id)
        .execute();
      await writeAudit(trx, {
        actorType: 'user',
        actorId,
        action: 'membership.permissions_changed',
        targetType: 'membership',
        targetId: target.id,
        businessId: ctx.businessId,
        diff: { before: target.permissions, after: permissions },
        requestId: meta.requestId,
      });
    });
    return this.getMember(ctx.businessId, memberId);
  }

  async removeMember(
    ctx: BusinessContext,
    actorId: string,
    memberId: string,
    meta: RequestMeta,
  ): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await trx
        .selectFrom('businesses')
        .select('id')
        .where('id', '=', ctx.businessId)
        .forUpdate()
        .execute();
      const target = await this.lockMember(trx, ctx.businessId, memberId);
      const check = canAssignPermissions(ctx.permissions, target.permissions, []);
      if (!check.allowed) throw forbidden(check.reason);
      if (target.status === 'active' && target.permissions.includes('owner')) {
        await this.assertAnotherOwner(trx, ctx.businessId, target.id);
      }
      await trx
        .updateTable('memberships')
        .set({ status: 'removed', removed_at: this.clock.now() })
        .where('id', '=', target.id)
        .execute();
      await writeAudit(trx, {
        actorType: 'user',
        actorId,
        action: 'membership.removed',
        targetType: 'membership',
        targetId: target.id,
        businessId: ctx.businessId,
        diff: { permissions: target.permissions },
        requestId: meta.requestId,
      });
    });
  }

  private async lockMember(trx: Db, businessId: string, memberId: string) {
    const target = await trx
      .selectFrom('memberships')
      .select(['id', 'permissions', 'status'])
      .where('id', '=', memberId)
      .where('business_id', '=', businessId)
      .where('status', 'in', ['invited', 'active'])
      .forUpdate()
      .executeTakeFirst();
    if (!target) throw notFound();
    return target;
  }

  /** A business always keeps at least one active owner. */
  private async assertAnotherOwner(
    trx: Db,
    businessId: string,
    exceptMembershipId: string,
  ): Promise<void> {
    const other = await trx
      .selectFrom('memberships')
      .select('id')
      .where('business_id', '=', businessId)
      .where('status', '=', 'active')
      .where('id', '<>', exceptMembershipId)
      .where(sql<boolean>`'owner' = ANY(permissions)`)
      .executeTakeFirst();
    if (!other) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'LAST_OWNER',
        'A business needs at least one owner. Add another owner first.',
      );
    }
  }

  private async getMember(businessId: string, memberId: string): Promise<Member> {
    const row = await this.db
      .selectFrom('memberships as m')
      .innerJoin('users as u', 'u.id', 'm.user_id')
      .select([
        'm.id',
        'm.user_id',
        'm.permissions',
        'm.status',
        'm.created_at',
        'm.accepted_at',
        'u.display_name',
        'u.email',
        'u.phone',
      ])
      .where('m.id', '=', memberId)
      .where('m.business_id', '=', businessId)
      .executeTakeFirstOrThrow();
    return toMember(row);
  }
}
