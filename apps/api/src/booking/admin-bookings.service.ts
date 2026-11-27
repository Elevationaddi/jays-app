import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  AdminBooking,
  AdminBookingListQuery,
  AdminService,
  AdminServiceActionRequest,
  AdminServiceListQuery,
} from '@jays/contracts';
import type { Db } from '@jays/db';
import { writeAudit } from '../common/audit.js';
import { ApiError } from '../common/error.filter.js';
import { afterCursor, cursorTs, decodeCursor, toPage } from '../common/pagination.js';
import type { RequestMeta } from '../common/request-context.js';
import { DB } from '../common/tokens.js';
import {
  BOOKING_COLUMNS,
  type BookingRow,
  merchantBookingView,
  notFound,
} from './booking-shared.js';

/**
 * Marketplace oversight of bookings and services (ADR-0014): operations and support monitor
 * bookings across businesses; catalog, compliance and operations can suspend a service, which
 * hides it from customers and blocks new bookings. Existing bookings are kept.
 */
@Injectable()
export class AdminBookingsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async listBookings(query: AdminBookingListQuery) {
    const key = decodeCursor(query.cursor);
    let q = this.db
      .selectFrom('bookings as b')
      .leftJoin('payments as p', 'p.booking_id', 'b.id')
      .select([
        ...BOOKING_COLUMNS,
        'p.status as payment_status',
        'p.needs_attention',
        cursorTs('b.created_at').as('cursor_ts'),
      ]);
    if (query.status) q = q.where('b.status', '=', query.status);
    if (query.businessId) q = q.where('b.business_id', '=', query.businessId);
    if (key) q = q.where(afterCursor('b.created_at', 'b.id', key, 'desc'));
    const rows = await q
      .orderBy('b.created_at', 'desc')
      .orderBy('b.id', 'desc')
      .limit(query.limit + 1)
      .execute();
    return toPage(rows, query.limit, (r): AdminBooking => ({
      ...merchantBookingView(r as unknown as BookingRow, r.payment_status),
      paymentNeedsAttention: r.needs_attention ?? false,
    }));
  }

  async listServices(query: AdminServiceListQuery, onlyId?: string) {
    const key = decodeCursor(query.cursor);
    let q = this.db
      .selectFrom('services as s')
      .innerJoin('businesses as b', 'b.id', 's.business_id')
      .leftJoin('storefronts as sf', 'sf.business_id', 'b.id')
      .select([
        's.id',
        's.business_id',
        'b.display_name',
        'sf.live_name',
        's.category_id',
        's.title',
        's.description',
        's.price_fils',
        's.tax_class',
        's.duration_min',
        's.buffer_before_min',
        's.buffer_after_min',
        's.cancel_cutoff_hours',
        's.late_cancel_refund_bps',
        's.status',
        's.suspension_reason',
        's.version',
        cursorTs('s.created_at').as('cursor_ts'),
      ]);
    if (query.status !== 'all') q = q.where('s.status', '=', query.status);
    if (onlyId) q = q.where('s.id', '=', onlyId);
    if (key) q = q.where(afterCursor('s.created_at', 's.id', key, 'desc'));
    const rows = await q
      .orderBy('s.created_at', 'desc')
      .orderBy('s.id', 'desc')
      .limit(query.limit + 1)
      .execute();
    const ids = rows.map((r) => r.id);
    const [branches, staff] = ids.length
      ? await Promise.all([
          this.db
            .selectFrom('branch_services')
            .select(['service_id', 'branch_id'])
            .where('service_id', 'in', ids)
            .execute(),
          this.db
            .selectFrom('staff_services')
            .select(['service_id', 'staff_id'])
            .where('service_id', 'in', ids)
            .execute(),
        ])
      : [[], []];
    return toPage(rows, query.limit, (r): AdminService => ({
      id: r.id,
      business: { id: r.business_id, name: r.live_name ?? r.display_name },
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
      status: r.status,
      suspensionReason: r.suspension_reason,
      version: r.version,
      branchIds: branches.filter((b) => b.service_id === r.id).map((b) => b.branch_id),
      staffIds: staff.filter((s) => s.service_id === r.id).map((s) => s.staff_id),
    }));
  }

  async actOnService(
    adminId: string,
    serviceId: string,
    body: AdminServiceActionRequest,
    meta: RequestMeta,
  ) {
    await this.db.transaction().execute(async (trx) => {
      const s = await trx
        .selectFrom('services')
        .select(['id', 'status', 'version', 'business_id'])
        .where('id', '=', serviceId)
        .forUpdate()
        .executeTakeFirst();
      if (!s) throw notFound();
      if (s.version !== body.expectedVersion) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'VERSION_CONFLICT',
          'This service changed since you loaded it. Reload and try again.',
        );
      }
      const from = body.action === 'suspend' ? 'active' : 'suspended';
      if (s.status !== from) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'INVALID_TRANSITION',
          `Cannot ${body.action} a ${s.status} service.`,
        );
      }
      await trx
        .updateTable('services')
        .set({
          status: body.action === 'suspend' ? 'suspended' : 'active',
          suspension_reason: body.action === 'suspend' ? body.reason : null,
          version: (eb) => eb('version', '+', 1),
        })
        .where('id', '=', serviceId)
        .execute();
      await writeAudit(trx, {
        actorType: 'admin',
        actorId: adminId,
        action: `service.${body.action === 'suspend' ? 'suspended' : 'reinstated'}`,
        targetType: 'service',
        targetId: serviceId,
        businessId: s.business_id,
        reason: body.reason,
        requestId: meta.requestId,
      });
    });
    const page = await this.listServices({ status: 'all', limit: 1 }, serviceId);
    return page.items[0] as AdminService;
  }
}
