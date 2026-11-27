import type { DocumentView, MediaView, OnboardingView, StorefrontView } from '@jays/contracts';
import type { Db } from '@jays/db';
import {
  DOWNLOAD_URL_TTL_SECONDS,
  type Mode,
  type ModeStatus,
  type OnboardingFacts,
  onboardingChecklist,
} from '@jays/domain';
import { addSeconds } from '../common/clock.js';
import type { ObjectStorage } from '../storage/storage.js';

type Localized = { en: string; ar: string };

export interface ModeRow {
  mode: Mode;
  status: ModeStatus;
  review_reason: string | null;
  submitted_at: Date | null;
  reviewed_at: Date | null;
}

export async function loadModes(db: Db, businessId: string): Promise<ModeRow[]> {
  return (await db
    .selectFrom('business_modes')
    .select(['mode', 'status', 'review_reason', 'submitted_at', 'reviewed_at'])
    .where('business_id', '=', businessId)
    .execute()) as ModeRow[];
}

export function modeReviews(rows: ModeRow[]): OnboardingView['modes'] {
  const view = (mode: Mode) => {
    const row = rows.find((r) => r.mode === mode);
    return {
      status: row?.status ?? ('not_activated' as const),
      reviewReason: row?.review_reason ?? null,
      submittedAt: row?.submitted_at?.toISOString() ?? null,
      reviewedAt: row?.reviewed_at?.toISOString() ?? null,
    };
  };
  return { shop: view('shop'), services: view('services') };
}

export function modeStatusMap(rows: ModeRow[]): Partial<Record<Mode, ModeStatus>> {
  return Object.fromEntries(rows.map((r) => [r.mode, r.status]));
}

export async function loadDocuments(db: Db, businessId: string): Promise<DocumentView[]> {
  const rows = await db
    .selectFrom('verification_documents')
    .select([
      'id',
      'kind',
      'file_name',
      'content_type',
      'size_bytes',
      'status',
      'rejection_reason',
      'uploaded_at',
      'created_at',
    ])
    .where('business_id', '=', businessId)
    .where('status', '<>', 'archived')
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    fileName: r.file_name,
    contentType: r.content_type,
    sizeBytes: r.size_bytes,
    status: r.status as DocumentView['status'],
    rejectionReason: r.rejection_reason,
    uploadedAt: r.uploaded_at?.toISOString() ?? null,
    createdAt: r.created_at.toISOString(),
  }));
}

interface MediaRow {
  id: string;
  purpose: 'storefront_logo' | 'storefront_banner';
  object_key: string;
  content_type: string;
  status: 'pending_upload' | 'ready' | 'rejected';
  rejection_reason: MediaView['rejectionReason'];
  width: number | null;
  height: number | null;
}

export function toMediaView(row: MediaRow, storage: ObjectStorage, now: Date): MediaView {
  return {
    id: row.id,
    purpose: row.purpose,
    contentType: row.content_type,
    status: row.status,
    rejectionReason: row.rejection_reason,
    width: row.width,
    height: row.height,
    previewUrl:
      row.status === 'ready'
        ? storage.signDownload(row.object_key, {
            expiresAt: addSeconds(now, DOWNLOAD_URL_TTL_SECONDS),
            disposition: 'inline',
          }).url
        : null,
  };
}

export const MEDIA_COLUMNS = [
  'id',
  'purpose',
  'object_key',
  'content_type',
  'status',
  'rejection_reason',
  'width',
  'height',
] as const;

export async function loadStorefrontRow(db: Db, businessId: string) {
  return db
    .selectFrom('storefronts')
    .selectAll()
    .where('business_id', '=', businessId)
    .executeTakeFirst();
}

export async function storefrontView(
  db: Db,
  storage: ObjectStorage,
  businessId: string,
  now: Date,
): Promise<StorefrontView> {
  const row = await loadStorefrontRow(db, businessId);
  if (!row) {
    return {
      draft: { name: null, description: null, logo: null, banner: null },
      live: null,
      publishedAt: null,
      changesPending: false,
      changesReviewReason: null,
    };
  }
  const ids = [
    row.logo_media_id,
    row.banner_media_id,
    row.live_logo_media_id,
    row.live_banner_media_id,
  ].filter((id): id is string => id !== null);
  const media = ids.length
    ? await db
        .selectFrom('media')
        .select(MEDIA_COLUMNS)
        .where('id', 'in', ids)
        .where('business_id', '=', businessId)
        .execute()
    : [];
  const ref = (id: string | null) => {
    const m = id ? media.find((x) => x.id === id) : undefined;
    return m ? toMediaView(m as MediaRow, storage, now) : null;
  };
  return {
    draft: {
      name: row.name as Localized | null,
      description: row.description as Localized | null,
      logo: ref(row.logo_media_id),
      banner: ref(row.banner_media_id),
    },
    live: row.published_at
      ? {
          name: row.live_name as Localized | null,
          description: row.live_description as Localized | null,
          logo: ref(row.live_logo_media_id),
          banner: ref(row.live_banner_media_id),
        }
      : null,
    publishedAt: row.published_at?.toISOString() ?? null,
    changesPending: row.changes_submitted_at !== null,
    changesReviewReason: row.changes_review_reason,
  };
}

export async function loadBusinessRow(db: Db, businessId: string) {
  return db.selectFrom('businesses').selectAll().where('id', '=', businessId).executeTakeFirst();
}

type BusinessRow = NonNullable<Awaited<ReturnType<typeof loadBusinessRow>>>;

export function isoDateOf(value: Date | null): string | null {
  if (!value) return null;
  // `date` columns come back as local-midnight Dates from node-postgres; format in local time.
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function legalProfile(b: BusinessRow): OnboardingView['legal'] {
  return {
    legalName: b.legal_name,
    tradeLicenseNumber: b.trade_license_number,
    licenseAuthority: b.license_authority,
    licenseExpiry: isoDateOf(b.license_expiry),
    taxRegistered: b.tax_registered,
    taxId: b.tax_id,
    address: {
      emirate: b.address_emirate_code as OnboardingView['legal']['address']['emirate'],
      area: b.address_area,
      street: b.address_street,
      building: b.address_building,
      unit: b.address_unit,
    },
  };
}

export async function onboardingFacts(
  db: Db,
  b: BusinessRow,
  modes: ModeRow[],
): Promise<OnboardingFacts> {
  const [docs, storefront] = await Promise.all([
    db
      .selectFrom('verification_documents')
      .select('kind')
      .where('business_id', '=', b.id)
      .where('status', '=', 'clean')
      .execute(),
    loadStorefrontRow(db, b.id),
  ]);
  return {
    legalName: b.legal_name,
    tradeLicenseNumber: b.trade_license_number,
    licenseAuthority: b.license_authority,
    licenseExpiry: isoDateOf(b.license_expiry),
    address: {
      emirate: b.address_emirate_code,
      area: b.address_area,
      street: b.address_street,
      building: b.address_building,
    },
    taxRegistered: b.tax_registered,
    taxId: b.tax_id,
    cleanDocumentKinds: docs.map((d) => d.kind),
    storefrontName: (storefront?.name as Localized | null) ?? null,
    storefrontDescription: (storefront?.description as Localized | null) ?? null,
    agreementVersion: b.agreement_version,
    modes: modeStatusMap(modes),
  };
}

export { onboardingChecklist };
