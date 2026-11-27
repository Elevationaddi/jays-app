import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  AdminProductDetail,
  AdminProductListQuery,
  ProductActionRequest,
} from '@jays/contracts';
import type { Database, Db } from '@jays/db';
import { canApplyProductAction, PRODUCT_ACTIONS_REQUIRING_REASON } from '@jays/domain';
import { type Expression, type SqlBool, sql, type Transaction } from 'kysely';
import { writeAudit } from '../common/audit.js';
import { CLOCK, type Clock } from '../common/clock.js';
import { ApiError } from '../common/error.filter.js';
import { afterCursor, cursorTs, decodeCursor, toPage } from '../common/pagination.js';
import type { RequestMeta } from '../common/request-context.js';
import { DB } from '../common/tokens.js';
import { draftMediaIds, merchantProductView, notFound, policy } from '../catalog/product-views.js';
import { OBJECT_STORAGE, type ObjectStorage } from '../storage/storage.js';

type Trx = Transaction<Database>;
type Localized = { en: string; ar: string };

/**
 * Listing review (docs/04-admin.md: /admin/products). Typed actions with a version precondition,
 * a row lock, an audit entry with before/after and reason, and an outbox event. Approval copies
 * the draft to the live columns; nothing is public before that.
 */
@Injectable()
export class AdminProductsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async list(query: AdminProductListQuery) {
    const cursor = decodeCursor(query.cursor);
    let q = this.db
      .selectFrom('products as p')
      .innerJoin('businesses as b', 'b.id', 'p.business_id')
      .select([
        'p.id',
        'p.status',
        'p.title',
        'p.changes_submitted_at',
        'p.submitted_at',
        'p.version',
        'p.created_at',
        'b.id as business_id',
        'b.display_name',
      ])
      .select(cursorTs('p.created_at').as('cursor_ts'));
    if (query.status === 'pending') {
      q = q.where((eb) =>
        eb.or([eb('p.status', '=', 'submitted'), eb('p.changes_submitted_at', 'is not', null)]),
      );
    } else if (query.status !== 'all') {
      q = q.where('p.status', '=', query.status);
    }
    if (cursor) q = q.where(afterCursor('p.created_at', 'p.id', cursor) as Expression<SqlBool>);
    const rows = await q
      .orderBy('p.created_at')
      .orderBy('p.id')
      .limit(query.limit + 1)
      .execute();
    return toPage(rows, query.limit, (r) => ({
      id: r.id,
      business: { id: r.business_id, name: r.display_name },
      status: r.status,
      title: r.title,
      changesPending: r.changes_submitted_at !== null,
      submittedAt: r.submitted_at?.toISOString() ?? null,
      version: r.version,
      createdAt: r.created_at.toISOString(),
    }));
  }

  async detail(productId: string): Promise<AdminProductDetail> {
    const view = await merchantProductView(this.db, this.storage, this.clock.now(), productId);
    const [business, history] = await Promise.all([
      this.db
        .selectFrom('products as p')
        .innerJoin('businesses as b', 'b.id', 'p.business_id')
        .select(['b.id', 'b.display_name', 'b.status'])
        .where('p.id', '=', productId)
        .executeTakeFirstOrThrow(),
      this.db
        .selectFrom('audit_logs')
        .select(['id', 'action', 'actor_type', 'reason', 'created_at'])
        .where('target_type', '=', 'product')
        .where('target_id', '=', productId)
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .limit(50)
        .execute(),
    ]);
    return {
      ...view,
      business: { id: business.id, name: business.display_name, status: business.status },
      history: history.map((h) => ({
        id: h.id,
        action: h.action,
        actorType: h.actor_type,
        reason: h.reason,
        createdAt: h.created_at.toISOString(),
      })),
    };
  }

  async act(
    adminId: string,
    productId: string,
    body: ProductActionRequest,
    meta: RequestMeta,
  ): Promise<AdminProductDetail> {
    if (PRODUCT_ACTIONS_REQUIRING_REASON.includes(body.action) && !body.reason) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'A reason is required.', {
        reason: ['is required for this action'],
      });
    }
    const now = this.clock.now();
    await this.db.transaction().execute(async (trx) => {
      const p = await trx
        .selectFrom('products')
        .selectAll()
        .where('id', '=', productId)
        .forUpdate()
        .executeTakeFirst();
      if (!p) throw notFound();
      if (p.version !== body.expectedVersion) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'VERSION_CONFLICT',
          'This listing changed since you loaded it. Reload and review again.',
        );
      }
      const changesPending = p.changes_submitted_at !== null;
      if (!canApplyProductAction(p.status, changesPending, body.action)) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'INVALID_TRANSITION',
          `This action is not possible while the listing is ${p.status}${changesPending ? ' with pending changes' : ''}.`,
        );
      }
      const reason = body.reason ?? null;
      let set: Record<string, unknown>;
      let event: string;
      let after = p.status;
      switch (body.action) {
        case 'approve': {
          await this.assertPublishable(trx, p.id, p.category_id);
          const mediaIds = await draftMediaIds(trx, p.id);
          after = p.status === 'submitted' ? 'active' : p.status;
          event = p.status === 'submitted' ? 'approved' : 'changes_approved';
          set = {
            status: after,
            live_title: JSON.stringify(p.title as Localized),
            live_description: JSON.stringify(p.description as Localized),
            live_details: p.details ? JSON.stringify(p.details) : null,
            live_category_id: p.category_id,
            live_brand_id: p.brand_id,
            live_return_eligible: p.return_eligible,
            live_media_ids: mediaIds,
            published_at: p.published_at ?? now,
            changes_submitted_at: null,
            reviewed_at: now,
            reviewed_by: adminId,
            review_reason: null,
          };
          break;
        }
        case 'reject':
          if (p.status === 'submitted') {
            after = 'rejected';
            event = 'rejected';
            set = {
              status: 'rejected',
              reviewed_at: now,
              reviewed_by: adminId,
              review_reason: reason,
            };
          } else {
            // Pending changes refused: the live copy stays as it was.
            event = 'changes_rejected';
            set = {
              changes_submitted_at: null,
              reviewed_at: now,
              reviewed_by: adminId,
              review_reason: reason,
            };
          }
          break;
        case 'suspend':
          after = 'suspended';
          event = 'suspended';
          set = { status: 'suspended', suspension_reason: reason };
          break;
        case 'reinstate':
          after = 'active';
          event = 'reinstated';
          set = { status: 'active', suspension_reason: null };
          break;
      }
      await trx
        .updateTable('products')
        .set({ ...set, version: sql<number>`version + 1` } as never)
        .where('id', '=', productId)
        .execute();
      await trx
        .insertInto('outbox')
        .values({
          event_type: `product.${event}`,
          payload: JSON.stringify({ productId, businessId: p.business_id, action: body.action }),
          available_at: now,
        })
        .execute();
      await writeAudit(trx, {
        actorType: 'admin',
        actorId: adminId,
        action: `product.${event}`,
        targetType: 'product',
        targetId: productId,
        businessId: p.business_id,
        reason,
        diff: { status: { before: p.status, after }, changesPending },
        requestId: meta.requestId,
      });
    });
    return this.detail(productId);
  }

  private async assertPublishable(trx: Trx, productId: string, categoryId: string) {
    const [category, variants, images] = await Promise.all([
      trx
        .selectFrom('categories')
        .select('id')
        .where('id', '=', categoryId)
        .where('status', '=', 'active')
        .executeTakeFirst(),
      trx
        .selectFrom('variants')
        .select('id')
        .where('product_id', '=', productId)
        .where('status', '=', 'active')
        .execute(),
      trx
        .selectFrom('product_media')
        .select('media_id')
        .where('product_id', '=', productId)
        .execute(),
    ]);
    const missing: string[] = [];
    if (!category) missing.push('category');
    if (variants.length === 0) missing.push('variant');
    if (images.length === 0) missing.push('image');
    if (missing.length > 0) {
      throw policy('PRODUCT_INCOMPLETE', 'The listing is missing required items.', {
        checklist: missing,
      });
    }
  }
}
