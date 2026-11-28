import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  BlockInput,
  BlockListQuery,
  Branch,
  BranchInput,
  ClosureInput,
  PutShiftsRequest,
  Service,
  ServiceInput,
  Staff,
  StaffInput,
  UpdateBranchRequest,
  UpdateServiceRequest,
  UpdateStaffRequest,
} from '@jays/contracts';
import type { Db } from '@jays/db';
import { writeAudit } from '../common/audit.js';
import { CLOCK, type Clock } from '../common/clock.js';
import { ApiError } from '../common/error.filter.js';
import { decodeCursor, encodeCursor } from '../common/pagination.js';
import type { RequestMeta } from '../common/request-context.js';
import { DB } from '../common/tokens.js';
import {
  assertBookingsStillFit,
  assertNoUpcomingBookings,
  type Conn,
  hhmm,
  notFound,
  type Trx,
  weeklyHours,
} from './booking-shared.js';

interface Actor {
  businessId: string;
  userId: string;
  meta: RequestMeta;
}

const invalid = (field: string, message: string) =>
  new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_FAILED', message, {
    [field]: [message],
  });

const toNumber = (v: string | null) => (v === null ? null : Number(v));

/**
 * Branches (opening hours, closures), services, staff (assignments, shifts) and schedule blocks
 * for one business (docs/03-business.md, services sidebar). Every query is scoped to the
 * caller's business, and composite foreign keys make cross-business references impossible.
 *
 * Locking: changes to a branch's hours or closures take the branch row FOR UPDATE, changes to a
 * staff member's shifts, blocks or assignments take the staff row FOR UPDATE. Allocation (holds,
 * manual bookings, reschedules) takes the same rows FOR SHARE, so the two never interleave, and
 * each change re-checks upcoming bookings before it commits (409 SCHEDULE_CONFLICT).
 */
@Injectable()
export class ScheduleService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // -------------------------------------------------------------------------------------------
  // Branches

  async listBranches(businessId: string): Promise<Branch[]> {
    const rows = await this.db
      .selectFrom('branches')
      .selectAll()
      .where('business_id', '=', businessId)
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    return Promise.all(rows.map((r) => this.branchView(this.db, r)));
  }

  async getBranch(businessId: string, branchId: string): Promise<Branch> {
    const row = await this.db
      .selectFrom('branches')
      .selectAll()
      .where('business_id', '=', businessId)
      .where('id', '=', branchId)
      .executeTakeFirst();
    if (!row) throw notFound();
    return this.branchView(this.db, row);
  }

  async createBranch(a: Actor, body: BranchInput): Promise<Branch> {
    const id = await this.db.transaction().execute(async (trx) => {
      const branch = await trx
        .insertInto('branches')
        .values({
          business_id: a.businessId,
          name: JSON.stringify(body.name),
          emirate_code: body.emirate,
          area: body.area,
          street: body.street,
          building: body.building,
          latitude: body.latitude ?? null,
          longitude: body.longitude ?? null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await this.replaceHours(trx, branch.id, body.hours);
      await this.audit(trx, a, 'branch.created', 'branch', branch.id, { name: body.name });
      return branch.id;
    });
    return this.getBranch(a.businessId, id);
  }

  async updateBranch(a: Actor, branchId: string, body: UpdateBranchRequest): Promise<Branch> {
    await this.db.transaction().execute(async (trx) => {
      const now = this.clock.now();
      await this.lockBranch(trx, a.businessId, branchId);
      const set: Record<string, unknown> = {};
      if (body.name) set.name = JSON.stringify(body.name);
      if (body.emirate) set.emirate_code = body.emirate;
      if (body.area) set.area = body.area;
      if (body.street) set.street = body.street;
      if (body.building) set.building = body.building;
      if (body.latitude !== undefined) set.latitude = body.latitude;
      if (body.longitude !== undefined) set.longitude = body.longitude;
      if (body.status) {
        if (body.status === 'archived') {
          await assertNoUpcomingBookings(trx, a.businessId, { branchId }, now);
        }
        set.status = body.status;
      }
      if (Object.keys(set).length > 0) {
        await trx.updateTable('branches').set(set).where('id', '=', branchId).execute();
      }
      if (body.hours) {
        await this.replaceHours(trx, branchId, body.hours);
        await assertBookingsStillFit(trx, a.businessId, { branchId }, now);
      }
      await this.audit(trx, a, 'branch.updated', 'branch', branchId, {
        fields: Object.keys(body),
      });
    });
    return this.getBranch(a.businessId, branchId);
  }

  async listClosures(businessId: string, branchId: string) {
    await this.getBranch(businessId, branchId);
    const rows = await this.db
      .selectFrom('branch_closures')
      .select(['id', 'branch_id', 'starts_at', 'ends_at', 'reason'])
      .where('branch_id', '=', branchId)
      .where('ends_at', '>', this.clock.now())
      .orderBy('starts_at')
      .limit(200)
      .execute();
    return rows.map((r) => ({
      id: r.id,
      branchId: r.branch_id,
      startsAt: r.starts_at.toISOString(),
      endsAt: r.ends_at.toISOString(),
      reason: r.reason,
    }));
  }

  async addClosure(a: Actor, branchId: string, body: ClosureInput) {
    const row = await this.db.transaction().execute(async (trx) => {
      await this.lockBranch(trx, a.businessId, branchId);
      const closure = await trx
        .insertInto('branch_closures')
        .values({
          branch_id: branchId,
          starts_at: new Date(body.startsAt),
          ends_at: new Date(body.endsAt),
          reason: body.reason ?? null,
          created_by: a.userId,
        })
        .returning(['id', 'branch_id', 'starts_at', 'ends_at', 'reason'])
        .executeTakeFirstOrThrow();
      await assertBookingsStillFit(trx, a.businessId, { branchId }, this.clock.now());
      await this.audit(trx, a, 'branch.closure_added', 'branch', branchId, {
        startsAt: body.startsAt,
        endsAt: body.endsAt,
      });
      return closure;
    });
    return {
      id: row.id,
      branchId: row.branch_id,
      startsAt: row.starts_at.toISOString(),
      endsAt: row.ends_at.toISOString(),
      reason: row.reason,
    };
  }

  async removeClosure(a: Actor, branchId: string, closureId: string) {
    await this.db.transaction().execute(async (trx) => {
      await this.lockBranch(trx, a.businessId, branchId);
      const gone = await trx
        .deleteFrom('branch_closures')
        .where('id', '=', closureId)
        .where('branch_id', '=', branchId)
        .returning('id')
        .executeTakeFirst();
      if (!gone) throw notFound();
      await this.audit(trx, a, 'branch.closure_removed', 'branch', branchId, { closureId });
    });
  }

  private async lockBranch(trx: Trx, businessId: string, branchId: string) {
    const row = await trx
      .selectFrom('branches')
      .select('id')
      .where('id', '=', branchId)
      .where('business_id', '=', businessId)
      .forUpdate()
      .executeTakeFirst();
    if (!row) throw notFound();
  }

  private async replaceHours(trx: Trx, branchId: string, hours: BranchInput['hours']) {
    await trx.deleteFrom('branch_hours').where('branch_id', '=', branchId).execute();
    if (hours.length > 0) {
      await trx
        .insertInto('branch_hours')
        .values(
          hours.map((h) => ({
            branch_id: branchId,
            weekday: h.weekday,
            opens_at: h.start,
            closes_at: h.end,
          })),
        )
        .execute();
    }
  }

  private async branchView(
    conn: Conn,
    r: {
      id: string;
      name: { en: string; ar: string };
      emirate_code: string;
      area: string;
      street: string;
      building: string;
      latitude: string | null;
      longitude: string | null;
      timezone: string;
      status: 'active' | 'archived';
    },
  ): Promise<Branch> {
    return {
      id: r.id,
      name: r.name,
      emirate: r.emirate_code as Branch['emirate'],
      area: r.area,
      street: r.street,
      building: r.building,
      latitude: toNumber(r.latitude),
      longitude: toNumber(r.longitude),
      timezone: r.timezone,
      status: r.status,
      hours: await weeklyHours(conn, r.id),
    };
  }

  // -------------------------------------------------------------------------------------------
  // Services

  async listServices(businessId: string): Promise<Service[]> {
    const rows = await this.db
      .selectFrom('services')
      .selectAll()
      .where('business_id', '=', businessId)
      .where('status', '<>', 'archived')
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    return this.serviceViews(this.db, rows);
  }

  async getService(businessId: string, serviceId: string): Promise<Service> {
    const row = await this.db
      .selectFrom('services')
      .selectAll()
      .where('business_id', '=', businessId)
      .where('id', '=', serviceId)
      .executeTakeFirst();
    if (!row) throw notFound();
    const [view] = await this.serviceViews(this.db, [row]);
    return view as Service;
  }

  async createService(a: Actor, body: ServiceInput): Promise<Service> {
    const id = await this.db.transaction().execute(async (trx) => {
      await this.assertServiceCategory(trx, body.categoryId);
      await this.assertOwnBranches(trx, a.businessId, body.branchIds);
      await this.assertHomeAllowed(trx, a.businessId, body.locationMode);
      const service = await trx
        .insertInto('services')
        .values({
          business_id: a.businessId,
          category_id: body.categoryId,
          title: JSON.stringify(body.title),
          description: JSON.stringify(body.description),
          price_fils: body.priceFils,
          tax_class: body.taxClass,
          duration_min: body.durationMin,
          buffer_before_min: body.bufferBeforeMin,
          buffer_after_min: body.bufferAfterMin,
          cancel_cutoff_hours: body.cancelCutoffHours,
          late_cancel_refund_bps: body.lateCancelRefundBps,
          location_mode: body.locationMode,
          created_by: a.userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await this.replaceServiceBranches(trx, a.businessId, service.id, body.branchIds);
      await this.audit(trx, a, 'service.created', 'service', service.id, {
        title: body.title,
        priceFils: body.priceFils,
      });
      return service.id;
    });
    return this.getService(a.businessId, id);
  }

  /**
   * Edits never change existing bookings: each booking keeps the price, duration, buffers and
   * policy it was made with (T13). Removing a branch or archiving needs no upcoming bookings.
   */
  async updateService(a: Actor, serviceId: string, body: UpdateServiceRequest): Promise<Service> {
    await this.db.transaction().execute(async (trx) => {
      const now = this.clock.now();
      const current = await trx
        .selectFrom('services')
        .select(['id', 'status', 'location_mode'])
        .where('id', '=', serviceId)
        .where('business_id', '=', a.businessId)
        .forUpdate()
        .executeTakeFirst();
      if (!current || current.status === 'archived') throw notFound();
      if (current.status === 'suspended' && body.status === 'active') {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'SERVICE_SUSPENDED',
          'This service was suspended by the marketplace. Contact support to reinstate it.',
        );
      }
      if (body.categoryId) await this.assertServiceCategory(trx, body.categoryId);
      const set: Record<string, unknown> = {};
      if (body.categoryId) set.category_id = body.categoryId;
      if (body.title) set.title = JSON.stringify(body.title);
      if (body.description) set.description = JSON.stringify(body.description);
      if (body.priceFils !== undefined) set.price_fils = body.priceFils;
      if (body.taxClass) set.tax_class = body.taxClass;
      if (body.durationMin !== undefined) set.duration_min = body.durationMin;
      if (body.bufferBeforeMin !== undefined) set.buffer_before_min = body.bufferBeforeMin;
      if (body.bufferAfterMin !== undefined) set.buffer_after_min = body.bufferAfterMin;
      if (body.cancelCutoffHours !== undefined) set.cancel_cutoff_hours = body.cancelCutoffHours;
      if (body.lateCancelRefundBps !== undefined) {
        set.late_cancel_refund_bps = body.lateCancelRefundBps;
      }
      if (body.locationMode && body.locationMode !== current.location_mode) {
        await this.assertHomeAllowed(trx, a.businessId, body.locationMode);
        set.location_mode = body.locationMode;
      }
      if (body.status === 'archived') {
        await assertNoUpcomingBookings(trx, a.businessId, { serviceId }, now);
        set.status = 'archived';
      }
      await trx
        .updateTable('services')
        .set({ ...set, version: (eb) => eb('version', '+', 1) })
        .where('id', '=', serviceId)
        .execute();
      if (body.branchIds) {
        await this.assertOwnBranches(trx, a.businessId, body.branchIds);
        const existing = await trx
          .selectFrom('branch_services')
          .select('branch_id')
          .where('service_id', '=', serviceId)
          .execute();
        for (const { branch_id } of existing) {
          if (!body.branchIds.includes(branch_id)) {
            await assertNoUpcomingBookings(
              trx,
              a.businessId,
              { serviceId, branchId: branch_id },
              now,
            );
          }
        }
        await this.replaceServiceBranches(trx, a.businessId, serviceId, body.branchIds);
      }
      await this.audit(trx, a, 'service.updated', 'service', serviceId, {
        fields: Object.keys(body),
      });
    });
    return this.getService(a.businessId, serviceId);
  }

  private async assertServiceCategory(trx: Trx, categoryId: string) {
    const category = await trx
      .selectFrom('categories')
      .select('id')
      .where('id', '=', categoryId)
      .where('mode', '=', 'services')
      .executeTakeFirst();
    if (!category) throw invalid('categoryId', 'Pick a services category.');
  }

  /** Home visits need an approved home-service licence (D9). */
  private async assertHomeAllowed(trx: Trx, businessId: string, mode: Service['locationMode']) {
    if (mode === 'in_venue') return;
    const profile = await trx
      .selectFrom('home_service_profiles')
      .select('status')
      .where('business_id', '=', businessId)
      .executeTakeFirst();
    if (profile?.status !== 'approved') {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'HOME_SERVICES_NOT_APPROVED',
        'Home visits need an approved home-service licence first.',
      );
    }
  }

  private async assertOwnBranches(trx: Trx, businessId: string, ids: string[]) {
    if (ids.length === 0) return;
    const unique = [...new Set(ids)];
    const rows = await trx
      .selectFrom('branches')
      .select('id')
      .where('business_id', '=', businessId)
      .where('status', '=', 'active')
      .where('id', 'in', unique)
      .execute();
    if (rows.length !== unique.length) throw invalid('branchIds', 'Unknown or archived branch.');
  }

  private async replaceServiceBranches(
    trx: Trx,
    businessId: string,
    serviceId: string,
    branchIds: string[],
  ) {
    await trx.deleteFrom('branch_services').where('service_id', '=', serviceId).execute();
    const unique = [...new Set(branchIds)];
    if (unique.length > 0) {
      await trx
        .insertInto('branch_services')
        .values(
          unique.map((b) => ({ branch_id: b, service_id: serviceId, business_id: businessId })),
        )
        .execute();
    }
  }

  private async serviceViews(
    conn: Conn,
    rows: {
      id: string;
      category_id: string;
      title: { en: string; ar: string };
      description: { en: string; ar: string };
      price_fils: number;
      tax_class: Service['taxClass'];
      duration_min: number;
      buffer_before_min: number;
      buffer_after_min: number;
      cancel_cutoff_hours: number;
      late_cancel_refund_bps: number;
      location_mode: Service['locationMode'];
      status: Service['status'];
      suspension_reason: string | null;
      version: number;
    }[],
  ): Promise<Service[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [branches, staff] = await Promise.all([
      conn
        .selectFrom('branch_services')
        .select(['service_id', 'branch_id'])
        .where('service_id', 'in', ids)
        .orderBy('branch_id')
        .execute(),
      conn
        .selectFrom('staff_services as ss')
        .innerJoin('staff as s', 's.id', 'ss.staff_id')
        .select(['ss.service_id', 'ss.staff_id'])
        .where('ss.service_id', 'in', ids)
        .where('s.status', '=', 'active')
        .orderBy('ss.staff_id')
        .execute(),
    ]);
    return rows.map((r) => ({
      id: r.id,
      categoryId: r.category_id,
      title: r.title,
      description: r.description,
      priceFils: r.price_fils,
      taxClass: r.tax_class,
      durationMin: r.duration_min,
      bufferBeforeMin: r.buffer_before_min,
      bufferAfterMin: r.buffer_after_min,
      cancelCutoffHours: r.cancel_cutoff_hours,
      lateCancelRefundBps: r.late_cancel_refund_bps,
      locationMode: r.location_mode,
      status: r.status,
      suspensionReason: r.suspension_reason,
      version: r.version,
      branchIds: branches.filter((b) => b.service_id === r.id).map((b) => b.branch_id),
      staffIds: staff.filter((s) => s.service_id === r.id).map((s) => s.staff_id),
    }));
  }

  // -------------------------------------------------------------------------------------------
  // Staff and shifts

  async listStaff(businessId: string): Promise<Staff[]> {
    const rows = await this.db
      .selectFrom('staff')
      .select(['id', 'display_name', 'membership_id', 'status'])
      .where('business_id', '=', businessId)
      .where('status', '=', 'active')
      .orderBy('display_name')
      .orderBy('id')
      .execute();
    return this.staffViews(rows);
  }

  async getStaff(businessId: string, staffId: string): Promise<Staff> {
    const row = await this.db
      .selectFrom('staff')
      .select(['id', 'display_name', 'membership_id', 'status'])
      .where('business_id', '=', businessId)
      .where('id', '=', staffId)
      .executeTakeFirst();
    if (!row) throw notFound();
    const [view] = await this.staffViews([row]);
    return view as Staff;
  }

  async createStaff(a: Actor, body: StaffInput): Promise<Staff> {
    const id = await this.db.transaction().execute(async (trx) => {
      if (body.membershipId) await this.assertMembership(trx, a.businessId, body.membershipId);
      await this.assertOwnBranches(trx, a.businessId, body.branchIds);
      await this.assertOwnServices(trx, a.businessId, body.serviceIds);
      const staff = await this.insertStaff(trx, a.businessId, body);
      await this.audit(trx, a, 'staff.created', 'staff', staff, { displayName: body.displayName });
      return staff;
    });
    return this.getStaff(a.businessId, id);
  }

  private async insertStaff(trx: Trx, businessId: string, body: StaffInput) {
    try {
      const row = await trx
        .insertInto('staff')
        .values({
          business_id: businessId,
          display_name: body.displayName,
          membership_id: body.membershipId ?? null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await this.replaceStaffLinks(trx, businessId, row.id, body.branchIds, body.serviceIds);
      return row.id;
    } catch (error) {
      if ((error as { constraint?: string }).constraint === 'staff_membership_key') {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'MEMBER_ALREADY_STAFF',
          'That member already has a staff profile.',
          { membershipId: ['already linked'] },
        );
      }
      throw error;
    }
  }

  async updateStaff(a: Actor, staffId: string, body: UpdateStaffRequest): Promise<Staff> {
    await this.db.transaction().execute(async (trx) => {
      const now = this.clock.now();
      await this.lockStaff(trx, a.businessId, staffId);
      const set: Record<string, unknown> = {};
      if (body.displayName) set.display_name = body.displayName;
      if (body.membershipId !== undefined) {
        if (body.membershipId) await this.assertMembership(trx, a.businessId, body.membershipId);
        set.membership_id = body.membershipId;
      }
      if (body.status === 'archived') {
        await assertNoUpcomingBookings(trx, a.businessId, { staffId }, now);
        set.status = 'archived';
      } else if (body.status === 'active') {
        set.status = 'active';
      }
      if (Object.keys(set).length > 0) {
        try {
          await trx.updateTable('staff').set(set).where('id', '=', staffId).execute();
        } catch (error) {
          if ((error as { constraint?: string }).constraint === 'staff_membership_key') {
            throw new ApiError(
              HttpStatus.CONFLICT,
              'MEMBER_ALREADY_STAFF',
              'That member already has a staff profile.',
              { membershipId: ['already linked'] },
            );
          }
          throw error;
        }
      }
      if (body.branchIds || body.serviceIds) {
        const current = await this.links(trx, staffId);
        const branchIds = body.branchIds ?? current.branchIds;
        const serviceIds = body.serviceIds ?? current.serviceIds;
        await this.assertOwnBranches(trx, a.businessId, branchIds);
        await this.assertOwnServices(trx, a.businessId, serviceIds);
        for (const s of current.serviceIds.filter((s) => !serviceIds.includes(s))) {
          await assertNoUpcomingBookings(trx, a.businessId, { staffId, serviceId: s }, now);
        }
        const removedBranches = current.branchIds.filter((b) => !branchIds.includes(b));
        if (removedBranches.length > 0) {
          for (const b of removedBranches) {
            await assertNoUpcomingBookings(trx, a.businessId, { staffId, branchId: b }, now);
          }
          await trx
            .deleteFrom('shifts')
            .where('staff_id', '=', staffId)
            .where('branch_id', 'in', removedBranches)
            .execute();
        }
        await this.replaceStaffLinks(trx, a.businessId, staffId, branchIds, serviceIds);
      }
      await this.audit(trx, a, 'staff.updated', 'staff', staffId, { fields: Object.keys(body) });
    });
    return this.getStaff(a.businessId, staffId);
  }

  /** Replaces the weekly shifts; refused when an upcoming booking would fall outside them. */
  async putShifts(a: Actor, staffId: string, body: PutShiftsRequest): Promise<Staff> {
    await this.db.transaction().execute(async (trx) => {
      await this.lockStaff(trx, a.businessId, staffId);
      const { branchIds } = await this.links(trx, staffId);
      if (body.shifts.some((s) => !branchIds.includes(s.branchId))) {
        throw invalid('shifts', 'A shift must be at a branch this person works at.');
      }
      await trx.deleteFrom('shifts').where('staff_id', '=', staffId).execute();
      if (body.shifts.length > 0) {
        await trx
          .insertInto('shifts')
          .values(
            body.shifts.map((s) => ({
              staff_id: staffId,
              branch_id: s.branchId,
              business_id: a.businessId,
              weekday: s.weekday,
              starts_at: s.start,
              ends_at: s.end,
            })),
          )
          .execute();
      }
      await assertBookingsStillFit(trx, a.businessId, { staffId }, this.clock.now());
      await this.audit(trx, a, 'staff.shifts_replaced', 'staff', staffId, {
        shifts: body.shifts.length,
      });
    });
    return this.getStaff(a.businessId, staffId);
  }

  private async lockStaff(trx: Trx, businessId: string, staffId: string) {
    const row = await trx
      .selectFrom('staff')
      .select('id')
      .where('id', '=', staffId)
      .where('business_id', '=', businessId)
      .forUpdate()
      .executeTakeFirst();
    if (!row) throw notFound();
  }

  private async links(conn: Conn, staffId: string) {
    const [branches, services] = await Promise.all([
      conn
        .selectFrom('staff_branches')
        .select('branch_id')
        .where('staff_id', '=', staffId)
        .execute(),
      conn
        .selectFrom('staff_services')
        .select('service_id')
        .where('staff_id', '=', staffId)
        .execute(),
    ]);
    return {
      branchIds: branches.map((b) => b.branch_id),
      serviceIds: services.map((s) => s.service_id),
    };
  }

  private async assertMembership(trx: Trx, businessId: string, membershipId: string) {
    const row = await trx
      .selectFrom('memberships')
      .select('id')
      .where('id', '=', membershipId)
      .where('business_id', '=', businessId)
      .where('status', '=', 'active')
      .executeTakeFirst();
    if (!row) throw invalid('membershipId', 'Unknown member.');
  }

  private async assertOwnServices(trx: Trx, businessId: string, ids: string[]) {
    if (ids.length === 0) return;
    const unique = [...new Set(ids)];
    const rows = await trx
      .selectFrom('services')
      .select('id')
      .where('business_id', '=', businessId)
      .where('status', '<>', 'archived')
      .where('id', 'in', unique)
      .execute();
    if (rows.length !== unique.length) throw invalid('serviceIds', 'Unknown service.');
  }

  private async replaceStaffLinks(
    trx: Trx,
    businessId: string,
    staffId: string,
    branchIds: string[],
    serviceIds: string[],
  ) {
    // Shifts reference staff_branches, so keep rows for branches that stay.
    await trx
      .deleteFrom('staff_branches')
      .where('staff_id', '=', staffId)
      .where(
        'branch_id',
        'not in',
        branchIds.length > 0 ? branchIds : ['00000000-0000-0000-0000-000000000000'],
      )
      .execute();
    const branches = [...new Set(branchIds)];
    if (branches.length > 0) {
      await trx
        .insertInto('staff_branches')
        .values(branches.map((b) => ({ staff_id: staffId, branch_id: b, business_id: businessId })))
        .onConflict((oc) => oc.columns(['staff_id', 'branch_id']).doNothing())
        .execute();
    }
    await trx.deleteFrom('staff_services').where('staff_id', '=', staffId).execute();
    const services = [...new Set(serviceIds)];
    if (services.length > 0) {
      await trx
        .insertInto('staff_services')
        .values(
          services.map((s) => ({ staff_id: staffId, service_id: s, business_id: businessId })),
        )
        .execute();
    }
  }

  private async staffViews(
    rows: {
      id: string;
      display_name: string;
      membership_id: string | null;
      status: Staff['status'];
    }[],
  ): Promise<Staff[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [branches, services, shifts] = await Promise.all([
      this.db
        .selectFrom('staff_branches')
        .select(['staff_id', 'branch_id'])
        .where('staff_id', 'in', ids)
        .orderBy('branch_id')
        .execute(),
      this.db
        .selectFrom('staff_services')
        .select(['staff_id', 'service_id'])
        .where('staff_id', 'in', ids)
        .orderBy('service_id')
        .execute(),
      this.db
        .selectFrom('shifts')
        .select(['id', 'staff_id', 'branch_id', 'weekday', 'starts_at', 'ends_at'])
        .where('staff_id', 'in', ids)
        .orderBy('weekday')
        .orderBy('starts_at')
        .execute(),
    ]);
    return rows.map((r) => ({
      id: r.id,
      displayName: r.display_name,
      membershipId: r.membership_id,
      status: r.status,
      branchIds: branches.filter((b) => b.staff_id === r.id).map((b) => b.branch_id),
      serviceIds: services.filter((s) => s.staff_id === r.id).map((s) => s.service_id),
      shifts: shifts
        .filter((s) => s.staff_id === r.id)
        .map((s) => ({
          id: s.id,
          branchId: s.branch_id,
          weekday: s.weekday,
          start: hhmm(s.starts_at),
          end: hhmm(s.ends_at),
        })),
    }));
  }

  // -------------------------------------------------------------------------------------------
  // Schedule blocks

  async listBlocks(businessId: string, query: BlockListQuery) {
    const key = decodeCursor(query.cursor);
    let q = this.db
      .selectFrom('schedule_blocks')
      .select(['id', 'staff_id', 'starts_at', 'ends_at', 'kind', 'reason'])
      .where('business_id', '=', businessId)
      .where('ends_at', '>', query.from ? new Date(query.from) : this.clock.now());
    if (query.staffId) q = q.where('staff_id', '=', query.staffId);
    if (key) {
      q = q.where((eb) =>
        eb.or([
          eb('starts_at', '>', new Date(key.ts)),
          eb.and([eb('starts_at', '=', new Date(key.ts)), eb('id', '>', key.id)]),
        ]),
      );
    }
    const rows = await q
      .orderBy('starts_at')
      .orderBy('id')
      .limit(query.limit + 1)
      .execute();
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((r) => ({
        id: r.id,
        staffId: r.staff_id,
        startsAt: r.starts_at.toISOString(),
        endsAt: r.ends_at.toISOString(),
        kind: r.kind,
        reason: r.reason,
      })),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({ ts: last.starts_at.toISOString(), id: last.id })
          : null,
    };
  }

  /** A break or leave; refused when it would cover an upcoming booking (409 SCHEDULE_CONFLICT). */
  async addBlock(a: Actor, body: BlockInput) {
    const row = await this.db.transaction().execute(async (trx) => {
      await this.lockStaff(trx, a.businessId, body.staffId);
      const block = await trx
        .insertInto('schedule_blocks')
        .values({
          staff_id: body.staffId,
          business_id: a.businessId,
          starts_at: new Date(body.startsAt),
          ends_at: new Date(body.endsAt),
          kind: body.kind,
          reason: body.reason ?? null,
          created_by: a.userId,
        })
        .returning(['id', 'staff_id', 'starts_at', 'ends_at', 'kind', 'reason'])
        .executeTakeFirstOrThrow();
      await assertBookingsStillFit(trx, a.businessId, { staffId: body.staffId }, this.clock.now());
      await this.audit(trx, a, 'staff.block_added', 'staff', body.staffId, {
        kind: body.kind,
        startsAt: body.startsAt,
        endsAt: body.endsAt,
      });
      return block;
    });
    return {
      id: row.id,
      staffId: row.staff_id,
      startsAt: row.starts_at.toISOString(),
      endsAt: row.ends_at.toISOString(),
      kind: row.kind,
      reason: row.reason,
    };
  }

  async removeBlock(a: Actor, blockId: string) {
    const gone = await this.db
      .deleteFrom('schedule_blocks')
      .where('id', '=', blockId)
      .where('business_id', '=', a.businessId)
      .returning(['id', 'staff_id'])
      .executeTakeFirst();
    if (!gone) throw notFound();
    await this.audit(this.db, a, 'staff.block_removed', 'staff', gone.staff_id, { blockId });
  }

  private async audit(
    conn: Conn,
    a: Actor,
    action: string,
    targetType: string,
    targetId: string,
    diff: Record<string, unknown>,
  ) {
    await writeAudit(conn, {
      actorType: 'user',
      actorId: a.userId,
      action,
      targetType,
      targetId,
      businessId: a.businessId,
      diff,
      requestId: a.meta.requestId,
    });
  }
}
