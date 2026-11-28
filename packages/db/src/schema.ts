import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

/**
 * Kysely table types for the SQL migrations in ../migrations (ADR-0004).
 *
 * These are written by hand next to the SQL. `schema.int.test.ts` compares every table and column
 * here with the live database after migrating, so the two cannot drift silently.
 */

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

/** Payment providers with an adapter (ADR-0030). */
export type PaymentProviderName = 'mock' | 'stripe';
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
  created_at: CreatedAt;
  updated_at: UpdatedAt;
  marketing_email: Generated<boolean>;
  marketing_sms: Generated<boolean>;
  marketing_push: Generated<boolean>;
  notify_email: Generated<boolean>;
  notify_sms: Generated<boolean>;
  notify_push: Generated<boolean>;
  deleted_at: Timestamp | null;
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

/** `account_deleted` is for user sessions only (migration 0008). */
export type RevokeReason =
  'logout' | 'refresh_reuse' | 'password_reset' | 'admin' | 'account_deleted';

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
  /** Migration 0016 (ADR-0029). */
  return_window_days: Generated<number>;
  return_policy_note: LocalizedOrNull;
  psp_account_id: string | null;
  psp_account_provider: PaymentProviderName | null;
  psp_details_submitted: Generated<boolean>;
  psp_payouts_enabled: Generated<boolean>;
  psp_account_updated_at: Timestamp | null;
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

export type DocumentKind =
  'trade_license' | 'tax_certificate' | 'owner_identity' | 'other' | 'home_service_license';
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

export type MediaPurpose =
  'storefront_logo' | 'storefront_banner' | 'product_image' | 'portfolio_image';

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
  /** Switched off by an admin without archiving (migration 0009). */
  enabled: Generated<boolean>;
  returnable: Generated<boolean>;
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
  compare_at_fils: number | null;
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
  method: Generated<'standard' | 'express'>;
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
  delivered_at: Timestamp | null;
  processing_at: Timestamp | null;
  shipped_at: Timestamp | null;
  canceled_at: Timestamp | null;
  carrier: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  return_window_days: Generated<number | null>;
  delivery_partner: Generated<'mock' | null>;
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
  returnable: Generated<boolean>;
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
  provider: PaymentProviderName;
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
  reconciled_at: Timestamp | null;
}

export type RefundReason =
  | 'late_payment'
  | 'customer_cancellation'
  | 'business_cancellation'
  | 'no_show'
  | 'admin'
  | 'return';

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
  merchant_order_id: string | null;
  refund_request_id: string | null;
  return_request_id: string | null;
  non_commissionable_fils: number | null;
}

export interface WebhookEventsTable {
  id: Id;
  provider: PaymentProviderName;
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
export type ServiceLocationMode = 'in_venue' | 'home' | 'both';

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
  location_mode: Generated<ServiceLocationMode>;
  no_show_refund_bps: Generated<number>;
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
  bio: LocalizedOrNull;
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
  location_type: Generated<'venue' | 'home'>;
  home_address: ColumnType<HomeAddress | null, string | null | undefined, string | null>;
  travel_fee_fils: Generated<number>;
  travel_buffer_min: Generated<number>;
  addons: ColumnType<BookedAddon[], string | undefined, string>;
  addons_fils: Generated<number>;
  reminder_sent_at: Timestamp | null;
  travel_status: 'not_started' | 'on_the_way' | 'arrived' | null;
}

/** An add-on as booked (T13): later edits never change a booking. */
export interface BookedAddon {
  id: string;
  title: { en: string; ar: string };
  priceFils: number;
  durationMin: number;
}

export interface ServiceAddonsTable {
  id: Id;
  business_id: string;
  service_id: string;
  title: Localized;
  price_fils: number;
  duration_min: number;
  status: Generated<'active' | 'archived'>;
  sort_order: Generated<number>;
  created_by: string;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface PortfolioItemsTable {
  id: Id;
  business_id: string;
  media_id: string;
  service_id: string | null;
  staff_id: string | null;
  caption: LocalizedOrNull;
  sort_order: Generated<number>;
  created_by: string;
  created_at: CreatedAt;
}

export type WaitlistStatus = 'active' | 'notified' | 'canceled' | 'expired';

export interface BookingWaitlistTable {
  id: Id;
  user_id: string;
  business_id: string;
  branch_id: string;
  service_id: string;
  staff_id: string | null;
  /** A local date; read it with to_char to avoid time zone shifts. */
  date: ColumnType<Date, string, string>;
  window_start: Generated<string>;
  window_end: Generated<string>;
  status: Generated<WaitlistStatus>;
  notified_booking_id: string | null;
  notified_at: Timestamp | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

/** The customer's address as booked for a home visit (T13). */
export interface HomeAddress {
  addressId: string;
  label: string | null;
  emirate: string;
  area: string;
  street: string;
  building: string;
  unit: string | null;
  directions: string | null;
}

export interface WishlistItemsTable {
  user_id: string;
  product_id: string;
  created_at: CreatedAt;
}

export interface StockAlertsTable {
  id: Id;
  user_id: string;
  variant_id: string;
  created_at: CreatedAt;
  notified_at: Timestamp | null;
}

export type HomeServiceStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'suspended';

export interface HomeServiceProfilesTable {
  business_id: string;
  status: Generated<HomeServiceStatus>;
  license_number: string | null;
  license_authority: string | null;
  license_expiry: ColumnType<Date | null, string | null | undefined, string | null>;
  license_document_id: string | null;
  travel_buffer_min: Generated<number>;
  min_order_fils: Generated<number>;
  submitted_at: Timestamp | null;
  reviewed_at: Timestamp | null;
  reviewed_by: string | null;
  review_reason: string | null;
  version: Generated<number>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface HomeServiceAreasTable {
  id: Id;
  business_id: string;
  emirate_code: string;
  area: string | null;
  travel_fee_fils: number;
  created_at: CreatedAt;
}

// Phase 5: finance (ADR-0015) -------------------------------------------------------------------

export type FinanceMode = 'shop' | 'services';

export interface FeeRulesTable {
  id: Id;
  mode: FinanceMode;
  business_id: string | null;
  commission_bps: number;
  effective_at: Timestamp;
  reason: string;
  created_by: string | null;
  created_at: CreatedAt;
  category_id: string | null;
}

export type FinanceSettingKey =
  | 'refund_approval_threshold_fils'
  | 'payout_dispute_window_days'
  | 'payout_minimum_fils'
  | 'platform_vat_registered'
  | 'commission_vat_bps'
  | 'payout_weekday';

export interface FinanceSettingsTable {
  id: Id;
  key: FinanceSettingKey;
  value: number;
  effective_at: Timestamp;
  reason: string;
  created_by: string | null;
  created_at: CreatedAt;
}

export type PayoutStatus = 'pending' | 'paid' | 'failed';

export interface PayoutsTable {
  id: Id;
  business_id: string;
  amount_fils: number;
  currency: Generated<'AED'>;
  status: Generated<PayoutStatus>;
  provider: PaymentProviderName;
  provider_ref: string | null;
  failure_code: string | null;
  needs_attention: Generated<boolean>;
  created_by: string | null;
  paid_at: Timestamp | null;
  failed_at: Timestamp | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export type EarningStatus = 'pending' | 'eligible' | 'in_payout' | 'paid_out';

/** 0% commission for a pilot merchant's first 30 days (ADR-0025, ADR-0034). */
export interface PilotPromotionsTable {
  id: Id;
  business_id: string;
  starts_at: Timestamp;
  ends_at: Timestamp;
  founder_approval: string;
  created_by: string;
  created_at: CreatedAt;
  cancelled_at: Timestamp | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  notified_7d_at: Timestamp | null;
  notified_1d_at: Timestamp | null;
}

export interface MerchantEarningsTable {
  id: Id;
  business_id: string;
  source_type: 'merchant_order' | 'booking';
  merchant_order_id: string | null;
  booking_id: string | null;
  payment_id: string;
  mode: FinanceMode;
  gross_fils: number;
  commission_base_fils: number;
  commission_bps: number;
  fee_rule_id: string | null;
  commission_fils: number;
  refunded_fils: Generated<number>;
  commission_refunded_fils: Generated<number>;
  status: Generated<EarningStatus>;
  eligible_at: Timestamp | null;
  payout_id: string | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
  commission_vat_bps: Generated<number>;
  commission_vat_fils: Generated<number>;
  commission_vat_refunded_fils: Generated<number>;
  commission_detail: ColumnType<CommissionDetailLine[], string | undefined, string>;
  non_commissionable_fils: Generated<number>;
  non_commissionable_refunded_fils: Generated<number>;
  pilot_promotion_id: string | null;
}

/** How one line's commission was worked out, copied onto the earning at capture. */
export interface CommissionDetailLine {
  ref: string;
  categoryId: string | null;
  feeRuleId: string | null;
  commissionBps: number;
  baseFils: number;
  commissionFils: number;
}

export type TaxDocumentKind =
  'customer_invoice' | 'customer_credit_note' | 'commission_invoice' | 'commission_credit_note';

export interface TaxDocumentLine {
  description: { en: string; ar: string };
  qty: number;
  totalFils: number;
  vatRateBps: number;
  vatFils: number;
}

export interface TaxParty {
  name: { en: string; ar: string };
  trn: string | null;
  address?: string | null;
  email?: string | null;
}

export interface DocumentSequencesTable {
  issuer_key: string;
  prefix: string;
  year: number;
  last_number: number;
}

export interface TaxDocumentsTable {
  id: Id;
  kind: TaxDocumentKind;
  issuer: 'business' | 'platform';
  business_id: string;
  customer_user_id: string | null;
  number: string;
  earning_id: string;
  source_type: 'merchant_earning' | 'refund' | 'dispute';
  source_id: string;
  credits_document_id: string | null;
  tax_document: boolean;
  seller: ColumnType<TaxParty, string, never>;
  buyer: ColumnType<TaxParty, string, never>;
  lines: ColumnType<TaxDocumentLine[], string, never>;
  net_fils: number;
  vat_fils: number;
  total_fils: number;
  currency: Generated<'AED'>;
  rules_approved: boolean;
  issued_at: Timestamp;
  created_at: CreatedAt;
}

export interface PayoutRunsTable {
  id: Id;
  scheduled_for: ColumnType<Date, string, string>;
  made_eligible: number | null;
  payouts: number | null;
  skipped: number | null;
  finished_at: Timestamp | null;
  created_at: CreatedAt;
}

export type LedgerKind =
  | 'capture'
  | 'late_capture'
  | 'refund'
  | 'late_refund'
  | 'chargeback'
  | 'payout_initiated'
  | 'payout_paid'
  | 'payout_failed';
export type LedgerSourceType = 'merchant_earning' | 'payment' | 'refund' | 'dispute' | 'payout';
export type LedgerAccount =
  | 'psp_clearing'
  | 'merchant_payable'
  | 'payouts_in_transit'
  | 'platform_commission'
  | 'platform_output_vat'
  | 'unallocated_receipts';

export interface LedgerTransactionsTable {
  id: Id;
  kind: LedgerKind;
  source_type: LedgerSourceType;
  source_id: string;
  business_id: string | null;
  memo: string | null;
  occurred_at: Timestamp;
  created_at: CreatedAt;
}

export interface LedgerEntriesTable {
  id: Id;
  transaction_id: string;
  account: LedgerAccount;
  business_id: string | null;
  debit_fils: Generated<number>;
  credit_fils: Generated<number>;
  currency: Generated<'AED'>;
  created_at: CreatedAt;
}

export interface RefundRequestsTable {
  id: Id;
  payment_id: string;
  merchant_order_id: string | null;
  amount_fils: number;
  reason: string;
  threshold_fils: number;
  needs_second_approval: boolean;
  status: Generated<'pending_approval' | 'approved' | 'rejected'>;
  requested_by: string;
  decided_by: string | null;
  decision_note: string | null;
  decided_at: Timestamp | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface DisputesTable {
  id: Id;
  earning_id: string;
  business_id: string;
  amount_fils: number;
  status: Generated<'open' | 'won' | 'lost'>;
  reason: string;
  resolution_note: string | null;
  opened_by: string;
  resolved_by: string | null;
  resolved_at: Timestamp | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface PayoutHoldsTable {
  id: Id;
  business_id: string;
  reason: string;
  placed_by: string;
  released_by: string | null;
  released_at: Timestamp | null;
  created_at: CreatedAt;
}

export interface ReconciliationRunsTable {
  id: Id;
  provider: PaymentProviderName;
  period_start: Timestamp;
  period_end: Timestamp;
  status: Generated<'running' | 'completed' | 'failed'>;
  checked_count: Generated<number>;
  recovered_count: Generated<number>;
  mismatch_count: Generated<number>;
  started_by: string | null;
  started_at: CreatedAt;
  finished_at: Timestamp | null;
  failure: string | null;
}

export type ReconciliationItemKind =
  | 'recovered_missing_webhook'
  | 'amount_mismatch'
  | 'status_mismatch'
  | 'unknown_at_provider'
  | 'unknown_locally';

export interface ReconciliationItemsTable {
  id: Id;
  run_id: string;
  kind: ReconciliationItemKind;
  object_type: 'payment' | 'refund' | 'payout';
  provider_ref: string | null;
  payment_id: string | null;
  refund_id: string | null;
  payout_id: string | null;
  local_amount_fils: number | null;
  provider_amount_fils: number | null;
  local_status: string | null;
  provider_status: string | null;
  resolved_at: Timestamp | null;
  resolved_by: string | null;
  resolution_note: string | null;
  created_at: CreatedAt;
}

// Phase 6 -----------------------------------------------------------------------------------------

export type MerchantOrderEventStatus =
  | 'paid'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'canceled'
  | 'return_requested'
  | 'return_approved'
  | 'return_rejected'
  | 'return_received'
  | 'refunded';

export interface MerchantOrderEventsTable {
  id: Id;
  merchant_order_id: string;
  status: MerchantOrderEventStatus;
  actor_type: 'user' | 'admin' | 'system';
  actor_id: string | null;
  note: string | null;
  created_at: CreatedAt;
}

export type ReturnStatus =
  | 'requested'
  | 'approved'
  | 'rejected'
  | 'received'
  | 'refund_pending'
  | 'refunded'
  | 'refund_failed';

export interface ReturnRequestsTable {
  id: Id;
  merchant_order_id: string;
  order_id: string;
  business_id: string;
  user_id: string;
  status: Generated<ReturnStatus>;
  reason: string;
  amount_fils: number;
  decision_reason: string | null;
  decided_by: string | null;
  decided_at: Timestamp | null;
  received_at: Timestamp | null;
  refund_id: string | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
  faulty: Generated<boolean>;
}

export interface ReturnItemsTable {
  id: Id;
  return_request_id: string;
  order_item_id: string;
  qty: number;
  amount_fils: number;
}

export interface ReviewsTable {
  id: Id;
  user_id: string;
  business_id: string;
  target_type: 'product' | 'booking';
  order_item_id: string | null;
  product_id: string | null;
  booking_id: string | null;
  service_id: string | null;
  rating: number;
  body: string | null;
  status: Generated<'published' | 'hidden'>;
  hidden_reason: string | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface ReviewRepliesTable {
  id: Id;
  review_id: string;
  author_id: string;
  body: string;
  created_at: CreatedAt;
}

export interface ReviewReportsTable {
  id: Id;
  review_id: string;
  business_id: string;
  reported_by: string;
  reason: string;
  resolved_at: Timestamp | null;
  resolved_by: string | null;
  created_at: CreatedAt;
}

export type TicketStatus = 'open' | 'assigned' | 'awaiting_reply' | 'resolved' | 'reopened';
export type TicketType = 'order' | 'booking' | 'payment' | 'account' | 'other';

export interface SupportTicketsTable {
  id: Id;
  user_id: string;
  type: TicketType;
  order_id: string | null;
  booking_id: string | null;
  subject: string;
  status: Generated<TicketStatus>;
  assigned_admin_id: string | null;
  sla_due_at: Timestamp;
  last_message_at: Generated<Date>;
  resolved_at: Timestamp | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
  priority: Generated<TicketPriority>;
  escalation: TicketEscalation | null;
  escalated_at: Timestamp | null;
  first_response_at: Timestamp | null;
}

export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';
export type TicketEscalation = 'payment' | 'security' | 'operations';

export interface TicketAttachmentsTable {
  id: Id;
  ticket_id: string;
  author_type: 'customer' | 'admin';
  author_id: string;
  object_key: string;
  file_name: string;
  content_type: 'application/pdf' | 'image/jpeg' | 'image/png';
  declared_size_bytes: number;
  size_bytes: number | null;
  sha256: string | null;
  status: Generated<'pending_upload' | 'clean' | 'infected' | 'rejected'>;
  rejection_reason: 'type_mismatch' | 'too_large' | 'empty' | 'malware' | null;
  upload_expires_at: Timestamp;
  uploaded_at: Timestamp | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface TicketMessagesTable {
  id: Id;
  ticket_id: string;
  author_type: 'customer' | 'admin';
  author_id: string;
  body: string;
  internal: Generated<boolean>;
  created_at: CreatedAt;
}

export interface NotificationTemplatesTable {
  id: Id;
  event_type: string;
  locale: 'en' | 'ar';
  version: number;
  title: string;
  body: string;
  created_by: string | null;
  created_at: CreatedAt;
}

export interface NotificationsTable {
  id: Id;
  user_id: string;
  outbox_id: string;
  event_type: string;
  title: string;
  body: string;
  link: string | null;
  read_at: Timestamp | null;
  created_at: CreatedAt;
}

export interface NotificationDeliveriesTable {
  id: Id;
  outbox_id: string;
  user_id: string;
  channel: 'email' | 'sms' | 'push';
  sent_at: CreatedAt;
}

/** Emails sent per UTC day, split by priority (ADR-0031). */
export interface EmailUsageTable {
  day: string;
  essential: Generated<number>;
  other: Generated<number>;
  updated_at: Generated<Date>;
}

/** Fixed-window request counters when rate limits are kept in PostgreSQL (ADR-0033). */
export interface RateLimitCountersTable {
  key: string;
  count: number;
  reset_at: Date;
}

export type PushPlatform = 'ios' | 'android' | 'web';

export interface PushDevicesTable {
  id: Id;
  user_id: string;
  token: string;
  platform: PushPlatform;
  created_at: CreatedAt;
  last_seen_at: Generated<Date>;
  revoked_at: Timestamp | null;
  revoke_reason: 'signed_out' | 'invalid' | 'replaced' | null;
}

export type ConsentPurpose = 'marketing_email' | 'marketing_sms' | 'marketing_push';
export type ConsentSource =
  'signup' | 'settings' | 'unsubscribe_link' | 'account_deletion' | 'migration';

export interface ConsentRecordsTable {
  id: Id;
  user_id: string;
  purpose: ConsentPurpose;
  granted: boolean;
  source: ConsentSource;
  locale: 'en' | 'ar';
  policy_version: string;
  request_id: string | null;
  created_at: CreatedAt;
}

export interface AccountDeletionRequestsTable {
  id: Id;
  user_id: string;
  status: Generated<'pending' | 'canceled' | 'completed'>;
  reason: string | null;
  requested_at: Timestamp;
  scheduled_for: Timestamp;
  canceled_at: Timestamp | null;
  completed_at: Timestamp | null;
  postponed_reason: string | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface BookingTravelEventsTable {
  id: Id;
  booking_id: string;
  business_id: string;
  status: 'on_the_way' | 'arrived';
  actor_user_id: string;
  occurred_at: CreatedAt;
}

export type LegalDocumentKindColumn =
  | 'customer_terms'
  | 'merchant_agreement'
  | 'privacy_policy'
  | 'returns_refunds'
  | 'appointment_cancellation'
  | 'home_services'
  | 'marketing_consent'
  | 'prohibited_items'
  | 'review_moderation'
  | 'merchant_licensing'
  | 'authenticity'
  | 'promotional_pricing';

export interface LegalDocumentsTable {
  id: Id;
  kind: LegalDocumentKindColumn;
  version: number;
  title: Localized;
  body: Localized;
  summary_of_changes: string | null;
  status: Generated<'draft' | 'published' | 'retired'>;
  effective_at: Timestamp | null;
  created_by: string | null;
  published_by: string | null;
  published_at: Timestamp | null;
  retired_at: Timestamp | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface LegalAcceptancesTable {
  id: Id;
  user_id: string;
  document_id: string;
  kind: LegalDocumentKindColumn;
  version: number;
  business_id: string | null;
  locale: 'en' | 'ar';
  source: 'sign_up' | 'reaccept' | 'merchant_onboarding';
  request_id: string | null;
  accepted_at: CreatedAt;
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
  fee_rules: FeeRulesTable;
  finance_settings: FinanceSettingsTable;
  payouts: PayoutsTable;
  merchant_earnings: MerchantEarningsTable;
  ledger_transactions: LedgerTransactionsTable;
  ledger_entries: LedgerEntriesTable;
  refund_requests: RefundRequestsTable;
  disputes: DisputesTable;
  payout_holds: PayoutHoldsTable;
  reconciliation_runs: ReconciliationRunsTable;
  reconciliation_items: ReconciliationItemsTable;
  merchant_order_events: MerchantOrderEventsTable;
  return_requests: ReturnRequestsTable;
  return_items: ReturnItemsTable;
  reviews: ReviewsTable;
  review_replies: ReviewRepliesTable;
  review_reports: ReviewReportsTable;
  support_tickets: SupportTicketsTable;
  ticket_messages: TicketMessagesTable;
  ticket_attachments: TicketAttachmentsTable;
  notification_templates: NotificationTemplatesTable;
  notifications: NotificationsTable;
  notification_deliveries: NotificationDeliveriesTable;
  email_usage: EmailUsageTable;
  rate_limit_counters: RateLimitCountersTable;
  pilot_promotions: PilotPromotionsTable;
  push_devices: PushDevicesTable;
  consent_records: ConsentRecordsTable;
  account_deletion_requests: AccountDeletionRequestsTable;
  document_sequences: DocumentSequencesTable;
  tax_documents: TaxDocumentsTable;
  payout_runs: PayoutRunsTable;
  home_service_profiles: HomeServiceProfilesTable;
  home_service_areas: HomeServiceAreasTable;
  wishlist_items: WishlistItemsTable;
  stock_alerts: StockAlertsTable;
  service_addons: ServiceAddonsTable;
  portfolio_items: PortfolioItemsTable;
  booking_waitlist: BookingWaitlistTable;
  booking_travel_events: BookingTravelEventsTable;
  legal_documents: LegalDocumentsTable;
  legal_acceptances: LegalAcceptancesTable;
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
    'created_at',
    'updated_at',
    'marketing_email',
    'marketing_sms',
    'marketing_push',
    'notify_email',
    'notify_sms',
    'notify_push',
    'deleted_at',
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
    'return_window_days',
    'return_policy_note',
    'psp_account_id',
    'psp_account_provider',
    'psp_details_submitted',
    'psp_payouts_enabled',
    'psp_account_updated_at',
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
    'enabled',
    'returnable',
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

    'compare_at_fils',
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
    'method',
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
    'delivered_at',
    'processing_at',
    'shipped_at',
    'canceled_at',
    'carrier',
    'tracking_number',
    'tracking_url',
    'return_window_days',
    'delivery_partner',
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
    'returnable',
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
    'reconciled_at',
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
    'merchant_order_id',
    'refund_request_id',
    'return_request_id',
    'non_commissionable_fils',
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
    'location_mode',
    'no_show_refund_bps',
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
    'bio',
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
    'location_type',
    'home_address',
    'travel_fee_fils',
    'travel_buffer_min',
    'addons',
    'addons_fils',
    'reminder_sent_at',
    'travel_status',
  ],
  fee_rules: [
    'id',
    'mode',
    'business_id',
    'commission_bps',
    'effective_at',
    'reason',
    'created_by',
    'created_at',
    'category_id',
  ],
  finance_settings: ['id', 'key', 'value', 'effective_at', 'reason', 'created_by', 'created_at'],
  payouts: [
    'id',
    'business_id',
    'amount_fils',
    'currency',
    'status',
    'provider',
    'provider_ref',
    'failure_code',
    'needs_attention',
    'created_by',
    'paid_at',
    'failed_at',
    'created_at',
    'updated_at',
  ],
  merchant_earnings: [
    'id',
    'business_id',
    'source_type',
    'merchant_order_id',
    'booking_id',
    'payment_id',
    'mode',
    'gross_fils',
    'commission_base_fils',
    'commission_bps',
    'fee_rule_id',
    'commission_fils',
    'refunded_fils',
    'commission_refunded_fils',
    'status',
    'eligible_at',
    'payout_id',
    'created_at',
    'updated_at',
    'commission_vat_bps',
    'commission_vat_fils',
    'commission_vat_refunded_fils',
    'commission_detail',
    'non_commissionable_fils',
    'non_commissionable_refunded_fils',
    'pilot_promotion_id',
  ],
  pilot_promotions: [
    'id',
    'business_id',
    'starts_at',
    'ends_at',
    'founder_approval',
    'created_by',
    'created_at',
    'cancelled_at',
    'cancelled_by',
    'cancel_reason',
    'notified_7d_at',
    'notified_1d_at',
  ],
  ledger_transactions: [
    'id',
    'kind',
    'source_type',
    'source_id',
    'business_id',
    'memo',
    'occurred_at',
    'created_at',
  ],
  ledger_entries: [
    'id',
    'transaction_id',
    'account',
    'business_id',
    'debit_fils',
    'credit_fils',
    'currency',
    'created_at',
  ],
  refund_requests: [
    'id',
    'payment_id',
    'merchant_order_id',
    'amount_fils',
    'reason',
    'threshold_fils',
    'needs_second_approval',
    'status',
    'requested_by',
    'decided_by',
    'decision_note',
    'decided_at',
    'created_at',
    'updated_at',
  ],
  disputes: [
    'id',
    'earning_id',
    'business_id',
    'amount_fils',
    'status',
    'reason',
    'resolution_note',
    'opened_by',
    'resolved_by',
    'resolved_at',
    'created_at',
    'updated_at',
  ],
  payout_holds: [
    'id',
    'business_id',
    'reason',
    'placed_by',
    'released_by',
    'released_at',
    'created_at',
  ],
  reconciliation_runs: [
    'id',
    'provider',
    'period_start',
    'period_end',
    'status',
    'checked_count',
    'recovered_count',
    'mismatch_count',
    'started_by',
    'started_at',
    'finished_at',
    'failure',
  ],
  reconciliation_items: [
    'id',
    'run_id',
    'kind',
    'object_type',
    'provider_ref',
    'payment_id',
    'refund_id',
    'payout_id',
    'local_amount_fils',
    'provider_amount_fils',
    'local_status',
    'provider_status',
    'resolved_at',
    'resolved_by',
    'resolution_note',
    'created_at',
  ],
  merchant_order_events: [
    'id',
    'merchant_order_id',
    'status',
    'actor_type',
    'actor_id',
    'note',
    'created_at',
  ],
  return_requests: [
    'id',
    'merchant_order_id',
    'order_id',
    'business_id',
    'user_id',
    'status',
    'reason',
    'amount_fils',
    'decision_reason',
    'decided_by',
    'decided_at',
    'received_at',
    'refund_id',
    'created_at',
    'updated_at',
    'faulty',
  ],
  return_items: ['id', 'return_request_id', 'order_item_id', 'qty', 'amount_fils'],
  reviews: [
    'id',
    'user_id',
    'business_id',
    'target_type',
    'order_item_id',
    'product_id',
    'booking_id',
    'service_id',
    'rating',
    'body',
    'status',
    'hidden_reason',
    'created_at',
    'updated_at',
  ],
  review_replies: ['id', 'review_id', 'author_id', 'body', 'created_at'],
  review_reports: [
    'id',
    'review_id',
    'business_id',
    'reported_by',
    'reason',
    'resolved_at',
    'resolved_by',
    'created_at',
  ],
  support_tickets: [
    'id',
    'user_id',
    'type',
    'order_id',
    'booking_id',
    'subject',
    'status',
    'assigned_admin_id',
    'sla_due_at',
    'last_message_at',
    'resolved_at',
    'created_at',
    'updated_at',
    'priority',
    'escalation',
    'escalated_at',
    'first_response_at',
  ],
  ticket_attachments: [
    'id',
    'ticket_id',
    'author_type',
    'author_id',
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
    'created_at',
    'updated_at',
  ],
  ticket_messages: [
    'id',
    'ticket_id',
    'author_type',
    'author_id',
    'body',
    'internal',
    'created_at',
  ],
  notification_templates: [
    'id',
    'event_type',
    'locale',
    'version',
    'title',
    'body',
    'created_by',
    'created_at',
  ],
  notifications: [
    'id',
    'user_id',
    'outbox_id',
    'event_type',
    'title',
    'body',
    'link',
    'read_at',
    'created_at',
  ],
  notification_deliveries: ['id', 'outbox_id', 'user_id', 'channel', 'sent_at'],
  email_usage: ['day', 'essential', 'other', 'updated_at'],
  rate_limit_counters: ['key', 'count', 'reset_at'],
  push_devices: [
    'id',
    'user_id',
    'token',
    'platform',
    'created_at',
    'last_seen_at',
    'revoked_at',
    'revoke_reason',
  ],
  consent_records: [
    'id',
    'user_id',
    'purpose',
    'granted',
    'source',
    'locale',
    'policy_version',
    'request_id',
    'created_at',
  ],
  account_deletion_requests: [
    'id',
    'user_id',
    'status',
    'reason',
    'requested_at',
    'scheduled_for',
    'canceled_at',
    'completed_at',
    'postponed_reason',
    'created_at',
    'updated_at',
  ],
  document_sequences: ['issuer_key', 'prefix', 'year', 'last_number'],
  tax_documents: [
    'id',
    'kind',
    'issuer',
    'business_id',
    'customer_user_id',
    'number',
    'earning_id',
    'source_type',
    'source_id',
    'credits_document_id',
    'tax_document',
    'seller',
    'buyer',
    'lines',
    'net_fils',
    'vat_fils',
    'total_fils',
    'currency',
    'rules_approved',
    'issued_at',
    'created_at',
  ],
  home_service_profiles: [
    'business_id',
    'status',
    'license_number',
    'license_authority',
    'license_expiry',
    'license_document_id',
    'travel_buffer_min',
    'min_order_fils',
    'submitted_at',
    'reviewed_at',
    'reviewed_by',
    'review_reason',
    'version',
    'created_at',
    'updated_at',
  ],
  home_service_areas: [
    'id',
    'business_id',
    'emirate_code',
    'area',
    'travel_fee_fils',
    'created_at',
  ],
  wishlist_items: ['user_id', 'product_id', 'created_at'],
  stock_alerts: ['id', 'user_id', 'variant_id', 'created_at', 'notified_at'],
  service_addons: [
    'id',
    'business_id',
    'service_id',
    'title',
    'price_fils',
    'duration_min',
    'status',
    'sort_order',
    'created_by',
    'created_at',
    'updated_at',
  ],
  portfolio_items: [
    'id',
    'business_id',
    'media_id',
    'service_id',
    'staff_id',
    'caption',
    'sort_order',
    'created_by',
    'created_at',
  ],
  booking_waitlist: [
    'id',
    'user_id',
    'business_id',
    'branch_id',
    'service_id',
    'staff_id',
    'date',
    'window_start',
    'window_end',
    'status',
    'notified_booking_id',
    'notified_at',
    'created_at',
    'updated_at',
  ],
  booking_travel_events: [
    'id',
    'booking_id',
    'business_id',
    'status',
    'actor_user_id',
    'occurred_at',
  ],
  legal_documents: [
    'id',
    'kind',
    'version',
    'title',
    'body',
    'summary_of_changes',
    'status',
    'effective_at',
    'created_by',
    'published_by',
    'published_at',
    'retired_at',
    'created_at',
    'updated_at',
  ],
  legal_acceptances: [
    'id',
    'user_id',
    'document_id',
    'kind',
    'version',
    'business_id',
    'locale',
    'source',
    'request_id',
    'accepted_at',
  ],
  payout_runs: [
    'id',
    'scheduled_for',
    'made_eligible',
    'payouts',
    'skipped',
    'finished_at',
    'created_at',
  ],
};

export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;
export type Address = Selectable<AddressesTable>;
export type Business = Selectable<BusinessesTable>;
export type Membership = Selectable<MembershipsTable>;
export type AdminAccount = Selectable<AdminAccountsTable>;
