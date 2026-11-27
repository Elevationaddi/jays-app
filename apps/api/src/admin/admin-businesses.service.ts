import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  AdminBusinessDetail,
  AdminBusinessListItem,
  AdminBusinessListQuery,
  BusinessActionRequest,
} from '@jays/contracts';
import type { Database, Db } from '@jays/db';
import {
  canApplyAction,
  DOWNLOAD_URL_TTL_SECONDS,
  licenseValid,
  type Mode,
  missingItems,
} from '@jays/domain';
import { type Expression, type SqlBool, sql, type Transaction } from 'kysely';
import { maskContact } from '../auth/crypto.js';
import { writeAudit } from '../common/audit.js';
import { addSeconds, CLOCK, type Clock } from '../common/clock.js';
import { ApiError } from '../common/error.filter.js';
import { afterCursor, cursorTs, decodeCursor, toPage } from '../common/pagination.js';
import type { RequestMeta } from '../common/request-context.js';
import { DB } from '../common/tokens.js';
import {
  legalProfile,
  loadBusinessRow,
  loadDocuments,
  loadModes,
  modeReviews,
  onboardingChecklist,
  onboardingFacts,
  storefrontView,
} from '../onboarding/views.js';
import { OBJECT_STORAGE, type ObjectStorage } from '../storage/storage.js';

type Trx = Transaction<Database>;
type Localized = { en: string; ar: string };

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found.');
const policy = (code: string, message: string, fieldErrors?: Record<string, string[]>) =>
  new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, code, message, fieldErrors);

/**
 * Admin review of merchants (docs/04-admin.md: /admin/businesses). Every decision is a typed
 * action with a version precondition, runs under a row lock, writes the audit log (actor, target,
 * before/after, reason) and queues an outbox event for notifications.
 */
@Injectable()
export class AdminBusinessesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async list(query: AdminBusinessListQuery) {
    const cursor = decodeCursor(query.cursor);
    let q = this.db
      .selectFrom('businesses as b')
      .leftJoin('storefronts as s', 's.business_id', 'b.id')
      .select([
        'b.id',
        'b.display_name',
        'b.legal_name',
        'b.status',
        'b.submitted_at',
        'b.version',
        'b.created_at',
        's.changes_submitted_at',
      ])
      .select(cursorTs('b.created_at').as('cursor_ts'));
    if (query.status === 'pending') {
      q = q.where(({ eb, or, exists, selectFrom }) =>
        or([
          eb('b.status', 'in', ['submitted', 'under_review']),
          eb('s.changes_submitted_at', 'is not', null),
          exists(
            selectFrom('business_modes as m')
              .select('m.id')
              .whereRef('m.business_id', '=', 'b.id')
              .where('m.status', '=', 'pending_review'),
          ),
        ]),
      );
    } else if (query.status !== 'all') {
      q = q.where('b.status', '=', query.status);
    }
    if (cursor) q = q.where(afterCursor('b.created_at', 'b.id', cursor) as Expression<SqlBool>);
    const rows = await q
      .orderBy('b.created_at')
      .orderBy('b.id')
      .limit(query.limit + 1)
      .execute();
    const modes = rows.length
      ? await this.db
          .selectFrom('business_modes')
          .select(['business_id', 'mode', 'status'])
          .where(
            'business_id',
            'in',
            rows.map((r) => r.id),
          )
          .execute()
      : [];
    return toPage(rows, query.limit, (r): AdminBusinessListItem => {
      const status = (mode: Mode) =>
        modes.find((m) => m.business_id === r.id && m.mode === mode)?.status ?? 'not_activated';
      return {
        id: r.id,
        displayName: r.display_name,
        legalName: r.legal_name,
        status: r.status,
        modes: { shop: status('shop'), services: status('services') },
        storefrontChangesPending: r.changes_submitted_at !== null,
        submittedAt: r.submitted_at?.toISOString() ?? null,
        version: r.version,
        createdAt: r.created_at.toISOString(),
      };
    });
  }

  async detail(businessId: string): Promise<AdminBusinessDetail> {
    const now = this.clock.now();
    const b = await loadBusinessRow(this.db, businessId);
    if (!b) throw notFound();
    const modes = await loadModes(this.db, businessId);
    const [documents, storefront, facts, owner, history] = await Promise.all([
      loadDocuments(this.db, businessId),
      storefrontView(this.db, this.storage, businessId, now),
      onboardingFacts(this.db, b, modes),
      this.db
        .selectFrom('memberships as m')
        .innerJoin('users as u', 'u.id', 'm.user_id')
        .select(['u.display_name', 'u.email', 'u.phone'])
        .where('m.business_id', '=', businessId)
        .where('m.status', '=', 'active')
        .where(sql<boolean>`'owner' = ANY(m.permissions)`)
        .orderBy('m.created_at')
        .executeTakeFirst(),
      this.db
        .selectFrom('audit_logs')
        .select(['id', 'action', 'actor_type', 'reason', 'redacted_diff', 'created_at'])
        .where('business_id', '=', businessId)
        .where('action', 'not like', 'document.viewed')
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .limit(50)
        .execute(),
    ]);
    const reviews = modeReviews(modes);
    return {
      id: b.id,
      displayName: b.display_name,
      legalName: b.legal_name,
      status: b.status,
      modes: { shop: reviews.shop.status, services: reviews.services.status },
      storefrontChangesPending: storefront.changesPending,
      submittedAt: b.submitted_at?.toISOString() ?? null,
      version: b.version,
      createdAt: b.created_at.toISOString(),
      reviewReason: b.review_reason,
      suspensionReason: b.suspension_reason,
      reviewedAt: b.reviewed_at?.toISOString() ?? null,
      legal: legalProfile(b),
      licenseValid: facts.licenseExpiry !== null && licenseValid(facts.licenseExpiry, now),
      agreement: {
        acceptedVersion: b.agreement_version,
        acceptedAt: b.agreement_accepted_at?.toISOString() ?? null,
      },
      owner: owner
        ? {
            displayName: owner.display_name,
            contact: maskContact(owner.email ?? owner.phone ?? ''),
          }
        : null,
      documents,
      storefront,
      modeReviews: reviews,
      checklist: onboardingChecklist(facts, now),
      history: history.map((h) => ({
        id: h.id,
        action: h.action,
        actorType: h.actor_type,
        reason: h.reason,
        diff: h.redacted_diff ?? null,
        createdAt: h.created_at.toISOString(),
      })),
    };
  }

  /** A five-minute link to a private document for a reviewer. Every read is audited. */
  async documentDownload(
    adminId: string,
    businessId: string,
    documentId: string,
    meta: RequestMeta,
  ) {
    const doc = await this.db
      .selectFrom('verification_documents')
      .select(['id', 'object_key', 'file_name', 'kind'])
      .where('id', '=', documentId)
      .where('business_id', '=', businessId)
      .where('status', '=', 'clean')
      .executeTakeFirst();
    if (!doc) throw notFound();
    await writeAudit(this.db, {
      actorType: 'admin',
      actorId: adminId,
      action: 'document.viewed',
      targetType: 'verification_document',
      targetId: doc.id,
      businessId,
      diff: { kind: doc.kind },
      requestId: meta.requestId,
    });
    const signed = this.storage.signDownload(doc.object_key, {
      expiresAt: addSeconds(this.clock.now(), DOWNLOAD_URL_TTL_SECONDS),
      fileName: doc.file_name,
      disposition: 'attachment',
    });
    return { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
  }

  async act(
    adminId: string,
    businessId: string,
    body: BusinessActionRequest,
    meta: RequestMeta,
  ): Promise<AdminBusinessDetail> {
    const now = this.clock.now();
    await this.db.transaction().execute(async (trx) => {
      const locked = await trx
        .selectFrom('businesses')
        .select(['id', 'status', 'version'])
        .where('id', '=', businessId)
        .forUpdate()
        .executeTakeFirst();
      if (!locked) throw notFound();
      if (locked.version !== body.expectedVersion) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'VERSION_CONFLICT',
          'This business changed since you loaded it. Reload and review again.',
        );
      }
      if (!canApplyAction(locked.status, body.action)) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'INVALID_TRANSITION',
          `This action is not possible while the business is ${locked.status}.`,
        );
      }
      const outcome = await this.apply(trx, adminId, businessId, locked.status, body, now);
      await trx
        .updateTable('businesses')
        .set({ ...outcome.business, version: sql<number>`version + 1` } as never)
        .where('id', '=', businessId)
        .execute();
      await trx
        .insertInto('outbox')
        .values({
          event_type: `business.${outcome.event}`,
          payload: JSON.stringify({ businessId, action: body.action, ...outcome.diff }),
          available_at: now,
        })
        .execute();
      await writeAudit(trx, {
        actorType: 'admin',
        actorId: adminId,
        action: `business.${outcome.event}`,
        targetType: 'business',
        targetId: businessId,
        businessId,
        reason: body.reason ?? null,
        diff: { status: { before: locked.status, after: outcome.status }, ...outcome.diff },
        requestId: meta.requestId,
      });
    });
    return this.detail(businessId);
  }

  private async pendingModes(trx: Trx, businessId: string): Promise<Mode[]> {
    const rows = await trx
      .selectFrom('business_modes')
      .select('mode')
      .where('business_id', '=', businessId)
      .where('status', '=', 'pending_review')
      .forUpdate()
      .execute();
    return rows.map((r) => r.mode);
  }

  private async setModes(
    trx: Trx,
    businessId: string,
    modes: Mode[],
    status: 'active' | 'rejected',
    reason: string | null,
    now: Date,
  ) {
    if (modes.length === 0) return;
    await trx
      .updateTable('business_modes')
      .set({ status, reviewed_at: now, review_reason: status === 'rejected' ? reason : null })
      .where('business_id', '=', businessId)
      .where('mode', 'in', modes)
      .execute();
  }

  /** Copies the storefront draft to the live columns (publishing it). */
  private async publishStorefront(trx: Trx, businessId: string, now: Date) {
    const s = await trx
      .selectFrom('storefronts')
      .selectAll()
      .where('business_id', '=', businessId)
      .forUpdate()
      .executeTakeFirst();
    if (!s?.name || !s.description) {
      throw policy('STOREFRONT_INCOMPLETE', 'The storefront needs a name and description.');
    }
    await trx
      .updateTable('storefronts')
      .set({
        live_name: JSON.stringify(s.name as Localized),
        live_description: JSON.stringify(s.description as Localized),
        live_logo_media_id: s.logo_media_id,
        live_banner_media_id: s.banner_media_id,
        published_at: s.published_at ?? now,
        changes_submitted_at: null,
        changes_review_reason: null,
      })
      .where('business_id', '=', businessId)
      .execute();
  }

  private async apply(
    trx: Trx,
    adminId: string,
    businessId: string,
    status: AdminBusinessDetail['status'],
    body: BusinessActionRequest,
    now: Date,
  ): Promise<{
    status: AdminBusinessDetail['status'];
    event: string;
    business: Record<string, unknown>;
    diff: Record<string, unknown>;
  }> {
    const reason = body.reason ?? null;
    switch (body.action) {
      case 'start_review':
        return {
          status: 'under_review',
          event: 'review_started',
          business: { status: 'under_review' },
          diff: {},
        };

      case 'approve': {
        const b = await loadBusinessRow(trx, businessId);
        if (!b) throw notFound();
        const modes = await loadModes(trx, businessId);
        const facts = await onboardingFacts(trx, b, modes);
        // Re-check what the merchant submitted: the licence may have expired since.
        const missing = missingItems(facts, now).filter((m) => m !== 'mode');
        if (missing.length > 0) {
          throw policy(
            missing.includes('license_valid') ? 'LICENSE_EXPIRED' : 'ONBOARDING_INCOMPLETE',
            missing.includes('license_valid')
              ? 'The trade licence has expired. Reject with a reason instead.'
              : 'Required onboarding items are missing.',
            { checklist: missing },
          );
        }
        const pending = await this.pendingModes(trx, businessId);
        const approved = body.modes ?? pending;
        const notPending = approved.filter((m) => !pending.includes(m));
        if (notPending.length > 0) {
          throw policy('MODE_NOT_PENDING', 'Only modes waiting for review can be approved.', {
            modes: notPending,
          });
        }
        const rejected = pending.filter((m) => !approved.includes(m));
        if (rejected.length > 0 && !reason) {
          throw new ApiError(
            HttpStatus.BAD_REQUEST,
            'VALIDATION_FAILED',
            'A reason is needed for modes that are not approved.',
            { reason: ['is required when a pending mode is not approved'] },
          );
        }
        await this.setModes(trx, businessId, approved, 'active', null, now);
        await this.setModes(trx, businessId, rejected, 'rejected', reason, now);
        await this.publishStorefront(trx, businessId, now);
        return {
          status: 'approved',
          event: 'approved',
          business: {
            status: 'approved',
            reviewed_at: now,
            reviewed_by: adminId,
            review_reason: rejected.length > 0 ? reason : null,
          },
          diff: { approvedModes: approved, rejectedModes: rejected },
        };
      }

      case 'reject': {
        const pending = await this.pendingModes(trx, businessId);
        await this.setModes(trx, businessId, pending, 'rejected', reason, now);
        return {
          status: 'rejected',
          event: 'rejected',
          business: {
            status: 'rejected',
            reviewed_at: now,
            reviewed_by: adminId,
            review_reason: reason,
          },
          diff: { rejectedModes: pending },
        };
      }

      case 'approve_mode':
      case 'reject_mode': {
        const pending = await this.pendingModes(trx, businessId);
        if (!pending.includes(body.mode)) {
          throw policy('MODE_NOT_PENDING', 'This mode is not waiting for review.', {
            mode: [body.mode],
          });
        }
        if (body.action === 'approve_mode') {
          const b = await loadBusinessRow(trx, businessId);
          if (!b) throw notFound();
          const facts = await onboardingFacts(trx, b, await loadModes(trx, businessId));
          if (facts.licenseExpiry === null || !licenseValid(facts.licenseExpiry, now)) {
            throw policy('LICENSE_EXPIRED', 'The trade licence has expired.');
          }
        }
        const approve = body.action === 'approve_mode';
        await this.setModes(
          trx,
          businessId,
          [body.mode],
          approve ? 'active' : 'rejected',
          reason,
          now,
        );
        return {
          status,
          event: approve ? 'mode_approved' : 'mode_rejected',
          business: {},
          diff: { mode: body.mode },
        };
      }

      case 'suspend':
        return {
          status: 'suspended',
          event: 'suspended',
          business: { status: 'suspended', suspended_at: now, suspension_reason: reason },
          diff: {},
        };

      case 'reactivate':
        return {
          status: 'approved',
          event: 'reactivated',
          business: { status: 'approved', suspended_at: null, suspension_reason: null },
          diff: {},
        };

      case 'approve_storefront_changes':
      case 'reject_storefront_changes': {
        const s = await trx
          .selectFrom('storefronts')
          .select('changes_submitted_at')
          .where('business_id', '=', businessId)
          .forUpdate()
          .executeTakeFirst();
        if (!s?.changes_submitted_at) {
          throw policy('NO_PENDING_CHANGES', 'There are no storefront changes waiting for review.');
        }
        if (body.action === 'approve_storefront_changes') {
          await this.publishStorefront(trx, businessId, now);
        } else {
          await trx
            .updateTable('storefronts')
            .set({ changes_submitted_at: null, changes_review_reason: reason })
            .where('business_id', '=', businessId)
            .execute();
        }
        return {
          status,
          event:
            body.action === 'approve_storefront_changes'
              ? 'storefront_changes_approved'
              : 'storefront_changes_rejected',
          business: {},
          diff: {},
        };
      }
    }
  }
}
