import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  DocumentView,
  MediaView,
  OnboardingView,
  StorefrontView,
  UpdateOnboardingRequest,
  UpdateStorefrontRequest,
  UploadTicket,
} from '@jays/contracts';
import type { Database, Db } from '@jays/db';
import {
  DOCUMENT_MAX_BYTES,
  DOWNLOAD_URL_TTL_SECONDS,
  IMAGE_MAX_BYTES,
  legalProfileEditable,
  MERCHANT_AGREEMENT_VERSION,
  type MediaPurpose,
  missingItems,
  safeFileName,
  submissionTarget,
  UPLOAD_URL_TTL_SECONDS,
  type BusinessStatus,
  type DocumentKind,
} from '@jays/domain';
import { sql, type Transaction } from 'kysely';
import { writeAudit } from '../common/audit.js';
import { addSeconds, CLOCK, type Clock } from '../common/clock.js';
import { ApiError } from '../common/error.filter.js';
import { enforce, RATE_LIMITER, type RateLimiter } from '../common/rate-limit.js';
import type { RequestMeta } from '../common/request-context.js';
import { DB } from '../common/tokens.js';
import type { BusinessContext } from '../businesses/business-access.guard.js';
import {
  MALWARE_SCANNER,
  type MalwareScanner,
  OBJECT_STORAGE,
  type ObjectStorage,
} from '../storage/storage.js';
import { newObjectKey, uploadFailure, verifyStoredUpload } from '../storage/uploads.js';
import {
  legalProfile,
  loadBusinessRow,
  loadDocuments,
  loadModes,
  MEDIA_COLUMNS,
  modeReviews,
  onboardingChecklist,
  onboardingFacts,
  storefrontView,
  toMediaView,
} from './views.js';
import { LIMITS } from '../auth/policy.js';
import { LegalService } from '../legal/legal.service.js';
import { API_ENV, type ApiEnv } from '../config.js';

type Trx = Transaction<Database>;

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found.');
const locked = (status: BusinessStatus) =>
  new ApiError(
    HttpStatus.CONFLICT,
    status === 'submitted' || status === 'under_review' ? 'IN_REVIEW' : 'PROFILE_LOCKED',
    status === 'submitted' || status === 'under_review'
      ? 'Your business is being reviewed. You can make changes once the review is finished.'
      : 'Verified business details can no longer be changed here. Contact support to update them.',
  );

/**
 * Merchant side of onboarding (docs/03-business.md): legal profile, private documents, merchant
 * agreement, storefront and submission. Every change runs under a lock on the business row, so it
 * serialises with admin decisions, and bumps the business version so a reviewer acting on an
 * older version gets 409 VERSION_CONFLICT.
 */
@Injectable()
export class OnboardingService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(MALWARE_SCANNER) private readonly scanner: MalwareScanner,
    @Inject(LegalService) private readonly legal: LegalService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  private async lockBusiness(trx: Trx, businessId: string) {
    const row = await trx
      .selectFrom('businesses')
      .select(['id', 'status', 'version'])
      .where('id', '=', businessId)
      .forUpdate()
      .executeTakeFirst();
    if (!row) throw notFound();
    return row;
  }

  /** Applies business column changes and bumps the version (optimistic concurrency for admins). */
  private bump(trx: Trx, businessId: string, values: Record<string, unknown> = {}) {
    return trx
      .updateTable('businesses')
      .set({ ...values, version: sql<number>`version + 1` } as never)
      .where('id', '=', businessId)
      .execute();
  }

  async view(businessId: string): Promise<OnboardingView> {
    const now = this.clock.now();
    const b = await loadBusinessRow(this.db, businessId);
    if (!b) throw notFound();
    const modes = await loadModes(this.db, businessId);
    const [documents, storefront, facts] = await Promise.all([
      loadDocuments(this.db, businessId),
      storefrontView(this.db, this.storage, businessId, now),
      onboardingFacts(this.db, b, modes),
    ]);
    const checklist = onboardingChecklist(facts, now);
    const target = submissionTarget(b.status, facts.modes);
    return {
      businessId: b.id,
      displayName: b.display_name,
      status: b.status,
      reviewReason: b.review_reason,
      suspensionReason: b.suspension_reason,
      submittedAt: b.submitted_at?.toISOString() ?? null,
      reviewedAt: b.reviewed_at?.toISOString() ?? null,
      legal: legalProfile(b),
      agreement: {
        currentVersion: MERCHANT_AGREEMENT_VERSION,
        acceptedVersion: b.agreement_version,
        acceptedAt: b.agreement_accepted_at?.toISOString() ?? null,
      },
      documents,
      storefront,
      modes: modeReviews(modes),
      checklist,
      editable: legalProfileEditable(b.status),
      canSubmit: target.ok && checklist.every((i) => i.done),
    };
  }

  async update(
    ctx: BusinessContext,
    userId: string,
    body: UpdateOnboardingRequest,
    meta: RequestMeta,
  ): Promise<OnboardingView> {
    await this.db.transaction().execute(async (trx) => {
      const b = await this.lockBusiness(trx, ctx.businessId);
      if (!legalProfileEditable(b.status)) throw locked(b.status);
      const values: Record<string, unknown> = {};
      const changed: string[] = [];
      const set = (column: string, field: string, value: unknown) => {
        if (value === undefined) return;
        values[column] = value;
        changed.push(field);
      };
      set('legal_name', 'legalName', body.legalName);
      set('trade_license_number', 'tradeLicenseNumber', body.tradeLicenseNumber?.toUpperCase());
      set('license_authority', 'licenseAuthority', body.licenseAuthority);
      set('license_expiry', 'licenseExpiry', body.licenseExpiry);
      set('tax_registered', 'taxRegistered', body.taxRegistered);
      set('tax_id', 'taxId', body.taxId);
      if (body.address) {
        values['address_emirate_code'] = body.address.emirate;
        values['address_area'] = body.address.area;
        values['address_street'] = body.address.street;
        values['address_building'] = body.address.building;
        values['address_unit'] = body.address.unit ?? null;
        changed.push('address');
      }
      if (changed.length === 0) return;
      await this.bump(trx, ctx.businessId, values);
      await writeAudit(trx, {
        actorType: 'user',
        actorId: userId,
        action: 'business.profile_updated',
        targetType: 'business',
        targetId: ctx.businessId,
        businessId: ctx.businessId,
        // Field names only: legal and tax details stay out of the audit log.
        diff: { fields: changed },
        requestId: meta.requestId,
      });
    });
    return this.view(ctx.businessId);
  }

  async acceptAgreement(
    ctx: BusinessContext,
    userId: string,
    version: string,
    meta: RequestMeta,
  ): Promise<OnboardingView> {
    if (version !== MERCHANT_AGREEMENT_VERSION) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'AGREEMENT_VERSION_CHANGED',
        'The merchant agreement has changed. Review the current version.',
      );
    }
    await this.db.transaction().execute(async (trx) => {
      const b = await this.lockBusiness(trx, ctx.businessId);
      if (!legalProfileEditable(b.status)) throw locked(b.status);
      await this.bump(trx, ctx.businessId, {
        agreement_version: version,
        agreement_accepted_at: this.clock.now(),
        agreement_accepted_by: userId,
      });
      await writeAudit(trx, {
        actorType: 'user',
        actorId: userId,
        action: 'business.agreement_accepted',
        targetType: 'business',
        targetId: ctx.businessId,
        businessId: ctx.businessId,
        diff: { version },
        requestId: meta.requestId,
      });
    });
    return this.view(ctx.businessId);
  }

  // -------------------------------------------------------------------------------------------
  // Private verification documents

  async createDocumentUpload(
    ctx: BusinessContext,
    userId: string,
    body: { kind: DocumentKind; fileName: string; contentType: string; sizeBytes: number },
    meta: RequestMeta,
  ): Promise<UploadTicket> {
    // Private staging must not collect real merchant documents (ADR-0035): uploads are switched off
    // there, and the demo dataset carries fictional documents instead.
    if (this.env.DOCUMENT_UPLOADS === 'disabled') {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        'DOCUMENT_UPLOADS_DISABLED',
        'Document uploads are switched off in this environment. Do not upload real documents.',
      );
    }
    await enforce(this.limiter, [[LIMITS.uploadPerBusiness, ctx.businessId]]);
    const now = this.clock.now();
    const expiresAt = addSeconds(now, UPLOAD_URL_TTL_SECONDS);
    const key = newObjectKey('private', ctx.businessId, body.contentType);
    const id = await this.db.transaction().execute(async (trx) => {
      const b = await this.lockBusiness(trx, ctx.businessId);
      // A home-service licence (D9) can be added after approval; the legal profile cannot.
      if (body.kind !== 'home_service_license' && !legalProfileEditable(b.status)) {
        throw locked(b.status);
      }
      const row = await trx
        .insertInto('verification_documents')
        .values({
          business_id: ctx.businessId,
          kind: body.kind,
          object_key: key,
          file_name: safeFileName(body.fileName),
          content_type: body.contentType,
          declared_size_bytes: body.sizeBytes,
          upload_expires_at: expiresAt,
          uploaded_by: userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await writeAudit(trx, {
        actorType: 'user',
        actorId: userId,
        action: 'document.upload_requested',
        targetType: 'verification_document',
        targetId: row.id,
        businessId: ctx.businessId,
        diff: { kind: body.kind, contentType: body.contentType },
        requestId: meta.requestId,
      });
      return row.id;
    });
    const signed = await this.storage.signUpload(key, {
      contentType: body.contentType,
      maxBytes: body.sizeBytes,
      expiresAt,
    });
    return {
      id,
      uploadUrl: signed.url,
      method: 'PUT',
      headers: signed.headers,
      maxBytes: body.sizeBytes,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async completeDocument(
    ctx: BusinessContext,
    userId: string,
    documentId: string,
    meta: RequestMeta,
  ): Promise<DocumentView> {
    const doc = await this.db
      .selectFrom('verification_documents')
      .selectAll()
      .where('id', '=', documentId)
      .where('business_id', '=', ctx.businessId)
      .executeTakeFirst();
    if (!doc || doc.status === 'archived') throw notFound();
    if (doc.status !== 'pending_upload') return this.documentView(ctx.businessId, documentId);
    const now = this.clock.now();
    if (doc.upload_expires_at.getTime() < now.getTime()) {
      await this.storage.delete(doc.object_key);
      throw new ApiError(
        HttpStatus.CONFLICT,
        'UPLOAD_EXPIRED',
        'The upload link expired. Start the upload again.',
      );
    }
    const result = await verifyStoredUpload(this.storage, this.scanner, doc.object_key, {
      contentType: doc.content_type,
      maxBytes: Math.min(doc.declared_size_bytes, DOCUMENT_MAX_BYTES),
    });
    if (!result.ok && result.reason === 'missing') throw uploadFailure('missing');
    await this.db.transaction().execute(async (trx) => {
      const current = await trx
        .selectFrom('verification_documents')
        .select('status')
        .where('id', '=', documentId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (current.status !== 'pending_upload') return;
      await trx
        .updateTable('verification_documents')
        .set(
          result.ok
            ? { status: 'clean', size_bytes: result.size, sha256: result.sha256, uploaded_at: now }
            : {
                status: result.reason === 'malware' ? 'infected' : 'rejected',
                rejection_reason: result.reason as 'malware',
                uploaded_at: now,
              },
        )
        .where('id', '=', documentId)
        .execute();
      await this.bump(trx, ctx.businessId);
      await writeAudit(trx, {
        actorType: 'user',
        actorId: userId,
        action: result.ok ? 'document.uploaded' : 'document.upload_rejected',
        targetType: 'verification_document',
        targetId: documentId,
        businessId: ctx.businessId,
        diff: result.ok ? { kind: doc.kind, sizeBytes: result.size } : { reason: result.reason },
        requestId: meta.requestId,
      });
    });
    if (!result.ok) throw uploadFailure(result.reason);
    return this.documentView(ctx.businessId, documentId);
  }

  private async documentView(businessId: string, documentId: string): Promise<DocumentView> {
    const docs = await loadDocuments(this.db, businessId);
    const doc = docs.find((d) => d.id === documentId);
    if (!doc) throw notFound();
    return doc;
  }

  /** A five-minute download link for the owner. Reads of private documents are audited. */
  async documentDownload(
    ctx: BusinessContext,
    userId: string,
    documentId: string,
    meta: RequestMeta,
  ) {
    const doc = await this.db
      .selectFrom('verification_documents')
      .select(['id', 'object_key', 'file_name', 'status'])
      .where('id', '=', documentId)
      .where('business_id', '=', ctx.businessId)
      .where('status', '=', 'clean')
      .executeTakeFirst();
    if (!doc) throw notFound();
    await writeAudit(this.db, {
      actorType: 'user',
      actorId: userId,
      action: 'document.viewed',
      targetType: 'verification_document',
      targetId: doc.id,
      businessId: ctx.businessId,
      requestId: meta.requestId,
    });
    const signed = await this.storage.signDirectDownload(doc.object_key, {
      expiresAt: addSeconds(this.clock.now(), DOWNLOAD_URL_TTL_SECONDS),
      fileName: doc.file_name,
      disposition: 'attachment',
    });
    return { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
  }

  async archiveDocument(
    ctx: BusinessContext,
    userId: string,
    documentId: string,
    meta: RequestMeta,
  ): Promise<void> {
    const key = await this.db.transaction().execute(async (trx) => {
      const b = await this.lockBusiness(trx, ctx.businessId);
      if (!legalProfileEditable(b.status)) throw locked(b.status);
      const doc = await trx
        .updateTable('verification_documents')
        .set({ status: 'archived', archived_at: this.clock.now(), rejection_reason: null })
        .where('id', '=', documentId)
        .where('business_id', '=', ctx.businessId)
        .where('status', '<>', 'archived')
        .returning(['id', 'object_key', 'kind'])
        .executeTakeFirst();
      if (!doc) throw notFound();
      await this.bump(trx, ctx.businessId);
      await writeAudit(trx, {
        actorType: 'user',
        actorId: userId,
        action: 'document.archived',
        targetType: 'verification_document',
        targetId: doc.id,
        businessId: ctx.businessId,
        diff: { kind: doc.kind },
        requestId: meta.requestId,
      });
      return doc.object_key;
    });
    // Archived documents are not kept in storage; the audit log keeps the history.
    await this.storage.delete(key);
  }

  // -------------------------------------------------------------------------------------------
  // Submission

  async submit(ctx: BusinessContext, userId: string, meta: RequestMeta): Promise<OnboardingView> {
    const now = this.clock.now();
    await this.db.transaction().execute(async (trx) => {
      await this.lockBusiness(trx, ctx.businessId);
      const b = await loadBusinessRow(trx, ctx.businessId);
      if (!b) throw notFound();
      const modes = await loadModes(trx, ctx.businessId);
      const facts = await onboardingFacts(trx, b, modes);
      const target = submissionTarget(b.status, facts.modes);
      if (!target.ok) {
        throw target.reason === 'IN_REVIEW'
          ? locked(b.status)
          : new ApiError(
              HttpStatus.CONFLICT,
              'NOTHING_TO_SUBMIT',
              'There is nothing new to submit for review.',
            );
      }
      const missing = missingItems(facts, now);
      if (missing.length > 0) {
        throw new ApiError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'ONBOARDING_INCOMPLETE',
          'Some required steps are not finished.',
          { checklist: missing },
        );
      }
      // The merchant agreement in force, when one is published (D13, ADR-0028).
      await this.legal.assertMerchantAgreementAccepted(trx, ctx.businessId);
      await this.bump(
        trx,
        ctx.businessId,
        target.businessStatus === 'submitted' ? { status: 'submitted', submitted_at: now } : {},
      );
      await trx
        .updateTable('business_modes')
        .set({ status: 'pending_review', submitted_at: now })
        .where('business_id', '=', ctx.businessId)
        .where('mode', 'in', target.modes)
        .execute();
      await trx
        .insertInto('outbox')
        .values({
          event_type: 'business.submitted',
          payload: JSON.stringify({ businessId: ctx.businessId, modes: target.modes }),
          available_at: now,
        })
        .execute();
      await writeAudit(trx, {
        actorType: 'user',
        actorId: userId,
        action: b.status === 'rejected' ? 'business.resubmitted' : 'business.submitted',
        targetType: 'business',
        targetId: ctx.businessId,
        businessId: ctx.businessId,
        diff: { before: b.status, after: target.businessStatus, modes: target.modes },
        requestId: meta.requestId,
      });
    });
    return this.view(ctx.businessId);
  }

  // -------------------------------------------------------------------------------------------
  // Storefront and media

  storefront(businessId: string): Promise<StorefrontView> {
    return storefrontView(this.db, this.storage, businessId, this.clock.now());
  }

  async updateStorefront(
    ctx: BusinessContext,
    userId: string,
    body: UpdateStorefrontRequest,
    meta: RequestMeta,
  ): Promise<StorefrontView> {
    const now = this.clock.now();
    await this.db.transaction().execute(async (trx) => {
      const b = await this.lockBusiness(trx, ctx.businessId);
      if (b.status === 'submitted' || b.status === 'under_review') throw locked(b.status);
      for (const [field, purpose] of [
        ['logoMediaId', 'storefront_logo'],
        ['bannerMediaId', 'storefront_banner'],
      ] as const) {
        const id = body[field];
        if (!id) continue;
        const media = await trx
          .selectFrom('media')
          .select('id')
          .where('id', '=', id)
          .where('business_id', '=', ctx.businessId)
          .where('purpose', '=', purpose)
          .where('status', '=', 'ready')
          .executeTakeFirst();
        if (!media) {
          throw new ApiError(
            HttpStatus.BAD_REQUEST,
            'VALIDATION_FAILED',
            'The image is not valid.',
            {
              [field]: ['must be a ready image of this business for this use'],
            },
          );
        }
      }
      const values: Record<string, unknown> = {};
      if (body.name) values['name'] = JSON.stringify(body.name);
      if (body.description) values['description'] = JSON.stringify(body.description);
      if (body.logoMediaId !== undefined) values['logo_media_id'] = body.logoMediaId;
      if (body.bannerMediaId !== undefined) values['banner_media_id'] = body.bannerMediaId;
      if (Object.keys(values).length === 0) return;
      // Once live, every edit is a material change that waits for review (docs/03-business.md).
      const reviewed = b.status === 'approved' || b.status === 'suspended';
      if (reviewed) {
        values['changes_submitted_at'] = now;
        values['changes_review_reason'] = null;
      }
      await trx
        .insertInto('storefronts')
        .values({ business_id: ctx.businessId, ...values })
        .onConflict((oc) => oc.column('business_id').doUpdateSet(values))
        .execute();
      await this.bump(trx, ctx.businessId);
      await writeAudit(trx, {
        actorType: 'user',
        actorId: userId,
        action: reviewed ? 'storefront.changes_submitted' : 'storefront.updated',
        targetType: 'business',
        targetId: ctx.businessId,
        businessId: ctx.businessId,
        diff: { fields: Object.keys(body) },
        requestId: meta.requestId,
      });
    });
    return this.storefront(ctx.businessId);
  }

  async createMediaUpload(
    ctx: BusinessContext,
    userId: string,
    body: { purpose: MediaPurpose; contentType: string; sizeBytes: number },
  ): Promise<UploadTicket> {
    await enforce(this.limiter, [[LIMITS.uploadPerBusiness, ctx.businessId]]);
    const now = this.clock.now();
    const expiresAt = addSeconds(now, UPLOAD_URL_TTL_SECONDS);
    const key = newObjectKey('media', ctx.businessId, body.contentType);
    const row = await this.db
      .insertInto('media')
      .values({
        business_id: ctx.businessId,
        purpose: body.purpose,
        object_key: key,
        content_type: body.contentType,
        declared_size_bytes: body.sizeBytes,
        upload_expires_at: expiresAt,
        created_by: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const signed = await this.storage.signUpload(key, {
      contentType: body.contentType,
      maxBytes: body.sizeBytes,
      expiresAt,
    });
    return {
      id: row.id,
      uploadUrl: signed.url,
      method: 'PUT',
      headers: signed.headers,
      maxBytes: body.sizeBytes,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async completeMedia(
    ctx: BusinessContext,
    userId: string,
    mediaId: string,
    meta: RequestMeta,
  ): Promise<MediaView> {
    const media = await this.db
      .selectFrom('media')
      .selectAll()
      .where('id', '=', mediaId)
      .where('business_id', '=', ctx.businessId)
      .executeTakeFirst();
    if (!media) throw notFound();
    const now = this.clock.now();
    if (media.status === 'pending_upload') {
      if (media.upload_expires_at.getTime() < now.getTime()) {
        await this.storage.delete(media.object_key);
        throw new ApiError(
          HttpStatus.CONFLICT,
          'UPLOAD_EXPIRED',
          'The upload link expired. Start the upload again.',
        );
      }
      const result = await verifyStoredUpload(this.storage, this.scanner, media.object_key, {
        contentType: media.content_type,
        maxBytes: Math.min(media.declared_size_bytes, IMAGE_MAX_BYTES),
        purpose: media.purpose,
      });
      if (!result.ok && result.reason === 'missing') throw uploadFailure('missing');
      await this.db
        .updateTable('media')
        .set(
          result.ok
            ? {
                status: 'ready',
                size_bytes: result.size,
                width: result.image?.width ?? null,
                height: result.image?.height ?? null,
                uploaded_at: now,
              }
            : { status: 'rejected', rejection_reason: result.reason as 'malware' },
        )
        .where('id', '=', mediaId)
        .where('status', '=', 'pending_upload')
        .execute();
      await writeAudit(this.db, {
        actorType: 'user',
        actorId: userId,
        action: result.ok ? 'media.uploaded' : 'media.upload_rejected',
        targetType: 'media',
        targetId: mediaId,
        businessId: ctx.businessId,
        diff: result.ok
          ? { purpose: media.purpose, width: result.image?.width, height: result.image?.height }
          : { reason: result.reason },
        requestId: meta.requestId,
      });
      if (!result.ok) throw uploadFailure(result.reason);
    }
    const row = await this.db
      .selectFrom('media')
      .select(MEDIA_COLUMNS)
      .where('id', '=', mediaId)
      .executeTakeFirstOrThrow();
    return toMediaView(row, this.storage, now);
  }
}
