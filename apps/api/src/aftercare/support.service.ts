import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  AdminTicketAction,
  AdminTicketListQuery,
  AdminTicketView,
  TicketInput,
  TicketView,
} from '@jays/contracts';
import type { Database, Db } from '@jays/db';
import {
  DOCUMENT_MAX_BYTES,
  DOWNLOAD_URL_TTL_SECONDS,
  escalatedPriority,
  initialTicketPriority,
  safeFileName,
  TICKET_SLA_HOURS,
  ticketTransition,
  UPLOAD_URL_TTL_SECONDS,
  type TicketEvent,
  type TicketPriority,
  type TicketStatus,
} from '@jays/domain';
import type { Transaction } from 'kysely';
import { writeAudit } from '../common/audit.js';
import { addSeconds, CLOCK, type Clock } from '../common/clock.js';
import { enforce, RATE_LIMITER, type RateLimiter } from '../common/rate-limit.js';
import { LIMITS } from '../auth/policy.js';
import {
  MALWARE_SCANNER,
  type MalwareScanner,
  OBJECT_STORAGE,
  type ObjectStorage,
} from '../storage/storage.js';
import { newObjectKey, uploadFailure, verifyStoredUpload } from '../storage/uploads.js';
import { ApiError } from '../common/error.filter.js';
import { afterCursor, cursorTs, decodeCursor, toPage } from '../common/pagination.js';
import type { RequestMeta } from '../common/request-context.js';
import { DB } from '../common/tokens.js';

type Trx = Transaction<Database>;
type Cursor = { cursor?: string | undefined; limit: number };

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'The ticket was not found.');
/** Most files a ticket can hold (proposed). */
export const TICKET_MAX_ATTACHMENTS = 5;

const slaFrom = (now: Date) => new Date(now.getTime() + TICKET_SLA_HOURS * 3_600_000);

/**
 * Support tickets (docs/04-admin.md, /admin/support; ADR-0016): customers open tickets about an
 * order, a booking, a payment or their account; support works a queue ordered by first-reply SLA.
 * Internal notes are visible to admins only. Every admin action is audited.
 */
@Injectable()
export class SupportService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(MALWARE_SCANNER) private readonly scanner: MalwareScanner,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
  ) {}

  async create(userId: string, body: TicketInput, meta: RequestMeta): Promise<TicketView> {
    const now = this.clock.now();
    if (body.orderId && body.bookingId) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        'Pick an order or a booking.',
        {
          orderId: ['give an order or a booking, not both'],
        },
      );
    }
    // A ticket may only point at the customer's own order or booking.
    if (body.orderId) {
      const own = await this.db
        .selectFrom('orders')
        .select('id')
        .where('id', '=', body.orderId)
        .where('user_id', '=', userId)
        .executeTakeFirst();
      if (!own) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'The order was not found.');
    }
    if (body.bookingId) {
      const own = await this.db
        .selectFrom('bookings')
        .select('id')
        .where('id', '=', body.bookingId)
        .where('user_id', '=', userId)
        .executeTakeFirst();
      if (!own) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'The booking was not found.');
    }
    const id = await this.db.transaction().execute(async (trx) => {
      const t = await trx
        .insertInto('support_tickets')
        .values({
          user_id: userId,
          type: body.type,
          order_id: body.orderId ?? null,
          booking_id: body.bookingId ?? null,
          subject: body.subject,
          priority: initialTicketPriority(body.type),
          sla_due_at: slaFrom(now),
          last_message_at: now,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('ticket_messages')
        .values({ ticket_id: t.id, author_type: 'customer', author_id: userId, body: body.body })
        .execute();
      await writeAudit(trx, {
        actorType: 'user',
        actorId: userId,
        action: 'ticket.create',
        targetType: 'support_ticket',
        targetId: t.id,
        diff: { type: body.type },
        requestId: meta.requestId,
      });
      return t.id;
    });
    return this.getForUser(userId, id);
  }

  async listForUser(userId: string, query: Cursor) {
    const key = decodeCursor(query.cursor);
    let q = this.db
      .selectFrom('support_tickets')
      .select([
        'id',
        'type',
        'order_id',
        'booking_id',
        'subject',
        'status',
        'priority',
        'created_at',
        'last_message_at',
        cursorTs('created_at').as('cursor_ts'),
      ])
      .where('user_id', '=', userId);
    if (key) q = q.where(afterCursor('created_at', 'id', key, 'desc'));
    const rows = await q
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(query.limit + 1)
      .execute();
    return toPage(rows, query.limit, (t) => ({
      id: t.id,
      type: t.type,
      orderId: t.order_id,
      bookingId: t.booking_id,
      subject: t.subject,
      status: t.status,
      priority: t.priority,
      createdAt: t.created_at.toISOString(),
      lastMessageAt: t.last_message_at.toISOString(),
    }));
  }

  async getForUser(userId: string, ticketId: string): Promise<TicketView> {
    const t = await this.db
      .selectFrom('support_tickets')
      .selectAll()
      .where('id', '=', ticketId)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (!t) throw notFound();
    const messages = await this.db
      .selectFrom('ticket_messages')
      .select(['id', 'author_type', 'body', 'internal', 'created_at'])
      .where('ticket_id', '=', t.id)
      .where('internal', '=', false)
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    return {
      id: t.id,
      type: t.type,
      orderId: t.order_id,
      bookingId: t.booking_id,
      subject: t.subject,
      status: t.status,
      priority: t.priority,
      createdAt: t.created_at.toISOString(),
      lastMessageAt: t.last_message_at.toISOString(),
      messages: messages.map((m) => ({
        id: m.id,
        author: m.author_type === 'admin' ? 'support' : 'customer',
        authorName: null,
        body: m.body,
        internal: false,
        createdAt: m.created_at.toISOString(),
      })),
      attachments: await this.attachments(t.id),
    };
  }

  async customerReply(userId: string, ticketId: string, body: string, meta: RequestMeta) {
    const now = this.clock.now();
    await this.db.transaction().execute(async (trx) => {
      const t = await this.lock(trx, ticketId, userId);
      const next = ticketTransition(t.status as TicketStatus, 'customer_reply')!;
      await trx
        .insertInto('ticket_messages')
        .values({ ticket_id: t.id, author_type: 'customer', author_id: userId, body })
        .execute();
      await trx
        .updateTable('support_tickets')
        .set({
          status: next,
          last_message_at: now,
          ...(next === 'reopened' ? { resolved_at: null, sla_due_at: slaFrom(now) } : {}),
        })
        .where('id', '=', t.id)
        .execute();
      await writeAudit(trx, {
        actorType: 'user',
        actorId: userId,
        action: 'ticket.customer_reply',
        targetType: 'support_ticket',
        targetId: t.id,
        diff: { from: t.status, to: next },
        requestId: meta.requestId,
      });
    });
    return this.getForUser(userId, ticketId);
  }

  // Admin ------------------------------------------------------------------------------------------

  async adminList(adminId: string, query: AdminTicketListQuery) {
    const now = this.clock.now();
    const key = decodeCursor(query.cursor);
    let q = this.adminBase().select(cursorTs('t.created_at').as('cursor_ts'));
    switch (query.queue) {
      case 'open':
        q = q.where('t.status', 'in', ['open', 'assigned', 'reopened']);
        break;
      case 'mine':
        q = q.where('t.assigned_admin_id', '=', adminId).where('t.status', '<>', 'resolved');
        break;
      case 'awaiting_reply':
        q = q.where('t.status', '=', 'awaiting_reply');
        break;
      case 'escalated':
        q = q.where('t.escalation', 'is not', null).where('t.status', '<>', 'resolved');
        break;
      case 'resolved':
        q = q.where('t.status', '=', 'resolved');
        break;
      case 'all':
        break;
    }
    if (key) q = q.where(afterCursor('t.created_at', 't.id', key, 'desc'));
    const rows = await q
      .orderBy('t.created_at', 'desc')
      .orderBy('t.id', 'desc')
      .limit(query.limit + 1)
      .execute();
    return toPage(rows, query.limit, (t) => adminHead(t, now));
  }

  async adminGet(ticketId: string): Promise<AdminTicketView> {
    const t = await this.adminBase().where('t.id', '=', ticketId).executeTakeFirst();
    if (!t) throw notFound();
    const messages = await this.db
      .selectFrom('ticket_messages as m')
      .leftJoin('admin_accounts as a', (j) =>
        j.onRef('a.id', '=', 'm.author_id').on('m.author_type', '=', 'admin'),
      )
      .select(['m.id', 'm.author_type', 'm.body', 'm.internal', 'm.created_at', 'a.display_name'])
      .where('m.ticket_id', '=', t.id)
      .orderBy('m.created_at')
      .orderBy('m.id')
      .execute();
    return {
      ...adminHead(t, this.clock.now()),
      messages: messages.map((m) => ({
        id: m.id,
        author: m.author_type === 'admin' ? 'support' : 'customer',
        authorName: m.author_type === 'admin' ? (m.display_name ?? null) : t.user_name,
        body: m.body,
        internal: m.internal,
        createdAt: m.created_at.toISOString(),
      })),
      attachments: await this.attachments(t.id),
    };
  }

  async adminMessage(
    adminId: string,
    ticketId: string,
    body: { body: string; internal: boolean },
    meta: RequestMeta,
  ) {
    const now = this.clock.now();
    await this.db.transaction().execute(async (trx) => {
      const t = await this.lock(trx, ticketId);
      if (!body.internal) {
        const next = ticketTransition(t.status as TicketStatus, 'admin_reply');
        if (!next) {
          throw new ApiError(
            HttpStatus.CONFLICT,
            'INVALID_TRANSITION',
            'The ticket is resolved. The customer can reopen it by replying.',
          );
        }
        await trx
          .updateTable('support_tickets')
          .set({
            status: next,
            last_message_at: now,
            assigned_admin_id: t.assigned_admin_id ?? adminId,
            // The first reply the customer sees is what the 24-hour target measures (D12).
            ...(t.first_response_at ? {} : { first_response_at: now }),
          })
          .where('id', '=', t.id)
          .execute();
        await trx
          .insertInto('outbox')
          .values({
            event_type: 'ticket.replied',
            payload: JSON.stringify({ ticketId: t.id, userId: t.user_id }),
            available_at: now,
          })
          .execute();
      }
      await trx
        .insertInto('ticket_messages')
        .values({
          ticket_id: t.id,
          author_type: 'admin',
          author_id: adminId,
          body: body.body,
          internal: body.internal,
        })
        .execute();
      await writeAudit(trx, {
        actorType: 'admin',
        actorId: adminId,
        action: body.internal ? 'ticket.note' : 'ticket.reply',
        targetType: 'support_ticket',
        targetId: t.id,
        requestId: meta.requestId,
      });
    });
    return this.adminGet(ticketId);
  }

  async adminAction(adminId: string, ticketId: string, body: AdminTicketAction, meta: RequestMeta) {
    const now = this.clock.now();
    await this.db.transaction().execute(async (trx) => {
      const t = await this.lock(trx, ticketId);
      if (body.action === 'set_priority' || body.action === 'escalate') {
        if (t.status === 'resolved') {
          throw new ApiError(
            HttpStatus.CONFLICT,
            'INVALID_TRANSITION',
            'The ticket is already resolved.',
          );
        }
        const priority: TicketPriority =
          body.action === 'set_priority'
            ? body.priority
            : escalatedPriority(body.escalation, t.priority);
        await trx
          .updateTable('support_tickets')
          .set({
            priority,
            ...(body.action === 'escalate'
              ? { escalation: body.escalation, escalated_at: now }
              : {}),
          })
          .where('id', '=', t.id)
          .execute();
        if (body.action === 'escalate') {
          // The reason stays on the ticket as an internal note, never shown to the customer.
          await trx
            .insertInto('ticket_messages')
            .values({
              ticket_id: t.id,
              author_type: 'admin',
              author_id: adminId,
              body: `Escalated (${body.escalation}): ${body.reason}`,
              internal: true,
            })
            .execute();
          await trx
            .insertInto('outbox')
            .values({
              event_type: 'ticket.escalated',
              payload: JSON.stringify({ ticketId: t.id, escalation: body.escalation }),
              available_at: now,
            })
            .execute();
        }
        await writeAudit(trx, {
          actorType: 'admin',
          actorId: adminId,
          action: body.action === 'escalate' ? 'ticket.escalate' : 'ticket.set_priority',
          targetType: 'support_ticket',
          targetId: t.id,
          diff: {
            from: { priority: t.priority, escalation: t.escalation },
            to: {
              priority,
              escalation: body.action === 'escalate' ? body.escalation : t.escalation,
            },
          },
          ...(body.action === 'escalate' ? { reason: body.reason } : {}),
          requestId: meta.requestId,
        });
        return;
      }
      const action = body.action;
      const event: TicketEvent = action === 'resolve' ? 'resolve' : 'assign';
      let next = ticketTransition(t.status as TicketStatus, event);
      if (action === 'unassign')
        next = t.status === 'assigned' ? 'open' : (t.status as TicketStatus);
      if (!next || (action === 'unassign' && t.status === 'resolved')) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'INVALID_TRANSITION',
          'The ticket is already resolved.',
        );
      }
      await trx
        .updateTable('support_tickets')
        .set({
          status: next,
          ...(action === 'assign_to_me' ? { assigned_admin_id: adminId } : {}),
          ...(action === 'unassign' ? { assigned_admin_id: null } : {}),
          ...(action === 'resolve' ? { resolved_at: now } : {}),
        })
        .where('id', '=', t.id)
        .execute();
      await writeAudit(trx, {
        actorType: 'admin',
        actorId: adminId,
        action: `ticket.${action}`,
        targetType: 'support_ticket',
        targetId: t.id,
        diff: { from: t.status, to: next },
        requestId: meta.requestId,
      });
    });
    return this.adminGet(ticketId);
  }

  // Attachments ------------------------------------------------------------------------------------

  /**
   * A signed upload link for a file on the customer's own ticket. The file only counts once
   * `completeAttachment` has checked its real type and scanned it for malware (ADR-0020).
   */
  async createAttachmentUpload(
    userId: string,
    ticketId: string,
    body: {
      fileName: string;
      contentType: 'application/pdf' | 'image/jpeg' | 'image/png';
      sizeBytes: number;
    },
    meta: RequestMeta,
  ) {
    await enforce(this.limiter, [[LIMITS.ticketUploadPerUser, userId]]);
    const now = this.clock.now();
    const expiresAt = addSeconds(now, UPLOAD_URL_TTL_SECONDS);
    const key = newObjectKey('private', ticketId, body.contentType);
    const id = await this.db.transaction().execute(async (trx) => {
      await this.lock(trx, ticketId, userId);
      const { n } = await trx
        .selectFrom('ticket_attachments')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('ticket_id', '=', ticketId)
        .where('status', 'in', ['pending_upload', 'clean'])
        .executeTakeFirstOrThrow();
      if (Number(n) >= TICKET_MAX_ATTACHMENTS) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'TOO_MANY_ATTACHMENTS',
          `A ticket can hold up to ${TICKET_MAX_ATTACHMENTS} files.`,
        );
      }
      const row = await trx
        .insertInto('ticket_attachments')
        .values({
          ticket_id: ticketId,
          author_type: 'customer',
          author_id: userId,
          object_key: key,
          file_name: safeFileName(body.fileName),
          content_type: body.contentType,
          declared_size_bytes: body.sizeBytes,
          upload_expires_at: expiresAt,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await writeAudit(trx, {
        actorType: 'user',
        actorId: userId,
        action: 'ticket.attachment_requested',
        targetType: 'support_ticket',
        targetId: ticketId,
        diff: { contentType: body.contentType, sizeBytes: body.sizeBytes },
        requestId: meta.requestId,
      });
      return row.id;
    });
    const signed = this.storage.signUpload(key, {
      contentType: body.contentType,
      maxBytes: body.sizeBytes,
      expiresAt,
    });
    return {
      id,
      uploadUrl: signed.url,
      method: 'PUT' as const,
      headers: signed.headers,
      maxBytes: body.sizeBytes,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async completeAttachment(
    userId: string,
    ticketId: string,
    attachmentId: string,
    meta: RequestMeta,
  ) {
    const att = await this.db
      .selectFrom('ticket_attachments as a')
      .innerJoin('support_tickets as t', 't.id', 'a.ticket_id')
      .selectAll('a')
      .where('a.id', '=', attachmentId)
      .where('a.ticket_id', '=', ticketId)
      .where('t.user_id', '=', userId)
      .executeTakeFirst();
    if (!att) throw notFound();
    if (att.status !== 'pending_upload') return this.getForUser(userId, ticketId);
    const now = this.clock.now();
    if (att.upload_expires_at.getTime() < now.getTime()) {
      await this.storage.delete(att.object_key);
      throw new ApiError(
        HttpStatus.CONFLICT,
        'UPLOAD_EXPIRED',
        'The upload link expired. Start the upload again.',
      );
    }
    const result = await verifyStoredUpload(this.storage, this.scanner, att.object_key, {
      contentType: att.content_type,
      maxBytes: Math.min(att.declared_size_bytes, DOCUMENT_MAX_BYTES),
    });
    if (!result.ok && result.reason === 'missing') throw uploadFailure('missing');
    await this.db.transaction().execute(async (trx) => {
      const current = await trx
        .selectFrom('ticket_attachments')
        .select('status')
        .where('id', '=', attachmentId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (current.status !== 'pending_upload') return;
      await trx
        .updateTable('ticket_attachments')
        .set(
          result.ok
            ? { status: 'clean', size_bytes: result.size, sha256: result.sha256, uploaded_at: now }
            : {
                status: result.reason === 'malware' ? 'infected' : 'rejected',
                rejection_reason: result.reason as 'malware',
                uploaded_at: now,
              },
        )
        .where('id', '=', attachmentId)
        .execute();
      await writeAudit(trx, {
        actorType: 'user',
        actorId: userId,
        action: result.ok ? 'ticket.attachment_uploaded' : 'ticket.attachment_rejected',
        targetType: 'support_ticket',
        targetId: ticketId,
        diff: result.ok ? { sizeBytes: result.size } : { reason: result.reason },
        requestId: meta.requestId,
      });
    });
    if (!result.ok) throw uploadFailure(result.reason);
    return this.getForUser(userId, ticketId);
  }

  /**
   * A five-minute download link for a clean attachment: the ticket's customer or an admin with
   * `support.handle`. Admin reads are audited.
   */
  async attachmentDownload(
    who: { userId: string } | { adminId: string },
    ticketId: string,
    attachmentId: string,
    meta: RequestMeta,
  ) {
    let q = this.db
      .selectFrom('ticket_attachments as a')
      .innerJoin('support_tickets as t', 't.id', 'a.ticket_id')
      .select(['a.id', 'a.object_key', 'a.file_name'])
      .where('a.id', '=', attachmentId)
      .where('a.ticket_id', '=', ticketId)
      .where('a.status', '=', 'clean');
    if ('userId' in who) q = q.where('t.user_id', '=', who.userId);
    const att = await q.executeTakeFirst();
    if (!att) throw notFound();
    if ('adminId' in who) {
      await writeAudit(this.db, {
        actorType: 'admin',
        actorId: who.adminId,
        action: 'ticket.attachment_viewed',
        targetType: 'support_ticket',
        targetId: ticketId,
        requestId: meta.requestId,
      });
    }
    const signed = this.storage.signDownload(att.object_key, {
      expiresAt: addSeconds(this.clock.now(), DOWNLOAD_URL_TTL_SECONDS),
      fileName: att.file_name,
      disposition: 'attachment',
    });
    return { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
  }

  private async attachments(ticketId: string): Promise<TicketView['attachments']> {
    const rows = await this.db
      .selectFrom('ticket_attachments')
      .select(['id', 'file_name', 'content_type', 'size_bytes', 'author_type', 'created_at'])
      .where('ticket_id', '=', ticketId)
      .where('status', '=', 'clean')
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      fileName: r.file_name,
      contentType: r.content_type,
      sizeBytes: r.size_bytes ?? 0,
      author: r.author_type === 'admin' ? 'support' : 'customer',
      createdAt: r.created_at.toISOString(),
    }));
  }

  private async lock(trx: Trx, ticketId: string, userId?: string) {
    let q = trx
      .selectFrom('support_tickets')
      .select([
        'id',
        'status',
        'user_id',
        'assigned_admin_id',
        'priority',
        'escalation',
        'first_response_at',
      ])
      .where('id', '=', ticketId);
    if (userId) q = q.where('user_id', '=', userId);
    const t = await q.forUpdate().executeTakeFirst();
    if (!t) throw notFound();
    return t;
  }

  private adminBase() {
    return this.db
      .selectFrom('support_tickets as t')
      .innerJoin('users as u', 'u.id', 't.user_id')
      .leftJoin('admin_accounts as a', 'a.id', 't.assigned_admin_id')
      .select([
        't.id',
        't.type',
        't.order_id',
        't.booking_id',
        't.subject',
        't.status',
        't.created_at',
        't.last_message_at',
        't.sla_due_at',
        't.priority',
        't.escalation',
        't.escalated_at',
        't.first_response_at',
        't.user_id',
        't.assigned_admin_id',
        'u.display_name as user_name',
        'u.email',
        'u.phone',
        'a.display_name as admin_name',
        // Overdue: still waiting for support after the SLA. Awaiting the customer is not overdue.
      ]);
  }
}

function adminHead(
  t: {
    id: string;
    type: TicketView['type'];
    order_id: string | null;
    booking_id: string | null;
    subject: string;
    status: TicketView['status'];
    created_at: Date;
    last_message_at: Date;
    sla_due_at: Date;
    priority: TicketPriority;
    escalation: 'payment' | 'security' | 'operations' | null;
    escalated_at: Date | null;
    first_response_at: Date | null;
    user_id: string;
    assigned_admin_id: string | null;
    user_name: string | null;
    email: string | null;
    phone: string | null;
    admin_name: string | null;
  },
  now: Date,
) {
  return {
    id: t.id,
    type: t.type,
    orderId: t.order_id,
    bookingId: t.booking_id,
    subject: t.subject,
    status: t.status,
    priority: t.priority,
    createdAt: t.created_at.toISOString(),
    lastMessageAt: t.last_message_at.toISOString(),
    customer: { id: t.user_id, name: t.user_name, contact: t.email ?? t.phone ?? '' },
    assignedTo:
      t.assigned_admin_id && t.admin_name ? { id: t.assigned_admin_id, name: t.admin_name } : null,
    slaDueAt: t.sla_due_at.toISOString(),
    overdue: ['open', 'assigned', 'reopened'].includes(t.status) && t.sla_due_at < now,
    escalation: t.escalation,
    escalatedAt: t.escalated_at?.toISOString() ?? null,
    firstResponseAt: t.first_response_at?.toISOString() ?? null,
  };
}
