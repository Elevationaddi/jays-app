import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  AdminReview,
  AdminReviewListQuery,
  MerchantReview,
  MyReview,
  PublicReview,
  ReviewInput,
  ReviewModeration,
  ReviewSummary,
} from '@jays/contracts';
import type { Db } from '@jays/db';
import { canReview, type SuborderStatus } from '@jays/domain';
import { writeAudit } from '../common/audit.js';
import { CLOCK, type Clock } from '../common/clock.js';
import { ApiError } from '../common/error.filter.js';
import { afterCursor, cursorTs, decodeCursor, toPage } from '../common/pagination.js';
import type { RequestMeta } from '../common/request-context.js';
import { DB } from '../common/tokens.js';

type Localized = { en: string; ar: string };
type Cursor = { cursor?: string | undefined; limit: number };

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'The review was not found.');

/** Public author label: the first word of the display name, never contact details. */
const firstName = (name: string | null) => name?.trim().split(/\s+/)[0] || null;

/**
 * Reviews (docs/05-workflows.md; T10; ADR-0016). Only the customer who received a delivered item
 * or attended a completed appointment can review it, once. Merchants reply (append-only, history
 * kept) and can report a review; only admins hide or restore one, always with a reason, audited.
 */
@Injectable()
export class ReviewsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async create(userId: string, body: ReviewInput, meta: RequestMeta): Promise<MyReview> {
    const now = this.clock.now();
    const id = await this.db.transaction().execute(async (trx) => {
      let values: {
        business_id: string;
        target_type: 'product' | 'booking';
        order_item_id: string | null;
        product_id: string | null;
        booking_id: string | null;
        service_id: string | null;
      };
      if (body.orderItemId) {
        const item = await trx
          .selectFrom('order_items as oi')
          .innerJoin('orders as o', 'o.id', 'oi.order_id')
          .innerJoin('merchant_orders as mo', 'mo.id', 'oi.merchant_order_id')
          .select(['oi.id', 'oi.business_id', 'oi.product_id', 'mo.status'])
          .where('oi.id', '=', body.orderItemId)
          .where('o.user_id', '=', userId)
          .executeTakeFirst();
        if (!item) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found.');
        if (!canReview({ kind: 'order_item', suborderStatus: item.status as SuborderStatus })) {
          throw new ApiError(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'NOT_REVIEWABLE',
            'You can review an item once it has been delivered.',
          );
        }
        values = {
          business_id: item.business_id,
          target_type: 'product',
          order_item_id: item.id,
          product_id: item.product_id,
          booking_id: null,
          service_id: null,
        };
      } else {
        const booking = await trx
          .selectFrom('bookings')
          .select(['id', 'business_id', 'service_id', 'status'])
          .where('id', '=', body.bookingId!)
          .where('user_id', '=', userId)
          .executeTakeFirst();
        if (!booking) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found.');
        if (!canReview({ kind: 'booking', status: booking.status })) {
          throw new ApiError(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'NOT_REVIEWABLE',
            'You can review an appointment once it has been completed.',
          );
        }
        values = {
          business_id: booking.business_id,
          target_type: 'booking',
          order_item_id: null,
          product_id: null,
          booking_id: booking.id,
          service_id: booking.service_id,
        };
      }
      let row: { id: string };
      try {
        row = await trx
          .insertInto('reviews')
          .values({ ...values, user_id: userId, rating: body.rating, body: body.body || null })
          .returning('id')
          .executeTakeFirstOrThrow();
      } catch (error) {
        const constraint = (error as { constraint?: string }).constraint ?? '';
        if (
          constraint.startsWith('reviews_order_item_id') ||
          constraint.startsWith('reviews_booking_id')
        ) {
          throw new ApiError(
            HttpStatus.CONFLICT,
            'ALREADY_REVIEWED',
            'You have already reviewed this.',
          );
        }
        throw error;
      }
      await trx
        .insertInto('outbox')
        .values({
          event_type: 'review.created',
          payload: JSON.stringify({ reviewId: row.id, businessId: values.business_id }),
          available_at: now,
        })
        .execute();
      await writeAudit(trx, {
        actorType: 'user',
        actorId: userId,
        action: 'review.create',
        targetType: 'review',
        targetId: row.id,
        businessId: values.business_id,
        diff: { rating: body.rating },
        requestId: meta.requestId,
      });
      return row.id;
    });
    const page = await this.mine(userId, { limit: 100 }, id);
    return page.items[0]!;
  }

  async mine(userId: string, query: Cursor, onlyId?: string) {
    const key = decodeCursor(query.cursor);
    let q = this.db
      .selectFrom('reviews as r')
      .innerJoin('users as u', 'u.id', 'r.user_id')
      .innerJoin('businesses as b', 'b.id', 'r.business_id')
      .leftJoin('storefronts as sf', 'sf.business_id', 'b.id')
      .select([
        'r.id',
        'r.rating',
        'r.body',
        'r.status',
        'r.target_type',
        'r.order_item_id',
        'r.booking_id',
        'r.created_at',
        'r.business_id',
        'u.display_name',
        'b.display_name as business_name',
        'sf.live_name',
        cursorTs('r.created_at').as('cursor_ts'),
      ])
      .where('r.user_id', '=', userId);
    if (onlyId) q = q.where('r.id', '=', onlyId);
    if (key) q = q.where(afterCursor('r.created_at', 'r.id', key, 'desc'));
    const rows = await q
      .orderBy('r.created_at', 'desc')
      .orderBy('r.id', 'desc')
      .limit(query.limit + 1)
      .execute();
    const replies = await this.latestReplies(rows.map((r) => r.id));
    return toPage(rows, query.limit, (r): MyReview => ({
      id: r.id,
      rating: r.rating,
      body: r.body,
      author: firstName(r.display_name),
      reply: replies.get(r.id) ?? null,
      createdAt: r.created_at.toISOString(),
      targetType: r.target_type,
      orderItemId: r.order_item_id,
      bookingId: r.booking_id,
      business: { id: r.business_id, name: (r.live_name ?? r.business_name) as Localized },
      status: r.status,
    }));
  }

  async forProduct(productId: string, query: Cursor): Promise<ReviewSummary> {
    const product = await this.db
      .selectFrom('products as p')
      .innerJoin('businesses as b', 'b.id', 'p.business_id')
      .select('p.id')
      .where('p.id', '=', productId)
      .where('p.status', '=', 'active')
      .where('b.status', '=', 'approved')
      .executeTakeFirst();
    if (!product) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found.');
    return this.publicList({ productId }, query);
  }

  async forVenue(businessId: string, query: Cursor): Promise<ReviewSummary> {
    const business = await this.db
      .selectFrom('businesses')
      .select('id')
      .where('id', '=', businessId)
      .where('status', '=', 'approved')
      .executeTakeFirst();
    if (!business) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found.');
    return this.publicList({ businessId }, query);
  }

  /** Published reviews only; hidden ones disappear from the page and from the average. */
  private async publicList(
    scope: { productId?: string; businessId?: string },
    query: Cursor,
  ): Promise<ReviewSummary> {
    const key = decodeCursor(query.cursor);
    let base = this.db.selectFrom('reviews as r').where('r.status', '=', 'published');
    if (scope.productId) base = base.where('r.product_id', '=', scope.productId);
    if (scope.businessId) {
      base = base
        .where('r.business_id', '=', scope.businessId)
        .where('r.target_type', '=', 'booking');
    }
    let q = base
      .innerJoin('users as u', 'u.id', 'r.user_id')
      .select([
        'r.id',
        'r.rating',
        'r.body',
        'r.created_at',
        'u.display_name',
        cursorTs('r.created_at').as('cursor_ts'),
      ]);
    if (key) q = q.where(afterCursor('r.created_at', 'r.id', key, 'desc'));
    const [rows, stats] = await Promise.all([
      q
        .orderBy('r.created_at', 'desc')
        .orderBy('r.id', 'desc')
        .limit(query.limit + 1)
        .execute(),
      base
        .select((eb) => [
          eb.fn.avg<string>('r.rating').as('average'),
          eb.fn.countAll<string>().as('count'),
        ])
        .executeTakeFirstOrThrow(),
    ]);
    const replies = await this.latestReplies(rows.map((r) => r.id));
    const page = toPage(rows, query.limit, (r): PublicReview => ({
      id: r.id,
      rating: r.rating,
      body: r.body,
      author: firstName(r.display_name),
      reply: replies.get(r.id) ?? null,
      createdAt: r.created_at.toISOString(),
    }));
    const count = Number(stats.count);
    return {
      average: count === 0 ? null : Math.round(Number(stats.average) * 10) / 10,
      count,
      ...page,
    };
  }

  private async latestReplies(ids: string[]) {
    const map = new Map<string, { body: string; at: string }>();
    if (ids.length === 0) return map;
    const rows = await this.db
      .selectFrom('review_replies')
      .select(['review_id', 'body', 'created_at'])
      .where('review_id', 'in', ids)
      .orderBy('created_at')
      .execute();
    for (const r of rows) map.set(r.review_id, { body: r.body, at: r.created_at.toISOString() });
    return map;
  }

  // Merchant ---------------------------------------------------------------------------------------

  async listForBusiness(businessId: string, query: Cursor) {
    const key = decodeCursor(query.cursor);
    let q = this.db
      .selectFrom('reviews as r')
      .select(['r.id', cursorTs('r.created_at').as('cursor_ts')])
      .where('r.business_id', '=', businessId);
    if (key) q = q.where(afterCursor('r.created_at', 'r.id', key, 'desc'));
    const rows = await q
      .orderBy('r.created_at', 'desc')
      .orderBy('r.id', 'desc')
      .limit(query.limit + 1)
      .execute();
    const page = toPage(rows, query.limit, (r) => r.id);
    const views = await this.adminViews(page.items);
    return { items: views.map(toMerchant), nextCursor: page.nextCursor };
  }

  async reply(
    businessId: string,
    userId: string,
    reviewId: string,
    text: string,
    meta: RequestMeta,
  ): Promise<MerchantReview> {
    const now = this.clock.now();
    await this.db.transaction().execute(async (trx) => {
      const review = await trx
        .selectFrom('reviews')
        .select(['id', 'user_id'])
        .where('id', '=', reviewId)
        .where('business_id', '=', businessId)
        .executeTakeFirst();
      if (!review) throw notFound();
      const reply = await trx
        .insertInto('review_replies')
        .values({ review_id: review.id, author_id: userId, body: text })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('outbox')
        .values({
          event_type: 'review.replied',
          payload: JSON.stringify({ reviewId: review.id, userId: review.user_id, businessId }),
          available_at: now,
        })
        .execute();
      await writeAudit(trx, {
        actorType: 'user',
        actorId: userId,
        action: 'review.reply',
        targetType: 'review',
        targetId: review.id,
        businessId,
        diff: { replyId: reply.id },
        requestId: meta.requestId,
      });
    });
    return this.getForBusiness(businessId, reviewId);
  }

  async report(
    businessId: string,
    userId: string,
    reviewId: string,
    reason: string,
    meta: RequestMeta,
  ): Promise<MerchantReview> {
    await this.db.transaction().execute(async (trx) => {
      const review = await trx
        .selectFrom('reviews')
        .select('id')
        .where('id', '=', reviewId)
        .where('business_id', '=', businessId)
        .executeTakeFirst();
      if (!review) throw notFound();
      try {
        await trx
          .insertInto('review_reports')
          .values({ review_id: review.id, business_id: businessId, reported_by: userId, reason })
          .execute();
      } catch (error) {
        if ((error as { code?: string }).code === '23505') {
          throw new ApiError(
            HttpStatus.CONFLICT,
            'ALREADY_REPORTED',
            'This review is already waiting for moderation.',
          );
        }
        throw error;
      }
      await writeAudit(trx, {
        actorType: 'user',
        actorId: userId,
        action: 'review.report',
        targetType: 'review',
        targetId: review.id,
        businessId,
        reason,
        requestId: meta.requestId,
      });
    });
    return this.getForBusiness(businessId, reviewId);
  }

  async getForBusiness(businessId: string, reviewId: string): Promise<MerchantReview> {
    const row = await this.db
      .selectFrom('reviews')
      .select('id')
      .where('id', '=', reviewId)
      .where('business_id', '=', businessId)
      .executeTakeFirst();
    if (!row) throw notFound();
    const [view] = await this.adminViews([row.id]);
    return toMerchant(view!);
  }

  // Admin ------------------------------------------------------------------------------------------

  async adminList(query: AdminReviewListQuery) {
    const key = decodeCursor(query.cursor);
    let q = this.db
      .selectFrom('reviews as r')
      .select(['r.id', cursorTs('r.created_at').as('cursor_ts')]);
    if (query.filter === 'reported') {
      q = q.where(({ exists, selectFrom }) =>
        exists(
          selectFrom('review_reports as rp')
            .select('rp.id')
            .whereRef('rp.review_id', '=', 'r.id')
            .where('rp.resolved_at', 'is', null),
        ),
      );
    }
    if (query.filter === 'hidden') q = q.where('r.status', '=', 'hidden');
    if (key) q = q.where(afterCursor('r.created_at', 'r.id', key, 'desc'));
    const rows = await q
      .orderBy('r.created_at', 'desc')
      .orderBy('r.id', 'desc')
      .limit(query.limit + 1)
      .execute();
    const page = toPage(rows, query.limit, (r) => r.id);
    return { items: await this.adminViews(page.items), nextCursor: page.nextCursor };
  }

  async moderate(
    adminId: string,
    reviewId: string,
    body: ReviewModeration,
    meta: RequestMeta,
  ): Promise<AdminReview> {
    const now = this.clock.now();
    await this.db.transaction().execute(async (trx) => {
      const review = await trx
        .selectFrom('reviews')
        .select(['id', 'status', 'business_id'])
        .where('id', '=', reviewId)
        .forUpdate()
        .executeTakeFirst();
      if (!review) throw notFound();
      if (body.action === 'hide' && review.status === 'hidden') {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'INVALID_TRANSITION',
          'The review is already hidden.',
        );
      }
      if (body.action === 'restore' && review.status === 'published') {
        throw new ApiError(HttpStatus.CONFLICT, 'INVALID_TRANSITION', 'The review is not hidden.');
      }
      if (body.action !== 'dismiss_report') {
        await trx
          .updateTable('reviews')
          .set(
            body.action === 'hide'
              ? { status: 'hidden', hidden_reason: body.reason }
              : { status: 'published', hidden_reason: null },
          )
          .where('id', '=', review.id)
          .execute();
      }
      // Any decision closes the open report: hiding upholds it, restoring or dismissing rejects it.
      const resolved = await trx
        .updateTable('review_reports')
        .set({ resolved_at: now, resolved_by: adminId })
        .where('review_id', '=', review.id)
        .where('resolved_at', 'is', null)
        .returning('id')
        .execute();
      if (body.action === 'dismiss_report' && resolved.length === 0) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'NO_OPEN_REPORT',
          'There is no open report to dismiss.',
        );
      }
      await writeAudit(trx, {
        actorType: 'admin',
        actorId: adminId,
        action: `review.${body.action}`,
        targetType: 'review',
        targetId: review.id,
        businessId: review.business_id,
        reason: body.reason,
        diff: { from: review.status },
        requestId: meta.requestId,
      });
    });
    const [view] = await this.adminViews([reviewId]);
    return view!;
  }

  private async adminViews(ids: string[]): Promise<AdminReview[]> {
    if (ids.length === 0) return [];
    const [rows, replies, reports] = await Promise.all([
      this.db
        .selectFrom('reviews as r')
        .innerJoin('users as u', 'u.id', 'r.user_id')
        .innerJoin('businesses as b', 'b.id', 'r.business_id')
        .leftJoin('storefronts as sf', 'sf.business_id', 'b.id')
        .leftJoin('order_items as oi', 'oi.id', 'r.order_item_id')
        .leftJoin('services as s', 's.id', 'r.service_id')
        .select([
          'r.id',
          'r.target_type',
          'r.rating',
          'r.body',
          'r.status',
          'r.hidden_reason',
          'r.created_at',
          'r.business_id',
          'u.display_name',
          'b.display_name as business_name',
          'sf.live_name',
          'oi.snapshot',
          's.title as service_title',
        ])
        .where('r.id', 'in', ids)
        .execute(),
      this.db
        .selectFrom('review_replies')
        .select(['review_id', 'body', 'created_at'])
        .where('review_id', 'in', ids)
        .orderBy('created_at')
        .execute(),
      this.db
        .selectFrom('review_reports')
        .select(['id', 'review_id', 'reason', 'created_at', 'resolved_at'])
        .where('review_id', 'in', ids)
        .orderBy('created_at', 'desc')
        .execute(),
    ]);
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => {
      const r = byId.get(id)!;
      const report = reports.find((p) => p.review_id === id) ?? null;
      const subject =
        r.target_type === 'product'
          ? (r.snapshot as { title: Localized }).title
          : (r.service_title as Localized);
      return {
        id: r.id,
        targetType: r.target_type,
        subject,
        rating: r.rating,
        body: r.body,
        author: firstName(r.display_name),
        status: r.status,
        replies: replies
          .filter((p) => p.review_id === id)
          .map((p) => ({ body: p.body, at: p.created_at.toISOString() })),
        reported: !!report && report.resolved_at === null,
        createdAt: r.created_at.toISOString(),
        business: { id: r.business_id, name: (r.live_name ?? r.business_name) as Localized },
        hiddenReason: r.hidden_reason,
        report: report
          ? {
              id: report.id,
              reason: report.reason,
              at: report.created_at.toISOString(),
              resolvedAt: report.resolved_at?.toISOString() ?? null,
            }
          : null,
      };
    });
  }
}

function toMerchant(r: AdminReview): MerchantReview {
  return {
    id: r.id,
    targetType: r.targetType,
    subject: r.subject,
    rating: r.rating,
    body: r.body,
    author: r.author,
    status: r.status,
    replies: r.replies,
    reported: r.reported,
    createdAt: r.createdAt,
  };
}
