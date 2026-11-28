import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { NotificationTemplateView } from '@jays/contracts';
import type { Db } from '@jays/db';
import {
  hasBusinessCapability,
  NOTIFICATION_MAX_ATTEMPTS,
  renderTemplate,
  retryDelayMs,
  templatePlaceholders,
} from '@jays/domain';
import { sql } from 'kysely';
import type { Notifier } from '../auth/notifier.js';
import { writeAudit } from '../common/audit.js';
import { CLOCK, type Clock } from '../common/clock.js';
import { ApiError } from '../common/error.filter.js';
import { afterCursor, cursorTs, decodeCursor, toPage } from '../common/pagination.js';
import type { RequestMeta } from '../common/request-context.js';
import { DB, NOTIFIER } from '../common/tokens.js';
import { API_ENV, type ApiEnv } from '../config.js';

type Localized = { en: string; ar: string };
type Locale = 'en' | 'ar';

interface Recipient {
  userId: string;
  locale: Locale;
  email: string | null;
  link: string | null;
}

interface Prepared {
  recipients: Recipient[];
  params: Record<string, string>;
}

const NIL = '00000000-0000-0000-0000-000000000000';
const ref = (id: string) => id.slice(0, 8).toUpperCase();
const aed = (fils: number) => `AED ${(fils / 100).toFixed(2)}`;
const dubaiTime = (d: Date, locale: Locale) =>
  new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Dubai',
  }).format(d);

/**
 * Notifications (docs/05-workflows.md; T12; ADR-0016). The dispatcher reads committed outbox
 * events, finds who should hear about each one, renders the newest template in the recipient's
 * language, stores an in-app notification and emails verified addresses. Each recipient gets at
 * most one in-app record and one email per event (unique keys), so a retry after a partial
 * failure only sends what is missing. Failures back off exponentially; after the last attempt
 * the event is marked failed and shows on the admin outbox health card.
 */
@Injectable()
export class NotificationsService {
  private readonly log = new Logger(NotificationsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(NOTIFIER) private readonly notifier: Notifier,
  ) {}

  /**
   * Processes up to `limit` due events and returns how many were handled (sent, retried or
   * failed). `onlyIds` limits the run to some events (tests and support tooling).
   */
  async dispatch(limit = 50, onlyIds?: string[]): Promise<number> {
    let handled = 0;
    for (; handled < limit; handled += 1) {
      const now = this.clock.now();
      const row = await this.db.transaction().execute(async (trx) => {
        const r = await trx
          .selectFrom('outbox')
          .select(['id', 'event_type', 'payload', 'attempts'])
          .where((eb) =>
            eb.or([
              eb.and([eb('status', '=', 'pending'), eb('available_at', '<=', now)]),
              // A dispatcher that died mid-event leaves it processing; take it over later.
              eb.and([
                eb('status', '=', 'processing'),
                eb('updated_at', '<', sql<Date>`now() - interval '10 minutes'`),
              ]),
            ]),
          )
          .$if(!!onlyIds, (qb) => qb.where('id', 'in', onlyIds?.length ? onlyIds : [NIL]))
          .orderBy('available_at')
          .orderBy('id')
          .limit(1)
          .forUpdate()
          .skipLocked()
          .executeTakeFirst();
        if (!r) return null;
        await trx
          .updateTable('outbox')
          .set({ status: 'processing', attempts: r.attempts + 1 })
          .where('id', '=', r.id)
          .execute();
        return { ...r, attempts: r.attempts + 1 };
      });
      if (!row) break;
      try {
        await this.deliver(row.id, row.event_type, row.payload as Record<string, unknown>);
        await this.db
          .updateTable('outbox')
          .set({ status: 'sent', last_error: null })
          .where('id', '=', row.id)
          .execute();
      } catch (error) {
        const failed = row.attempts >= NOTIFICATION_MAX_ATTEMPTS;
        this.log.warn({ err: error, outboxId: row.id, attempts: row.attempts }, 'delivery failed');
        await this.db
          .updateTable('outbox')
          .set({
            status: failed ? 'failed' : 'pending',
            available_at: new Date(now.getTime() + retryDelayMs(row.attempts)),
            last_error: String((error as Error).message ?? error).slice(0, 500),
          })
          .where('id', '=', row.id)
          .execute();
      }
    }
    return handled;
  }

  private async deliver(outboxId: string, eventType: string, payload: Record<string, unknown>) {
    const prepared = await this.prepare(eventType, payload);
    if (!prepared || prepared.recipients.length === 0) return;
    const templates = await this.latestTemplates(eventType);
    for (const r of prepared.recipients) {
      const t = templates.get(r.locale) ?? templates.get('en');
      if (!t) return; // No template for this event: nothing to say.
      const title = renderTemplate(t.title, prepared.params);
      const body = renderTemplate(t.body, prepared.params);
      await this.db
        .insertInto('notifications')
        .values({
          user_id: r.userId,
          outbox_id: outboxId,
          event_type: eventType,
          title,
          body,
          link: r.link,
        })
        .onConflict((oc) => oc.columns(['outbox_id', 'user_id']).doNothing())
        .execute();
      if (!r.email) continue;
      const sent = await this.db
        .selectFrom('notification_deliveries')
        .select('id')
        .where('outbox_id', '=', outboxId)
        .where('user_id', '=', r.userId)
        .where('channel', '=', 'email')
        .executeTakeFirst();
      if (sent) continue;
      await this.notifier.send({
        channel: 'email',
        to: r.email,
        template: 'notification',
        locale: r.locale,
        params: { title, body },
      });
      await this.db
        .insertInto('notification_deliveries')
        .values({ outbox_id: outboxId, user_id: r.userId, channel: 'email' })
        .onConflict((oc) => oc.columns(['outbox_id', 'user_id', 'channel']).doNothing())
        .execute();
    }
  }

  /** Who hears about an event, and the values its template can use. */
  private async prepare(eventType: string, p: Record<string, unknown>): Promise<Prepared | null> {
    const str = (k: string) => (typeof p[k] === 'string' ? (p[k] as string) : null);
    switch (eventType) {
      case 'order.paid': {
        const order = await this.db
          .selectFrom('orders')
          .select(['id', 'user_id', 'total_fils'])
          .where('id', '=', str('orderId') ?? '')
          .executeTakeFirst();
        if (!order) return null;
        return {
          recipients: await this.users([order.user_id], `/orders/${order.id}`),
          params: { ref: ref(order.id), amount: aed(order.total_fils) },
        };
      }
      case 'order.shipped':
      case 'order.delivered':
      case 'order.canceled': {
        const mo = await this.suborder(str('merchantOrderId'));
        if (!mo) return null;
        return {
          recipients: await this.users([mo.user_id], `/orders/${mo.order_id}`),
          params: {
            ref: ref(mo.order_id),
            amount: aed(mo.total_fils),
            business: mo.business,
            carrier: mo.carrier ?? '',
            tracking: mo.tracking_number ?? '',
            reason: mo.cancel_reason ?? '',
          },
        };
      }
      case 'return.requested':
      case 'return.approved':
      case 'return.rejected':
      case 'return.refunded': {
        const rr = await this.db
          .selectFrom('return_requests')
          .select(['id', 'order_id', 'business_id', 'user_id', 'amount_fils', 'decision_reason'])
          .where('id', '=', str('returnId') ?? '')
          .executeTakeFirst();
        if (!rr) return null;
        const mo = await this.suborder(str('merchantOrderId'));
        const params = {
          ref: ref(rr.order_id),
          amount: aed(rr.amount_fils),
          business: mo?.business ?? '',
          reason: rr.decision_reason ?? '',
        };
        if (eventType === 'return.requested') {
          return {
            recipients: await this.members(
              rr.business_id,
              'returns.manage',
              `/business/${rr.business_id}/returns`,
            ),
            params,
          };
        }
        return { recipients: await this.users([rr.user_id], `/orders/${rr.order_id}`), params };
      }
      case 'booking.confirmed':
      case 'booking.canceled':
      case 'booking.rescheduled': {
        const b = await this.db
          .selectFrom('bookings as bk')
          .innerJoin('businesses as b', 'b.id', 'bk.business_id')
          .leftJoin('storefronts as sf', 'sf.business_id', 'b.id')
          .select(['bk.id', 'bk.user_id', 'bk.start_at', 'b.display_name', 'sf.live_name'])
          .where('bk.id', '=', str('bookingId') ?? '')
          .executeTakeFirst();
        if (!b?.user_id) return null;
        const recipients = await this.users([b.user_id], `/bookings/${b.id}`);
        const name = (b.live_name ?? b.display_name) as Localized;
        return {
          recipients,
          params: {
            business: name.en,
            ref: ref(b.id),
            when: dubaiTime(b.start_at, recipients[0]?.locale ?? 'en'),
          },
        };
      }
      case 'ticket.replied': {
        const t = await this.db
          .selectFrom('support_tickets')
          .select(['id', 'user_id', 'subject'])
          .where('id', '=', str('ticketId') ?? '')
          .executeTakeFirst();
        if (!t) return null;
        return {
          recipients: await this.users([t.user_id], `/support/${t.id}`),
          params: { subject: t.subject },
        };
      }
      case 'review.replied': {
        const r = await this.db
          .selectFrom('reviews as r')
          .innerJoin('businesses as b', 'b.id', 'r.business_id')
          .leftJoin('storefronts as sf', 'sf.business_id', 'b.id')
          .select(['r.user_id', 'b.display_name', 'sf.live_name'])
          .where('r.id', '=', str('reviewId') ?? '')
          .executeTakeFirst();
        if (!r) return null;
        return {
          recipients: await this.users([r.user_id], '/reviews'),
          params: { business: ((r.live_name ?? r.display_name) as Localized).en },
        };
      }
      case 'product.back_in_stock': {
        const v = await this.db
          .selectFrom('variants as v')
          .innerJoin('products as p', 'p.id', 'v.product_id')
          .select(['v.name', 'p.id', 'p.live_title', 'p.status'])
          .where('v.id', '=', str('variantId') ?? '')
          .executeTakeFirst();
        const userId = str('userId');
        // Only a product still on sale is announced.
        if (!v || !userId || v.status !== 'active' || !v.live_title) return null;
        const recipients = await this.users([userId], `/products/${v.id}`);
        const locale = recipients[0]?.locale ?? 'en';
        return {
          recipients,
          params: {
            product: (v.live_title as Localized)[locale],
            variant: (v.name as Localized)[locale],
          },
        };
      }
      default:
        return null; // Internal events (payment.*, merchant_order.paid ...) notify no one.
    }
  }

  private async suborder(id: string | null) {
    if (!id) return null;
    const mo = await this.db
      .selectFrom('merchant_orders as mo')
      .innerJoin('orders as o', 'o.id', 'mo.order_id')
      .innerJoin('businesses as b', 'b.id', 'mo.business_id')
      .leftJoin('storefronts as sf', 'sf.business_id', 'b.id')
      .select([
        'mo.order_id',
        'mo.total_fils',
        'mo.carrier',
        'mo.tracking_number',
        'mo.cancel_reason',
        'o.user_id',
        'b.display_name',
        'sf.live_name',
      ])
      .where('mo.id', '=', id)
      .executeTakeFirst();
    if (!mo) return null;
    return { ...mo, business: ((mo.live_name ?? mo.display_name) as Localized).en };
  }

  private async users(ids: string[], link: string | null): Promise<Recipient[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .selectFrom('users')
      .select(['id', 'locale', 'email', 'email_verified_at', 'status', 'notify_email'])
      .where('id', 'in', ids)
      .execute();
    return rows
      .filter((u) => u.status === 'active')
      .map((u) => ({
        userId: u.id,
        locale: u.locale,
        // In-app always; email only to a verified address the person has not switched off (D14).
        email: u.email_verified_at && u.notify_email ? u.email : null,
        link,
      }));
  }

  private async members(businessId: string, capability: 'returns.manage', link: string) {
    const rows = await this.db
      .selectFrom('memberships')
      .select(['user_id', 'permissions'])
      .where('business_id', '=', businessId)
      .where('status', '=', 'active')
      .execute();
    return this.users(
      rows.filter((m) => hasBusinessCapability(m.permissions, capability)).map((m) => m.user_id),
      link,
    );
  }

  private async latestTemplates(eventType: string) {
    const rows = await this.db
      .selectFrom('notification_templates')
      .select(['locale', 'title', 'body', 'version'])
      .where('event_type', '=', eventType)
      .orderBy('version', 'desc')
      .execute();
    const map = new Map<Locale, { title: string; body: string }>();
    for (const r of rows) if (!map.has(r.locale)) map.set(r.locale, r);
    return map;
  }

  // Customer ---------------------------------------------------------------------------------------

  async list(userId: string, query: { cursor?: string | undefined; limit: number }) {
    const key = decodeCursor(query.cursor);
    let q = this.db
      .selectFrom('notifications')
      .select([
        'id',
        'event_type',
        'title',
        'body',
        'link',
        'read_at',
        'created_at',
        cursorTs('created_at').as('cursor_ts'),
      ])
      .where('user_id', '=', userId);
    if (key) q = q.where(afterCursor('created_at', 'id', key, 'desc'));
    const [rows, unread] = await Promise.all([
      q
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .limit(query.limit + 1)
        .execute(),
      this.db
        .selectFrom('notifications')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('user_id', '=', userId)
        .where('read_at', 'is', null)
        .executeTakeFirstOrThrow(),
    ]);
    return {
      ...toPage(rows, query.limit, (n) => ({
        id: n.id,
        eventType: n.event_type,
        title: n.title,
        body: n.body,
        link: n.link,
        readAt: n.read_at?.toISOString() ?? null,
        createdAt: n.created_at.toISOString(),
      })),
      unread: Number(unread.n),
    };
  }

  async markRead(userId: string, ids: string[] | undefined) {
    let q = this.db
      .updateTable('notifications')
      .set({ read_at: this.clock.now() })
      .where('user_id', '=', userId)
      .where('read_at', 'is', null);
    if (ids) q = q.where('id', 'in', ids.length ? ids : [NIL]);
    await q.execute();
    return this.list(userId, { limit: 20 });
  }

  // Admin ------------------------------------------------------------------------------------------

  async templates(): Promise<NotificationTemplateView[]> {
    const rows = await this.db
      .selectFrom('notification_templates as t')
      .leftJoin('admin_accounts as a', 'a.id', 't.created_by')
      .select([
        't.event_type',
        't.locale',
        't.version',
        't.title',
        't.body',
        't.created_at',
        't.created_by',
        'a.display_name',
      ])
      .orderBy('t.event_type')
      .orderBy('t.locale')
      .orderBy('t.version', 'desc')
      .execute();
    const seen = new Set<string>();
    const out: NotificationTemplateView[] = [];
    for (const r of rows) {
      const k = `${r.event_type}/${r.locale}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({
        eventType: r.event_type,
        locale: r.locale,
        version: r.version,
        title: r.title,
        body: r.body,
        placeholders: templatePlaceholders(`${r.title} ${r.body}`),
        updatedBy:
          r.created_by && r.display_name ? { id: r.created_by, name: r.display_name } : null,
        updatedAt: r.created_at.toISOString(),
      });
    }
    return out;
  }

  /**
   * Adds a new version of a template. Only events that already have a template can be edited, and
   * only with placeholders the first version offered, so an edit cannot ask for data the
   * dispatcher does not provide.
   */
  async createTemplate(
    adminId: string,
    body: { eventType: string; locale: Locale; title: string; body: string },
    meta: RequestMeta,
  ) {
    await this.db.transaction().execute(async (trx) => {
      await trx.executeQuery(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`template:${body.eventType}:${body.locale}`}))`.compile(
          trx,
        ),
      );
      const versions = await trx
        .selectFrom('notification_templates')
        .select(['version', 'title', 'body'])
        .where('event_type', '=', body.eventType)
        .where('locale', '=', body.locale)
        .orderBy('version', 'asc')
        .execute();
      const first = versions[0];
      if (!first) {
        throw new ApiError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'UNKNOWN_EVENT',
          'There is no notification for this event.',
        );
      }
      const allowed = new Set(templatePlaceholders(`${first.title} ${first.body}`));
      const unknown = templatePlaceholders(`${body.title} ${body.body}`).filter(
        (p) => !allowed.has(p),
      );
      if (unknown.length > 0) {
        throw new ApiError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'UNKNOWN_PLACEHOLDER',
          `These placeholders are not available for this event: ${unknown.join(', ')}.`,
        );
      }
      const version = versions[versions.length - 1]!.version + 1;
      await trx
        .insertInto('notification_templates')
        .values({
          event_type: body.eventType,
          locale: body.locale,
          version,
          title: body.title,
          body: body.body,
          created_by: adminId,
        })
        .execute();
      await writeAudit(trx, {
        actorType: 'admin',
        actorId: adminId,
        action: 'notification_template.update',
        targetType: 'notification_template',
        targetId: null,
        diff: { eventType: body.eventType, locale: body.locale, version },
        requestId: meta.requestId,
      });
    });
    return this.templates();
  }

  /** The most recent events that gave up, newest first, for the admin console. */
  async failedEvents(limit = 50) {
    const rows = await this.db
      .selectFrom('outbox')
      .select(['id', 'event_type', 'attempts', 'last_error', 'created_at', 'updated_at'])
      .where('status', '=', 'failed')
      .orderBy('updated_at', 'desc')
      .limit(limit)
      .execute();
    return rows.map((r) => ({
      id: r.id,
      eventType: r.event_type,
      attempts: r.attempts,
      lastError: r.last_error ? r.last_error.slice(0, 500) : null,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    }));
  }

  /**
   * Puts a failed event back in the queue with fresh attempts. Deliveries already made are recorded
   * per (event, user, channel), so the retry only sends what is still missing. Audited.
   */
  async retryFailed(adminId: string, outboxId: string, meta: RequestMeta) {
    await this.db.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom('outbox')
        .select(['status', 'event_type', 'attempts'])
        .where('id', '=', outboxId)
        .forUpdate()
        .executeTakeFirst();
      if (!row) throw new ApiError(404, 'NOT_FOUND', 'Not found.');
      if (row.status !== 'failed') {
        throw new ApiError(409, 'NOT_FAILED', 'Only a failed event can be retried.');
      }
      await trx
        .updateTable('outbox')
        .set({ status: 'pending', attempts: 0, available_at: this.clock.now() })
        .where('id', '=', outboxId)
        .execute();
      await writeAudit(trx, {
        actorType: 'admin',
        actorId: adminId,
        action: 'notification.retried',
        targetType: 'outbox',
        targetId: outboxId,
        diff: { eventType: row.event_type, attemptsBefore: row.attempts },
        requestId: meta.requestId,
      });
    });
    return this.outboxHealth();
  }

  async outboxHealth() {
    const r = await this.db
      .selectFrom('outbox')
      .select((eb) => [
        eb.fn
          .count<string>('id')
          .filterWhere('status', 'in', ['pending', 'processing'])
          .as('pending'),
        eb.fn
          .count<string>('id')
          .filterWhere((w) => w.and([w('status', '=', 'pending'), w('attempts', '>', 0)]))
          .as('retrying'),
        eb.fn.count<string>('id').filterWhere('status', '=', 'failed').as('failed'),
        eb.fn.min('created_at').filterWhere('status', 'in', ['pending', 'processing']).as('oldest'),
      ])
      .executeTakeFirstOrThrow();
    const oldest = r.oldest as Date | null;
    return {
      pending: Number(r.pending),
      retrying: Number(r.retrying),
      failed: Number(r.failed),
      oldestPendingSeconds: oldest
        ? Math.max(0, Math.floor((this.clock.now().getTime() - oldest.getTime()) / 1000))
        : null,
    };
  }
}

/**
 * Runs the dispatcher every few seconds in the API process (ADR-0016: the notifier adapter lives
 * here, like the payment adapter). Several instances are safe: rows are claimed with SKIP LOCKED.
 * Off in tests, which call `dispatch()` directly.
 */
@Injectable()
export class NotificationScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger(NotificationScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  onApplicationBootstrap() {
    if (this.env.APP_ENV === 'test') return;
    this.timer = setInterval(() => void this.tick(), 5_000);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.notifications.dispatch();
    } catch (error) {
      this.log.error({ err: error }, 'notification dispatch failed');
    } finally {
      this.running = false;
    }
  }
}
