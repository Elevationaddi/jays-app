import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

/**
 * Kysely table types for the SQL migrations in ../migrations (ADR-0004).
 *
 * These are written by hand next to the SQL. `schema.int.test.ts` compares every table and column
 * here with the live database after migrating, so the two cannot drift silently.
 */

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type CreatedAt = ColumnType<Date, Date | string | undefined, never>;
type UpdatedAt = ColumnType<Date, never, never>;
type Id = Generated<string>;
type Localized = ColumnType<{ en: string; ar: string }, string, string>;
type Json<T = unknown> = ColumnType<T, string, string>;

export interface EmiratesTable {
  id: Id;
  code: string;
  name: Localized;
  enabled: Generated<boolean>;
  sort_order: number;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export type UserStatus = 'pending_verification' | 'active' | 'restricted' | 'deactivated';

export interface UsersTable {
  id: Id;
  email: string | null;
  email_verified_at: Timestamp | null;
  phone: string | null;
  phone_verified_at: Timestamp | null;
  password_hash: string;
  status: Generated<UserStatus>;
  display_name: string | null;
  locale: Generated<'en' | 'ar'>;
  emirate_code: string | null;
  preferred_mode: 'shop' | 'services' | null;
  terms_version: string;
  terms_accepted_at: Timestamp;
  marketing_consent: Generated<boolean>;
  marketing_consent_at: Timestamp | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export type ChallengePurpose = 'verify_contact' | 'password_reset';
export type ContactChannel = 'email' | 'sms';

export interface VerificationChallengesTable {
  id: Id;
  user_id: string | null;
  purpose: ChallengePurpose;
  channel: ContactChannel;
  destination: string;
  code_hash: string;
  expires_at: Timestamp;
  resend_available_at: Timestamp;
  send_count: Generated<number>;
  attempts: Generated<number>;
  max_attempts: number;
  consumed_at: Timestamp | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export type RevokeReason = 'logout' | 'refresh_reuse' | 'password_reset' | 'admin';

interface SessionColumns {
  id: Id;
  refresh_hash: string;
  generation: Generated<number>;
  expires_at: Timestamp;
  absolute_expires_at: Timestamp;
  last_used_at: Timestamp;
  revoked_at: Timestamp | null;
  revoke_reason: RevokeReason | null;
  user_agent: string | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface SessionsTable extends SessionColumns {
  user_id: string;
}

export interface AdminSessionsTable extends SessionColumns {
  admin_id: string;
}

export interface AddressesTable {
  id: Id;
  user_id: string;
  label: string | null;
  emirate_code: string;
  area: string;
  street: string;
  building: string;
  unit: string | null;
  directions: string | null;
  // numeric comes back from pg as a string to avoid float rounding.
  latitude: ColumnType<string | null, number | null | undefined, number | null>;
  longitude: ColumnType<string | null, number | null | undefined, number | null>;
  is_default: Generated<boolean>;
  archived_at: Timestamp | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export type BusinessStatus =
  'draft' | 'submitted' | 'under_review' | 'approved' | 'rejected' | 'suspended';

export interface BusinessesTable {
  id: Id;
  display_name: Localized;
  status: Generated<BusinessStatus>;
  legal_name: string | null;
  license_expiry: ColumnType<Date | null, string | null | undefined, string | null>;
  tax_id: string | null;
  psp_account_ref: string | null;
  created_by: string;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
  trade_license_number: string | null;
  license_authority: string | null;
  tax_registered: Generated<boolean>;
  address_emirate_code: string | null;
  address_area: string | null;
  address_street: string | null;
  address_building: string | null;
  address_unit: string | null;
  agreement_version: string | null;
  agreement_accepted_at: Timestamp | null;
  agreement_accepted_by: string | null;
  submitted_at: Timestamp | null;
  reviewed_at: Timestamp | null;
  reviewed_by: string | null;
  review_reason: string | null;
  suspended_at: Timestamp | null;
  suspension_reason: string | null;
  version: Generated<number>;
}

export type MembershipStatus = 'invited' | 'active' | 'removed';

export interface MembershipsTable {
  id: Id;
  business_id: string;
  user_id: string;
  permissions: ColumnType<string[], string[], string[]>;
  status: MembershipStatus;
  invited_by: string | null;
  accepted_at: Timestamp | null;
  removed_at: Timestamp | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export type BusinessModeStatus =
  'onboarding' | 'pending_review' | 'active' | 'rejected' | 'suspended';

export interface BusinessModesTable {
  id: Id;
  business_id: string;
  mode: 'shop' | 'services';
  status: Generated<BusinessModeStatus>;
  activated_by: string;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
  submitted_at: Timestamp | null;
  reviewed_at: Timestamp | null;
  review_reason: string | null;
}

export type AdminStatus = 'invited' | 'active' | 'suspended';

export interface AdminAccountsTable {
  id: Id;
  email: string;
  display_name: string;
  password_hash: string | null;
  status: Generated<AdminStatus>;
  mfa_secret_enc: string | null;
  mfa_enabled_at: Timestamp | null;
  // bigint comes back from pg as a string.
  mfa_last_step: ColumnType<string | null, number | null | undefined, number | null>;
  invite_token_hash: string | null;
  invite_expires_at: Timestamp | null;
  invited_by: string | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface AdminRolesTable {
  id: Id;
  admin_id: string;
  role: string;
  granted_by: string | null;
  created_at: CreatedAt;
}

export interface AuditLogsTable {
  id: Id;
  actor_type: 'user' | 'admin' | 'system';
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  business_id: string | null;
  reason: string | null;
  redacted_diff: Json | null;
  request_id: string | null;
  created_at: CreatedAt;
}

export interface OutboxTable {
  id: Id;
  event_type: string;
  payload: Json;
  status: Generated<'pending' | 'processing' | 'sent' | 'failed'>;
  attempts: Generated<number>;
  available_at: Timestamp;
  last_error: string | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export type DocumentKind = 'trade_license' | 'tax_certificate' | 'owner_identity' | 'other';
export type DocumentStatus = 'pending_upload' | 'clean' | 'infected' | 'rejected' | 'archived';
export type UploadRejection = 'type_mismatch' | 'too_large' | 'empty' | 'malware' | 'dimensions';

export interface VerificationDocumentsTable {
  id: Id;
  business_id: string;
  kind: DocumentKind;
  object_key: string;
  file_name: string;
  content_type: string;
  declared_size_bytes: number;
  size_bytes: number | null;
  sha256: string | null;
  status: Generated<DocumentStatus>;
  rejection_reason: UploadRejection | null;
  upload_expires_at: Timestamp;
  uploaded_at: Timestamp | null;
  uploaded_by: string;
  archived_at: Timestamp | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export type MediaPurpose = 'storefront_logo' | 'storefront_banner';

export interface MediaTable {
  id: Id;
  business_id: string;
  purpose: MediaPurpose;
  object_key: string;
  content_type: string;
  declared_size_bytes: number;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  status: Generated<'pending_upload' | 'ready' | 'rejected'>;
  rejection_reason: UploadRejection | null;
  upload_expires_at: Timestamp;
  uploaded_at: Timestamp | null;
  created_by: string;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

type LocalizedOrNull = ColumnType<
  { en: string; ar: string } | null,
  string | null | undefined,
  string | null
>;

export interface StorefrontsTable {
  id: Id;
  business_id: string;
  name: LocalizedOrNull;
  description: LocalizedOrNull;
  logo_media_id: string | null;
  banner_media_id: string | null;
  live_name: LocalizedOrNull;
  live_description: LocalizedOrNull;
  live_logo_media_id: string | null;
  live_banner_media_id: string | null;
  published_at: Timestamp | null;
  changes_submitted_at: Timestamp | null;
  changes_review_reason: string | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface CategoriesTable {
  id: Id;
  parent_id: string | null;
  mode: 'shop' | 'services';
  slug: string;
  name: Localized;
  /** Set by trigger from the parent. */
  depth: Generated<number>;
  sort_order: Generated<number>;
  status: Generated<'active' | 'archived'>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface BrandsTable {
  id: Id;
  slug: string;
  name: Localized;
  status: Generated<'active' | 'archived'>;
  created_by: string | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface Database {
  emirates: EmiratesTable;
  users: UsersTable;
  verification_challenges: VerificationChallengesTable;
  sessions: SessionsTable;
  addresses: AddressesTable;
  businesses: BusinessesTable;
  memberships: MembershipsTable;
  business_modes: BusinessModesTable;
  admin_accounts: AdminAccountsTable;
  admin_roles: AdminRolesTable;
  admin_sessions: AdminSessionsTable;
  audit_logs: AuditLogsTable;
  outbox: OutboxTable;
  verification_documents: VerificationDocumentsTable;
  media: MediaTable;
  storefronts: StorefrontsTable;
  categories: CategoriesTable;
  brands: BrandsTable;
}

/** Every column of every table, used by the drift test. Keep in the same order as above. */
export const SCHEMA_COLUMNS: { [T in keyof Database]: readonly (keyof Database[T] & string)[] } = {
  emirates: ['id', 'code', 'name', 'enabled', 'sort_order', 'created_at', 'updated_at'],
  users: [
    'id',
    'email',
    'email_verified_at',
    'phone',
    'phone_verified_at',
    'password_hash',
    'status',
    'display_name',
    'locale',
    'emirate_code',
    'preferred_mode',
    'terms_version',
    'terms_accepted_at',
    'marketing_consent',
    'marketing_consent_at',
    'created_at',
    'updated_at',
  ],
  verification_challenges: [
    'id',
    'user_id',
    'purpose',
    'channel',
    'destination',
    'code_hash',
    'expires_at',
    'resend_available_at',
    'send_count',
    'attempts',
    'max_attempts',
    'consumed_at',
    'created_at',
    'updated_at',
  ],
  sessions: [
    'id',
    'user_id',
    'refresh_hash',
    'generation',
    'expires_at',
    'absolute_expires_at',
    'last_used_at',
    'revoked_at',
    'revoke_reason',
    'user_agent',
    'created_at',
    'updated_at',
  ],
  addresses: [
    'id',
    'user_id',
    'label',
    'emirate_code',
    'area',
    'street',
    'building',
    'unit',
    'directions',
    'latitude',
    'longitude',
    'is_default',
    'archived_at',
    'created_at',
    'updated_at',
  ],
  businesses: [
    'id',
    'display_name',
    'status',
    'legal_name',
    'license_expiry',
    'tax_id',
    'psp_account_ref',
    'created_by',
    'created_at',
    'updated_at',
    'trade_license_number',
    'license_authority',
    'tax_registered',
    'address_emirate_code',
    'address_area',
    'address_street',
    'address_building',
    'address_unit',
    'agreement_version',
    'agreement_accepted_at',
    'agreement_accepted_by',
    'submitted_at',
    'reviewed_at',
    'reviewed_by',
    'review_reason',
    'suspended_at',
    'suspension_reason',
    'version',
  ],
  memberships: [
    'id',
    'business_id',
    'user_id',
    'permissions',
    'status',
    'invited_by',
    'accepted_at',
    'removed_at',
    'created_at',
    'updated_at',
  ],
  business_modes: [
    'id',
    'business_id',
    'mode',
    'status',
    'activated_by',
    'created_at',
    'updated_at',
    'submitted_at',
    'reviewed_at',
    'review_reason',
  ],
  admin_accounts: [
    'id',
    'email',
    'display_name',
    'password_hash',
    'status',
    'mfa_secret_enc',
    'mfa_enabled_at',
    'mfa_last_step',
    'invite_token_hash',
    'invite_expires_at',
    'invited_by',
    'created_at',
    'updated_at',
  ],
  admin_roles: ['id', 'admin_id', 'role', 'granted_by', 'created_at'],
  admin_sessions: [
    'id',
    'admin_id',
    'refresh_hash',
    'generation',
    'expires_at',
    'absolute_expires_at',
    'last_used_at',
    'revoked_at',
    'revoke_reason',
    'user_agent',
    'created_at',
    'updated_at',
  ],
  audit_logs: [
    'id',
    'actor_type',
    'actor_id',
    'action',
    'target_type',
    'target_id',
    'business_id',
    'reason',
    'redacted_diff',
    'request_id',
    'created_at',
  ],
  outbox: [
    'id',
    'event_type',
    'payload',
    'status',
    'attempts',
    'available_at',
    'last_error',
    'created_at',
    'updated_at',
  ],
  verification_documents: [
    'id',
    'business_id',
    'kind',
    'object_key',
    'file_name',
    'content_type',
    'declared_size_bytes',
    'size_bytes',
    'sha256',
    'status',
    'rejection_reason',
    'upload_expires_at',
    'uploaded_at',
    'uploaded_by',
    'archived_at',
    'created_at',
    'updated_at',
  ],
  media: [
    'id',
    'business_id',
    'purpose',
    'object_key',
    'content_type',
    'declared_size_bytes',
    'size_bytes',
    'width',
    'height',
    'status',
    'rejection_reason',
    'upload_expires_at',
    'uploaded_at',
    'created_by',
    'created_at',
    'updated_at',
  ],
  storefronts: [
    'id',
    'business_id',
    'name',
    'description',
    'logo_media_id',
    'banner_media_id',
    'live_name',
    'live_description',
    'live_logo_media_id',
    'live_banner_media_id',
    'published_at',
    'changes_submitted_at',
    'changes_review_reason',
    'created_at',
    'updated_at',
  ],
  categories: [
    'id',
    'parent_id',
    'mode',
    'slug',
    'name',
    'depth',
    'sort_order',
    'status',
    'created_at',
    'updated_at',
  ],
  brands: ['id', 'slug', 'name', 'status', 'created_by', 'created_at', 'updated_at'],
};

export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;
export type Address = Selectable<AddressesTable>;
export type Business = Selectable<BusinessesTable>;
export type Membership = Selectable<MembershipsTable>;
export type AdminAccount = Selectable<AdminAccountsTable>;
