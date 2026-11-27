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

export type MediaPurpose = 'storefront_logo' | 'storefront_banner' | 'product_image';

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

export type TaxClass = 'standard' | 'zero_rated' | 'exempt';

export interface TaxRatesTable {
  id: Id;
  tax_class: TaxClass;
  rate_bps: number;
  effective_at: Timestamp;
  created_at: CreatedAt;
}

export type ProductStatus =
  'draft' | 'submitted' | 'active' | 'rejected' | 'suspended' | 'archived';

export interface ProductsTable {
  id: Id;
  business_id: string;
  mode: Generated<'shop'>;
  category_id: string;
  brand_id: string | null;
  title: Localized;
  description: Localized;
  details: LocalizedOrNull;
  return_eligible: Generated<boolean>;
  status: Generated<ProductStatus>;
  live_title: LocalizedOrNull;
  live_description: LocalizedOrNull;
  live_details: LocalizedOrNull;
  live_category_id: string | null;
  live_brand_id: string | null;
  live_return_eligible: boolean | null;
  live_media_ids: ColumnType<string[], string[] | undefined, string[]>;
  published_at: Timestamp | null;
  submitted_at: Timestamp | null;
  changes_submitted_at: Timestamp | null;
  reviewed_at: Timestamp | null;
  reviewed_by: string | null;
  review_reason: string | null;
  suspension_reason: string | null;
  archived_at: Timestamp | null;
  version: Generated<number>;
  created_by: string;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface ProductMediaTable {
  product_id: string;
  business_id: string;
  media_id: string;
  sort_order: number;
  created_at: CreatedAt;
}

export interface VariantsTable {
  id: Id;
  product_id: string;
  business_id: string;
  sku: string;
  name: Localized;
  barcode: string | null;
  price_fils: number;
  tax_class: Generated<TaxClass>;
  stock_on_hand: Generated<number>;
  stock_reserved: Generated<number>;
  low_stock_threshold: Generated<number>;
  weight_grams: number | null;
  sort_order: Generated<number>;
  status: Generated<'active' | 'archived'>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export type StockReason =
  'initial_stock' | 'restock' | 'damaged' | 'lost' | 'correction' | 'return_restock' | 'sale';

export interface StockMovementsTable {
  id: Id;
  variant_id: string;
  business_id: string;
  delta: number;
  reason: StockReason;
  note: string | null;
  order_id: string | null;
  actor_type: 'user' | 'admin' | 'system';
  actor_id: string | null;
  on_hand_after: number;
  created_at: CreatedAt;
}

export interface DeliveryZonesTable {
  id: Id;
  business_id: string;
  emirate_code: string;
  fee_fils: number;
  free_over_fils: number | null;
  min_days: number;
  max_days: number;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface CartsTable {
  id: Id;
  user_id: string | null;
  guest_token_hash: string | null;
  status: Generated<'active' | 'merged'>;
  merged_into: string | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface CartItemsTable {
  id: Id;
  cart_id: string;
  variant_id: string;
  qty: number;
  price_seen_fils: number;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

interface Totals {
  subtotal_fils: number;
  delivery_fils: number;
  discount_fils: Generated<number>;
  tax_fils: number;
  total_fils: number;
}

export interface QuotesTable extends Totals {
  id: Id;
  user_id: string;
  cart_id: string;
  address_id: string;
  address_snapshot: Json;
  breakdown: Json;
  currency: Generated<'AED'>;
  expires_at: Timestamp;
  created_at: CreatedAt;
}

export type OrderStatus =
  'pending_payment' | 'paid' | 'failed' | 'expired' | 'partially_refunded' | 'refunded';

export interface OrdersTable extends Totals {
  id: Id;
  user_id: string;
  quote_id: string;
  cart_id: string;
  status: Generated<OrderStatus>;
  currency: Generated<'AED'>;
  address_snapshot: Json;
  payment_expires_at: Timestamp;
  paid_at: Timestamp | null;
  failed_at: Timestamp | null;
  expired_at: Timestamp | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export type MerchantOrderStatus =
  'pending_payment' | 'paid' | 'processing' | 'shipped' | 'delivered' | 'canceled';

export interface MerchantOrdersTable extends Totals {
  id: Id;
  order_id: string;
  business_id: string;
  status: Generated<MerchantOrderStatus>;
  cancel_reason:
    'payment_failed' | 'payment_expired' | 'customer_request' | 'merchant_request' | null;
  delivery_snapshot: Json;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface OrderItemsTable {
  id: Id;
  order_id: string;
  merchant_order_id: string;
  business_id: string;
  product_id: string;
  variant_id: string;
  qty: number;
  unit_price_fils: number;
  line_total_fils: number;
  discount_fils: Generated<number>;
  tax_class: TaxClass;
  tax_rate_bps: number;
  tax_fils: number;
  snapshot: Json;
  created_at: CreatedAt;
}

export interface ReservationsTable {
  id: Id;
  order_id: string;
  variant_id: string;
  business_id: string;
  qty: number;
  expires_at: Timestamp;
  status: Generated<'active' | 'converted' | 'released'>;
  released_reason: 'payment_failed' | 'expired' | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export type PaymentStatus =
  | 'requires_payment'
  | 'succeeded'
  | 'failed'
  | 'refund_pending'
  | 'partially_refunded'
  | 'refunded'
  | 'refund_failed';

export interface PaymentsTable {
  id: Id;
  target_type: 'order' | 'booking';
  order_id: string | null;
  provider: 'mock';
  provider_intent_id: string | null;
  idempotency_key: string;
  amount_fils: number;
  currency: Generated<'AED'>;
  status: Generated<PaymentStatus>;
  client_secret: string | null;
  failure_code: string | null;
  needs_attention: Generated<boolean>;
  succeeded_at: Timestamp | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
  booking_id: string | null;
}

export type RefundReason = 'late_payment' | 'customer_cancellation' | 'business_cancellation';

export interface RefundsTable {
  id: Id;
  payment_id: string;
  amount_fils: number;
  reason: RefundReason;
  status: Generated<'pending' | 'succeeded' | 'failed'>;
  provider_ref: string | null;
  failure_code: string | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface WebhookEventsTable {
  id: Id;
  provider: 'mock';
  event_id: string;
  event_type: string;
  payload_hash: string;
  outcome: Generated<string>;
  received_at: CreatedAt;
}

export interface IdempotencyKeysTable {
  id: Id;
  actor_type: 'user' | 'admin';
  actor_id: string;
  route: string;
  key: string;
  request_hash: string;
  status: Generated<'in_progress' | 'completed'>;
  response_status: number | null;
  response_body: Json | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

// Phase 4: services and booking ---------------------------------------------------------------

export interface BranchesTable {
  id: Id;
  business_id: string;
  name: Localized;
  emirate_code: string;
  area: string;
  street: string;
  building: string;
  latitude: ColumnType<string | null, number | null | undefined, number | null>;
  longitude: ColumnType<string | null, number | null | undefined, number | null>;
  timezone: Generated<string>;
  status: Generated<'active' | 'archived'>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface BranchHoursTable {
  branch_id: string;
  weekday: number;
  opens_at: string;
  closes_at: string;
}

export interface BranchClosuresTable {
  id: Id;
  branch_id: string;
  starts_at: Timestamp;
  ends_at: Timestamp;
  reason: string | null;
  created_by: string;
  created_at: CreatedAt;
}

export type ServiceStatus = 'active' | 'suspended' | 'archived';

export interface ServicesTable {
  id: Id;
  business_id: string;
  mode: Generated<'services'>;
  category_id: string;
  title: Localized;
  description: Localized;
  price_fils: number;
  tax_class: Generated<TaxClass>;
  duration_min: number;
  buffer_before_min: Generated<number>;
  buffer_after_min: Generated<number>;
  cancel_cutoff_hours: Generated<number>;
  late_cancel_refund_bps: Generated<number>;
  status: Generated<ServiceStatus>;
  suspension_reason: string | null;
  version: Generated<number>;
  created_by: string;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface BranchServicesTable {
  branch_id: string;
  service_id: string;
  business_id: string;
}

export interface StaffTable {
  id: Id;
  business_id: string;
  membership_id: string | null;
  display_name: string;
  status: Generated<'active' | 'archived'>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface StaffBranchesTable {
  staff_id: string;
  branch_id: string;
  business_id: string;
}

export interface StaffServicesTable {
  staff_id: string;
  service_id: string;
  business_id: string;
}

export interface ShiftsTable {
  id: Id;
  staff_id: string;
  branch_id: string;
  business_id: string;
  weekday: number;
  starts_at: string;
  ends_at: string;
  created_at: CreatedAt;
}

export type BlockKind = 'break' | 'leave' | 'other';

export interface ScheduleBlocksTable {
  id: Id;
  staff_id: string;
  business_id: string;
  starts_at: Timestamp;
  ends_at: Timestamp;
  kind: BlockKind;
  reason: string | null;
  created_by: string;
  created_at: CreatedAt;
}

export type BookingStatus =
  'held' | 'confirmed' | 'checked_in' | 'completed' | 'canceled' | 'no_show' | 'expired';

export interface BookingsTable {
  id: Id;
  user_id: string | null;
  business_id: string;
  branch_id: string;
  service_id: string;
  staff_id: string;
  start_at: Timestamp;
  end_at: Timestamp;
  occupied_start: Timestamp;
  occupied_end: Timestamp;
  status: BookingStatus;
  hold_expires_at: Timestamp | null;
  source: 'customer' | 'manual';
  payment_mode: 'prepaid' | 'pay_at_venue';
  price_fils: number;
  tax_fils: number;
  currency: Generated<'AED'>;
  snapshot: Json;
  policy_snapshot: Json;
  customer_name: string | null;
  customer_phone: string | null;
  note: string | null;
  canceled_by: 'customer' | 'business' | 'system' | null;
  cancel_reason: string | null;
  refund_fils: number | null;
  created_by: string | null;
  confirmed_at: Timestamp | null;
  checked_in_at: Timestamp | null;
  completed_at: Timestamp | null;
  canceled_at: Timestamp | null;
  no_show_at: Timestamp | null;
  expired_at: Timestamp | null;
  rescheduled_count: Generated<number>;
  version: Generated<number>;
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
  tax_rates: TaxRatesTable;
  products: ProductsTable;
  product_media: ProductMediaTable;
  variants: VariantsTable;
  stock_movements: StockMovementsTable;
  delivery_zones: DeliveryZonesTable;
  carts: CartsTable;
  cart_items: CartItemsTable;
  quotes: QuotesTable;
  orders: OrdersTable;
  merchant_orders: MerchantOrdersTable;
  order_items: OrderItemsTable;
  reservations: ReservationsTable;
  payments: PaymentsTable;
  refunds: RefundsTable;
  webhook_events: WebhookEventsTable;
  idempotency_keys: IdempotencyKeysTable;
  branches: BranchesTable;
  branch_hours: BranchHoursTable;
  branch_closures: BranchClosuresTable;
  services: ServicesTable;
  branch_services: BranchServicesTable;
  staff: StaffTable;
  staff_branches: StaffBranchesTable;
  staff_services: StaffServicesTable;
  shifts: ShiftsTable;
  schedule_blocks: ScheduleBlocksTable;
  bookings: BookingsTable;
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
  tax_rates: ['id', 'tax_class', 'rate_bps', 'effective_at', 'created_at'],
  products: [
    'id',
    'business_id',
    'mode',
    'category_id',
    'brand_id',
    'title',
    'description',
    'details',
    'return_eligible',
    'status',
    'live_title',
    'live_description',
    'live_details',
    'live_category_id',
    'live_brand_id',
    'live_return_eligible',
    'live_media_ids',
    'published_at',
    'submitted_at',
    'changes_submitted_at',
    'reviewed_at',
    'reviewed_by',
    'review_reason',
    'suspension_reason',
    'archived_at',
    'version',
    'created_by',
    'created_at',
    'updated_at',
  ],
  product_media: ['product_id', 'business_id', 'media_id', 'sort_order', 'created_at'],
  variants: [
    'id',
    'product_id',
    'business_id',
    'sku',
    'name',
    'barcode',
    'price_fils',
    'tax_class',
    'stock_on_hand',
    'stock_reserved',
    'low_stock_threshold',
    'weight_grams',
    'sort_order',
    'status',
    'created_at',
    'updated_at',
  ],
  stock_movements: [
    'id',
    'variant_id',
    'business_id',
    'delta',
    'reason',
    'note',
    'order_id',
    'actor_type',
    'actor_id',
    'on_hand_after',
    'created_at',
  ],
  delivery_zones: [
    'id',
    'business_id',
    'emirate_code',
    'fee_fils',
    'free_over_fils',
    'min_days',
    'max_days',
    'created_at',
    'updated_at',
  ],
  carts: ['id', 'user_id', 'guest_token_hash', 'status', 'merged_into', 'created_at', 'updated_at'],
  cart_items: ['id', 'cart_id', 'variant_id', 'qty', 'price_seen_fils', 'created_at', 'updated_at'],
  quotes: [
    'id',
    'user_id',
    'cart_id',
    'address_id',
    'address_snapshot',
    'breakdown',
    'subtotal_fils',
    'delivery_fils',
    'discount_fils',
    'tax_fils',
    'total_fils',
    'currency',
    'expires_at',
    'created_at',
  ],
  orders: [
    'id',
    'user_id',
    'quote_id',
    'cart_id',
    'status',
    'subtotal_fils',
    'delivery_fils',
    'discount_fils',
    'tax_fils',
    'total_fils',
    'currency',
    'address_snapshot',
    'payment_expires_at',
    'paid_at',
    'failed_at',
    'expired_at',
    'created_at',
    'updated_at',
  ],
  merchant_orders: [
    'id',
    'order_id',
    'business_id',
    'status',
    'cancel_reason',
    'subtotal_fils',
    'delivery_fils',
    'discount_fils',
    'tax_fils',
    'total_fils',
    'delivery_snapshot',
    'created_at',
    'updated_at',
  ],
  order_items: [
    'id',
    'order_id',
    'merchant_order_id',
    'business_id',
    'product_id',
    'variant_id',
    'qty',
    'unit_price_fils',
    'line_total_fils',
    'discount_fils',
    'tax_class',
    'tax_rate_bps',
    'tax_fils',
    'snapshot',
    'created_at',
  ],
  reservations: [
    'id',
    'order_id',
    'variant_id',
    'business_id',
    'qty',
    'expires_at',
    'status',
    'released_reason',
    'created_at',
    'updated_at',
  ],
  payments: [
    'id',
    'target_type',
    'order_id',
    'provider',
    'provider_intent_id',
    'idempotency_key',
    'amount_fils',
    'currency',
    'status',
    'client_secret',
    'failure_code',
    'needs_attention',
    'succeeded_at',
    'created_at',
    'updated_at',
    'booking_id',
  ],
  refunds: [
    'id',
    'payment_id',
    'amount_fils',
    'reason',
    'status',
    'provider_ref',
    'failure_code',
    'created_at',
    'updated_at',
  ],
  webhook_events: [
    'id',
    'provider',
    'event_id',
    'event_type',
    'payload_hash',
    'outcome',
    'received_at',
  ],
  idempotency_keys: [
    'id',
    'actor_type',
    'actor_id',
    'route',
    'key',
    'request_hash',
    'status',
    'response_status',
    'response_body',
    'created_at',
    'updated_at',
  ],
  branches: [
    'id',
    'business_id',
    'name',
    'emirate_code',
    'area',
    'street',
    'building',
    'latitude',
    'longitude',
    'timezone',
    'status',
    'created_at',
    'updated_at',
  ],
  branch_hours: ['branch_id', 'weekday', 'opens_at', 'closes_at'],
  branch_closures: [
    'id',
    'branch_id',
    'starts_at',
    'ends_at',
    'reason',
    'created_by',
    'created_at',
  ],
  services: [
    'id',
    'business_id',
    'mode',
    'category_id',
    'title',
    'description',
    'price_fils',
    'tax_class',
    'duration_min',
    'buffer_before_min',
    'buffer_after_min',
    'cancel_cutoff_hours',
    'late_cancel_refund_bps',
    'status',
    'suspension_reason',
    'version',
    'created_by',
    'created_at',
    'updated_at',
  ],
  branch_services: ['branch_id', 'service_id', 'business_id'],
  staff: [
    'id',
    'business_id',
    'membership_id',
    'display_name',
    'status',
    'created_at',
    'updated_at',
  ],
  staff_branches: ['staff_id', 'branch_id', 'business_id'],
  staff_services: ['staff_id', 'service_id', 'business_id'],
  shifts: [
    'id',
    'staff_id',
    'branch_id',
    'business_id',
    'weekday',
    'starts_at',
    'ends_at',
    'created_at',
  ],
  schedule_blocks: [
    'id',
    'staff_id',
    'business_id',
    'starts_at',
    'ends_at',
    'kind',
    'reason',
    'created_by',
    'created_at',
  ],
  bookings: [
    'id',
    'user_id',
    'business_id',
    'branch_id',
    'service_id',
    'staff_id',
    'start_at',
    'end_at',
    'occupied_start',
    'occupied_end',
    'status',
    'hold_expires_at',
    'source',
    'payment_mode',
    'price_fils',
    'tax_fils',
    'currency',
    'snapshot',
    'policy_snapshot',
    'customer_name',
    'customer_phone',
    'note',
    'canceled_by',
    'cancel_reason',
    'refund_fils',
    'created_by',
    'confirmed_at',
    'checked_in_at',
    'completed_at',
    'canceled_at',
    'no_show_at',
    'expired_at',
    'rescheduled_count',
    'version',
    'created_at',
    'updated_at',
  ],
};

export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;
export type Address = Selectable<AddressesTable>;
export type Business = Selectable<BusinessesTable>;
export type Membership = Selectable<MembershipsTable>;
export type AdminAccount = Selectable<AdminAccountsTable>;
