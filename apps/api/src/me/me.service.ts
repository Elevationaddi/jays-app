import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Address, AddressInput, Me, MyMembership, UpdateMeRequest } from '@jays/contracts';
import type { Db } from '@jays/db';
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
import type { RequestMeta } from '../common/request-context.js';
import { DB } from '../common/tokens.js';
import { toMe } from '../auth/users.js';
import { loadBusinessViews } from '../businesses/business-view.js';

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found.');

type AddressRow = {
  id: string;
  label: string | null;
  emirate_code: string;
  area: string;
  street: string;
  building: string;
  unit: string | null;
  directions: string | null;
  latitude: string | null;
  longitude: string | null;
  is_default: boolean;
  created_at: Date;
};

function toAddress(row: AddressRow): Address {
  return {
    id: row.id,
    label: row.label,
    emirate: row.emirate_code as Address['emirate'],
    area: row.area,
    street: row.street,
    building: row.building,
    unit: row.unit,
    directions: row.directions,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    isDefault: row.is_default,
    createdAt: row.created_at.toISOString(),
  };
}

/** Everything here is scoped to the authenticated user id; other users' rows answer 404. */
@Injectable()
export class MeService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async get(userId: string): Promise<Me> {
    const user = await this.db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', userId)
      .executeTakeFirstOrThrow();
    return toMe(this.db, user);
  }

  async update(userId: string, body: UpdateMeRequest): Promise<Me> {
    if (body.emirate) await this.assertEmirateEnabled(body.emirate);
    await this.db
      .updateTable('users')
      .set({
        ...(body.displayName !== undefined ? { display_name: body.displayName } : {}),
        ...(body.locale !== undefined ? { locale: body.locale } : {}),
        ...(body.emirate !== undefined ? { emirate_code: body.emirate } : {}),
        ...(body.preferredMode !== undefined ? { preferred_mode: body.preferredMode } : {}),
      })
      .where('id', '=', userId)
      .execute();
    return this.get(userId);
  }

  async listAddresses(userId: string, query: ListQuery) {
    const cursor = decodeCursor(query.cursor);
    let q = this.db
      .selectFrom('addresses')
      .selectAll()
      .select(cursorTs('created_at').as('cursor_ts'))
      .where('user_id', '=', userId)
      .where('archived_at', 'is', null);
    if (cursor) q = q.where(afterCursor('created_at', 'id', cursor));
    const rows = await q
      .orderBy('created_at')
      .orderBy('id')
      .limit(query.limit + 1)
      .execute();
    return toPage(rows, query.limit, toAddress);
  }

  async getAddress(userId: string, addressId: string): Promise<Address> {
    const row = await this.db
      .selectFrom('addresses')
      .selectAll()
      .where('id', '=', addressId)
      .where('user_id', '=', userId)
      .where('archived_at', 'is', null)
      .executeTakeFirst();
    if (!row) throw notFound();
    return toAddress(row);
  }

  async createAddress(userId: string, input: AddressInput): Promise<Address> {
    await this.assertEmirateEnabled(input.emirate);
    const row = await this.db.transaction().execute(async (trx) => {
      // Serialize address changes per user so the "one default" rule holds under concurrency.
      await trx.selectFrom('users').select('id').where('id', '=', userId).forUpdate().execute();
      const existing = await trx
        .selectFrom('addresses')
        .select('id')
        .where('user_id', '=', userId)
        .where('archived_at', 'is', null)
        .limit(1)
        .executeTakeFirst();
      const makeDefault = input.isDefault === true || !existing;
      if (makeDefault) {
        await trx
          .updateTable('addresses')
          .set({ is_default: false })
          .where('user_id', '=', userId)
          .where('is_default', '=', true)
          .execute();
      }
      return trx
        .insertInto('addresses')
        .values({
          user_id: userId,
          label: input.label ?? null,
          emirate_code: input.emirate,
          area: input.area,
          street: input.street,
          building: input.building,
          unit: input.unit ?? null,
          directions: input.directions ?? null,
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
          is_default: makeDefault,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    });
    return toAddress(row);
  }

  async updateAddress(
    userId: string,
    addressId: string,
    patch: Partial<AddressInput>,
  ): Promise<Address> {
    if (patch.emirate) await this.assertEmirateEnabled(patch.emirate);
    const row = await this.db.transaction().execute(async (trx) => {
      await trx.selectFrom('users').select('id').where('id', '=', userId).forUpdate().execute();
      const current = await trx
        .selectFrom('addresses')
        .selectAll()
        .where('id', '=', addressId)
        .where('user_id', '=', userId)
        .where('archived_at', 'is', null)
        .executeTakeFirst();
      if (!current) return undefined;
      const latitude =
        patch.latitude !== undefined
          ? patch.latitude
          : current.latitude === null
            ? null
            : Number(current.latitude);
      const longitude =
        patch.longitude !== undefined
          ? patch.longitude
          : current.longitude === null
            ? null
            : Number(current.longitude);
      if ((latitude === null) !== (longitude === null)) {
        throw new ApiError(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_FAILED',
          'The request is not valid.',
          {
            latitude: ['latitude and longitude go together'],
          },
        );
      }
      if (patch.isDefault === true) {
        await trx
          .updateTable('addresses')
          .set({ is_default: false })
          .where('user_id', '=', userId)
          .where('is_default', '=', true)
          .execute();
      }
      return trx
        .updateTable('addresses')
        .set({
          ...(patch.label !== undefined ? { label: patch.label } : {}),
          ...(patch.emirate !== undefined ? { emirate_code: patch.emirate } : {}),
          ...(patch.area !== undefined ? { area: patch.area } : {}),
          ...(patch.street !== undefined ? { street: patch.street } : {}),
          ...(patch.building !== undefined ? { building: patch.building } : {}),
          ...(patch.unit !== undefined ? { unit: patch.unit } : {}),
          ...(patch.directions !== undefined ? { directions: patch.directions } : {}),
          latitude,
          longitude,
          ...(patch.isDefault !== undefined ? { is_default: patch.isDefault } : {}),
        })
        .where('id', '=', addressId)
        .returningAll()
        .executeTakeFirstOrThrow();
    });
    if (!row) throw notFound();
    return toAddress(row);
  }

  /** Addresses are archived, not deleted, so past order snapshots stay explainable. */
  async archiveAddress(userId: string, addressId: string): Promise<void> {
    const result = await this.db
      .updateTable('addresses')
      .set({ archived_at: this.clock.now(), is_default: false })
      .where('id', '=', addressId)
      .where('user_id', '=', userId)
      .where('archived_at', 'is', null)
      .executeTakeFirst();
    if (result.numUpdatedRows === 0n) throw notFound();
  }

  async listMemberships(userId: string, query: ListQuery) {
    const cursor = decodeCursor(query.cursor);
    let q = this.db
      .selectFrom('memberships')
      .select(['id', 'business_id', 'status', 'permissions'])
      .select(cursorTs('created_at').as('cursor_ts'))
      .where('user_id', '=', userId)
      .where('status', 'in', ['invited', 'active']);
    if (cursor) q = q.where(afterCursor('created_at', 'id', cursor));
    const rows = await q
      .orderBy('created_at')
      .orderBy('id')
      .limit(query.limit + 1)
      .execute();
    const views = await loadBusinessViews(
      this.db,
      rows.slice(0, query.limit).map((r) => ({
        businessId: r.business_id,
        permissions: r.status === 'active' ? r.permissions : [],
      })),
    );
    return toPage(rows, query.limit, (row): MyMembership => ({
      membershipId: row.id,
      status: row.status as MyMembership['status'],
      permissions: row.permissions as MyMembership['permissions'],
      business: views.get(row.business_id)!,
    }));
  }

  /** Accepting or declining an invitation is always the invitee's own decision. */
  async respondToInvitation(
    userId: string,
    membershipId: string,
    accept: boolean,
    meta: RequestMeta,
  ): Promise<MyMembership | null> {
    const now = this.clock.now();
    const updated = await this.db.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom('memberships')
        .selectAll()
        .where('id', '=', membershipId)
        .where('user_id', '=', userId)
        .where('status', '=', 'invited')
        .forUpdate()
        .executeTakeFirst();
      if (!row) return undefined;
      const next = await trx
        .updateTable('memberships')
        .set(
          accept ? { status: 'active', accepted_at: now } : { status: 'removed', removed_at: now },
        )
        .where('id', '=', row.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await writeAudit(trx, {
        actorType: 'user',
        actorId: userId,
        action: accept ? 'membership.accepted' : 'membership.declined',
        targetType: 'membership',
        targetId: row.id,
        businessId: row.business_id,
        requestId: meta.requestId,
      });
      return next;
    });
    if (!updated) throw notFound();
    if (!accept) return null;
    const views = await loadBusinessViews(this.db, [
      { businessId: updated.business_id, permissions: updated.permissions },
    ]);
    return {
      membershipId: updated.id,
      status: 'active',
      permissions: updated.permissions as MyMembership['permissions'],
      business: views.get(updated.business_id)!,
    };
  }

  private async assertEmirateEnabled(code: string): Promise<void> {
    const row = await this.db
      .selectFrom('emirates')
      .select('enabled')
      .where('code', '=', code)
      .executeTakeFirst();
    if (!row?.enabled) {
      throw new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'EMIRATE_NOT_AVAILABLE',
        'This emirate is not available yet.',
      );
    }
  }
}
