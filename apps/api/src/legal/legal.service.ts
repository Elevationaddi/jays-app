import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  AcceptLegalRequest,
  AdminLegalDocument,
  CreateLegalDraftRequest,
  LegalDocument,
  LegalDocumentSummary,
  MerchantAgreementStatus,
  MyLegal,
  PublishLegalRequest,
  UpdateLegalDraftRequest,
} from '@jays/contracts';
import type { Database, Db, LegalDocumentKindColumn } from '@jays/db';
import {
  CUSTOMER_REQUIRED_LEGAL,
  LEGAL_REVIEW_COMPLETE,
  type LegalAcceptanceSource,
  type LegalDocumentKind,
  pendingAcceptances,
} from '@jays/domain';
import { sql, type Selectable, type Transaction } from 'kysely';
import type { BusinessContext } from '../businesses/business-access.guard.js';
import { writeAudit } from '../common/audit.js';
import { CLOCK, type Clock } from '../common/clock.js';
import { ApiError } from '../common/error.filter.js';
import type { RequestMeta } from '../common/request-context.js';
import { DB } from '../common/tokens.js';
import { API_ENV, type ApiEnv } from '../config.js';

type Row = Selectable<Database['legal_documents']>;
type Conn = Db | Transaction<Database>;

const notFound = () =>
  new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'That document does not exist.');

function summary(r: Row): LegalDocumentSummary {
  return {
    id: r.id,
    kind: r.kind,
    version: r.version,
    title: r.title,
    effectiveAt: r.effective_at!.toISOString(),
    publishedAt: r.published_at!.toISOString(),
    legalReview: 'pending',
  };
}

/**
 * Legal documents (D13, ADR-0028): drafts and versions kept by admins, the version in force shown
 * to everyone, and append-only acceptance records. Nothing here marks a document as approved by
 * a lawyer; production refuses to publish until that review exists.
 */
@Injectable()
export class LegalService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  // Public -------------------------------------------------------------------------------------

  private published(conn: Conn = this.db) {
    return conn.selectFrom('legal_documents').selectAll().where('status', '=', 'published');
  }

  async list(): Promise<{ items: LegalDocumentSummary[] }> {
    const rows = await this.published().orderBy('kind').execute();
    return { items: rows.map(summary) };
  }

  async current(kind: LegalDocumentKind): Promise<LegalDocument> {
    const r = await this.published().where('kind', '=', kind).executeTakeFirst();
    if (!r) throw notFound();
    return { ...summary(r), body: r.body };
  }

  async version(kind: LegalDocumentKind, version: number): Promise<LegalDocument> {
    const r = await this.db
      .selectFrom('legal_documents')
      .selectAll()
      .where('kind', '=', kind)
      .where('version', '=', version)
      .where('status', '<>', 'draft')
      .executeTakeFirst();
    if (!r) throw notFound();
    return { ...summary(r), body: r.body };
  }

  // Customers ----------------------------------------------------------------------------------

  async mine(userId: string): Promise<MyLegal> {
    const [published, accepted] = await Promise.all([
      this.published().execute(),
      this.db
        .selectFrom('legal_acceptances')
        .select(['kind', 'version', 'accepted_at'])
        .where('user_id', '=', userId)
        .where('business_id', 'is', null)
        .orderBy('accepted_at', 'desc')
        .execute(),
    ]);
    const pending = pendingAcceptances(CUSTOMER_REQUIRED_LEGAL, published, accepted);
    return {
      pending: pending.map((p) => ({
        kind: p.kind,
        version: p.version,
        title: published.find((d) => d.kind === p.kind)!.title,
      })),
      accepted: accepted.map((a) => ({
        kind: a.kind,
        version: a.version,
        acceptedAt: a.accepted_at.toISOString(),
        current: published.some((d) => d.kind === a.kind && d.version === a.version),
      })),
    };
  }

  /**
   * Records acceptance of the named versions. Each must be the version in force: accepting an old
   * or unpublished one answers 409 VERSION_NOT_CURRENT. Accepting twice is a no-op.
   */
  async accept(userId: string, body: AcceptLegalRequest, meta: RequestMeta): Promise<MyLegal> {
    await this.db.transaction().execute(async (trx) => {
      const locale = await this.localeOf(trx, userId);
      for (const ref of body.documents) {
        if (ref.kind === 'merchant_agreement') {
          throw new ApiError(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'WRONG_ACCEPTANCE_ROUTE',
            'A business owner accepts the merchant agreement for the business.',
          );
        }
        const doc = await this.currentFor(trx, ref.kind, ref.version);
        await this.record(trx, userId, doc, null, locale, 'reaccept', meta);
      }
    });
    return this.mine(userId);
  }

  /** Acceptances given at sign-up: whatever required documents are in force (may be none). */
  async acceptAtSignUp(
    trx: Transaction<Database>,
    userId: string,
    locale: 'en' | 'ar',
    meta: RequestMeta,
  ): Promise<{ kind: LegalDocumentKind; version: number }[]> {
    const docs = await this.published(trx)
      .where('kind', 'in', CUSTOMER_REQUIRED_LEGAL as LegalDocumentKindColumn[])
      .execute();
    for (const d of docs) await this.record(trx, userId, d, null, locale, 'sign_up', meta);
    return docs.map((d) => ({ kind: d.kind, version: d.version }));
  }

  private async localeOf(conn: Conn, userId: string): Promise<'en' | 'ar'> {
    const u = await conn
      .selectFrom('users')
      .select('locale')
      .where('id', '=', userId)
      .executeTakeFirstOrThrow();
    return u.locale === 'ar' ? 'ar' : 'en';
  }

  private async currentFor(conn: Conn, kind: LegalDocumentKind, version: number) {
    const doc = await this.published(conn).where('kind', '=', kind).executeTakeFirst();
    if (!doc || doc.version !== version) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'VERSION_NOT_CURRENT',
        'That version is not the one in force. Reload and read the current version.',
      );
    }
    return doc;
  }

  private async record(
    trx: Conn,
    userId: string,
    doc: Row,
    businessId: string | null,
    locale: 'en' | 'ar',
    source: LegalAcceptanceSource,
    meta: RequestMeta,
  ) {
    await trx
      .insertInto('legal_acceptances')
      .values({
        user_id: userId,
        document_id: doc.id,
        kind: doc.kind,
        version: doc.version,
        business_id: businessId,
        locale,
        source,
        request_id: meta.requestId ?? null,
      })
      .onConflict((oc) => oc.doNothing())
      .execute();
  }

  // Businesses ---------------------------------------------------------------------------------

  async merchantAgreement(ctx: BusinessContext): Promise<MerchantAgreementStatus> {
    return this.agreementFor(this.db, ctx.businessId);
  }

  private async agreementFor(conn: Conn, businessId: string): Promise<MerchantAgreementStatus> {
    const doc = await this.published(conn)
      .where('kind', '=', 'merchant_agreement')
      .executeTakeFirst();
    const last = await conn
      .selectFrom('legal_acceptances')
      .select(['version', 'accepted_at', 'user_id'])
      .where('business_id', '=', businessId)
      .where('kind', '=', 'merchant_agreement')
      .orderBy('accepted_at', 'desc')
      .executeTakeFirst();
    return {
      document: doc ? summary(doc) : null,
      accepted: last
        ? {
            version: last.version,
            acceptedAt: last.accepted_at.toISOString(),
            acceptedBy: last.user_id,
          }
        : null,
      required: !!doc && last?.version !== doc.version,
    };
  }

  async acceptMerchantAgreement(
    ctx: BusinessContext,
    userId: string,
    version: number,
    meta: RequestMeta,
  ): Promise<MerchantAgreementStatus> {
    await this.db.transaction().execute(async (trx) => {
      const locale = await this.localeOf(trx, userId);
      const doc = await this.currentFor(trx, 'merchant_agreement', version);
      await this.record(trx, userId, doc, ctx.businessId, locale, 'merchant_onboarding', meta);
      await writeAudit(trx, {
        actorType: 'user',
        actorId: userId,
        action: 'legal.merchant_agreement_accepted',
        targetType: 'legal_document',
        targetId: doc.id,
        businessId: ctx.businessId,
        diff: { version },
        requestId: meta.requestId,
      });
    });
    return this.agreementFor(this.db, ctx.businessId);
  }

  /** Used by onboarding: submitting for review needs the agreement in force, when there is one. */
  async assertMerchantAgreementAccepted(conn: Conn, businessId: string) {
    const status = await this.agreementFor(conn, businessId);
    if (status.required) {
      throw new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'MERCHANT_AGREEMENT_REQUIRED',
        'The owner must accept the current merchant agreement before submitting.',
      );
    }
  }

  // Admin --------------------------------------------------------------------------------------

  private async adminView(conn: Conn, r: Row): Promise<AdminLegalDocument> {
    const { n } = await conn
      .selectFrom('legal_acceptances')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('document_id', '=', r.id)
      .executeTakeFirstOrThrow();
    return {
      id: r.id,
      kind: r.kind,
      version: r.version,
      title: r.title,
      body: r.body,
      summaryOfChanges: r.summary_of_changes,
      status: r.status,
      effectiveAt: r.effective_at?.toISOString() ?? null,
      publishedAt: r.published_at?.toISOString() ?? null,
      retiredAt: r.retired_at?.toISOString() ?? null,
      legalReview: 'pending',
      acceptances: n,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    };
  }

  async adminList() {
    const rows = await this.db
      .selectFrom('legal_documents')
      .selectAll()
      .orderBy('kind')
      .orderBy('version', 'desc')
      .execute();
    const items = [];
    for (const r of rows) {
      const { body: _body, ...rest } = await this.adminView(this.db, r);
      items.push(rest);
    }
    return { items };
  }

  async adminGet(id: string) {
    const r = await this.db
      .selectFrom('legal_documents')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!r) throw notFound();
    return this.adminView(this.db, r);
  }

  /** A new draft version: the next number for its kind. One open draft per kind. */
  async createDraft(adminId: string, body: CreateLegalDraftRequest, meta: RequestMeta) {
    const id = await this.db.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`legal:${body.kind}`}))`.execute(trx);
      const open = await trx
        .selectFrom('legal_documents')
        .select('id')
        .where('kind', '=', body.kind)
        .where('status', '=', 'draft')
        .executeTakeFirst();
      if (open) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'DRAFT_EXISTS',
          'This document already has a draft. Edit or publish it first.',
        );
      }
      const { max } = await trx
        .selectFrom('legal_documents')
        .select(sql<number>`coalesce(max(version), 0)::int`.as('max'))
        .where('kind', '=', body.kind)
        .executeTakeFirstOrThrow();
      const row = await trx
        .insertInto('legal_documents')
        .values({
          kind: body.kind,
          version: max + 1,
          title: JSON.stringify(body.title),
          body: JSON.stringify(body.body),
          summary_of_changes: body.summaryOfChanges ?? null,
          created_by: adminId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await writeAudit(trx, {
        actorType: 'admin',
        actorId: adminId,
        action: 'legal.draft_created',
        targetType: 'legal_document',
        targetId: row.id,
        diff: { kind: body.kind, version: max + 1 },
        requestId: meta.requestId,
      });
      return row.id;
    });
    return this.adminGet(id);
  }

  async updateDraft(adminId: string, id: string, body: UpdateLegalDraftRequest, meta: RequestMeta) {
    await this.db.transaction().execute(async (trx) => {
      const r = await trx
        .selectFrom('legal_documents')
        .select(['id', 'status'])
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!r) throw notFound();
      if (r.status !== 'draft') {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'DOCUMENT_FROZEN',
          'A published version cannot change. Create a new draft.',
        );
      }
      await trx
        .updateTable('legal_documents')
        .set({
          ...(body.title ? { title: JSON.stringify(body.title) } : {}),
          ...(body.body ? { body: JSON.stringify(body.body) } : {}),
          ...(body.summaryOfChanges !== undefined
            ? { summary_of_changes: body.summaryOfChanges }
            : {}),
        })
        .where('id', '=', id)
        .execute();
      await writeAudit(trx, {
        actorType: 'admin',
        actorId: adminId,
        action: 'legal.draft_updated',
        targetType: 'legal_document',
        targetId: id,
        diff: { fields: Object.keys(body) },
        requestId: meta.requestId,
      });
    });
    return this.adminGet(id);
  }

  /**
   * Puts a draft in force and retires the previous version. Refused in production until a lawyer
   * has reviewed the documents (LEGAL_REVIEW_COMPLETE, ADR-0028). People who accepted the old
   * version are asked to accept the new one.
   */
  async publish(adminId: string, id: string, body: PublishLegalRequest, meta: RequestMeta) {
    if (this.env.APP_ENV === 'production' && !LEGAL_REVIEW_COMPLETE) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'LEGAL_REVIEW_REQUIRED',
        'Legal documents cannot be published in production until a UAE lawyer has reviewed them.',
      );
    }
    const now = this.clock.now();
    const effectiveAt = body.effectiveAt ? new Date(body.effectiveAt) : now;
    if (effectiveAt.getTime() < now.getTime() - 60_000) {
      throw new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'EFFECTIVE_IN_PAST',
        'A version cannot take effect in the past.',
      );
    }
    await this.db.transaction().execute(async (trx) => {
      const r = await trx
        .selectFrom('legal_documents')
        .select(['id', 'kind', 'version', 'status'])
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!r) throw notFound();
      if (r.status !== 'draft') {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'ALREADY_PUBLISHED',
          'This version is already out.',
        );
      }
      const previous = await trx
        .updateTable('legal_documents')
        .set({ status: 'retired', retired_at: now })
        .where('kind', '=', r.kind)
        .where('status', '=', 'published')
        .returning('version')
        .executeTakeFirst();
      await trx
        .updateTable('legal_documents')
        .set({
          status: 'published',
          effective_at: effectiveAt,
          published_at: now,
          published_by: adminId,
        })
        .where('id', '=', id)
        .execute();
      await writeAudit(trx, {
        actorType: 'admin',
        actorId: adminId,
        action: 'legal.published',
        targetType: 'legal_document',
        targetId: id,
        diff: {
          kind: r.kind,
          version: r.version,
          retiredVersion: previous?.version ?? null,
          effectiveAt: effectiveAt.toISOString(),
        },
        requestId: meta.requestId,
      });
    });
    return this.adminGet(id);
  }
}
