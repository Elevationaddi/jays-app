import {
  returnPolicySchema,
  adminLegalDocumentSchema,
  adminLegalListSchema,
  legalDocumentListSchema,
  legalDocumentSchema,
  merchantAgreementSchema,
  myLegalSchema,
  addonListSchema,
  addonSchema,
  type addonInputSchema,
  type createPortfolioItemRequestSchema,
  type joinWaitlistRequestSchema,
  nextAvailableSchema,
  type portfolioImageUploadRequestSchema,
  portfolioItemSchema,
  portfolioListSchema,
  publicServiceListItemSchema,
  rebookSchema,
  type ServiceSort,
  type updateAddonRequestSchema,
  waitlistEntrySchema,
  waitlistListSchema,
  adminEmirateListSchema,
  supportInfoSchema,
  consentRecordSchema,
  dataExportSchema,
  privacySchema,
  unsubscribeResultSchema,
  type updatePrivacyRequestSchema,
  adminDashboardSchema,
  adminOrderSchema,
  adminReviewSchema,
  adminTicketListItemSchema,
  adminTicketSchema,
  businessDashboardSchema,
  merchantReviewSchema,
  myReviewSchema,
  notificationPageSchema,
  notificationTemplateSchema,
  outboxHealthSchema,
  failedOutboxEventSchema,
  returnSchema,
  reviewSummarySchema,
  ticketListItemSchema,
  ticketSchema,
  type customerCancelRequestSchema,
  type fulfillmentActionRequestSchema,
  type notificationTemplateInputSchema,
  type returnActionRequestSchema,
  type returnRequestInputSchema,
  type reviewInputSchema,
  type reviewModerationSchema,
  type ticketInputSchema,
} from '@jays/contracts';
import type {
  putReturnPolicyRequestSchema,
  createProductRequestSchema,
  updateProductRequestSchema,
  variantInputSchema,
  updateVariantRequestSchema,
  productImageUploadRequestSchema,
  stockAdjustRequestSchema,
  putDeliveryZonesRequestSchema,
  productActionRequestSchema,
  mockPaymentOutcomeSchema,
  acceptInviteRequestSchema,
  adminBusinessListQuerySchema,
  businessActionRequestSchema,
  createBrandRequestSchema,
  createCategoryRequestSchema,
  createDocumentUploadRequestSchema,
  createMediaUploadRequestSchema,
  updateBrandRequestSchema,
  updateCategoryRequestSchema,
  updateOnboardingRequestSchema,
  updateStorefrontRequestSchema,
  addressInputSchema,
  confirmMfaRequestSchema,
  createAdminInviteRequestSchema,
  createBusinessRequestSchema,
  inviteMemberRequestSchema,
  registerRequestSchema,
  updateMeRequestSchema,
  acceptLegalRequestSchema,
  createLegalDraftRequestSchema,
  publishLegalRequestSchema,
  updateLegalDraftRequestSchema,
} from '@jays/contracts';
import type {
  blockInputSchema,
  bookingActionRequestSchema,
  travelUpdateRequestSchema,
  branchInputSchema,
  closureInputSchema,
  holdRequestSchema,
  manualBookingRequestSchema,
  putShiftsRequestSchema,
  serviceInputSchema,
  staffInputSchema,
  updateBranchRequestSchema,
  updateServiceRequestSchema,
  updateStaffRequestSchema,
  adminServiceActionRequestSchema,
  merchantBookingListQuerySchema,
  bookingStatusSchema,
} from '@jays/contracts';
import {
  adminBookingSchema,
  adminServiceSchema,
  availabilitySchema,
  blockSchema,
  bookingSchema,
  branchSchema,
  closureSchema,
  merchantBookingSchema,
  payBookingResponseSchema,
  publicVenueSchema,
  serviceSchema,
  staffSchema,
} from '@jays/contracts';
import {
  adminProductDetailSchema,
  adminProductListItemSchema,
  cartSchema,
  createOrderResponseSchema,
  deliveryZoneListSchema,
  inventoryItemSchema,
  merchantOrderListItemSchema,
  merchantOrderSchema,
  merchantProductListItemSchema,
  merchantProductSchema,
  merchantVariantSchema,
  mockConfirmResponseSchema,
  orderListItemSchema,
  orderSchema,
  productFacetsSchema,
  publicProductListItemSchema,
  publicProductSchema,
  stockAlertListSchema,
  wishlistSchema,
  quoteSchema,
  stockMovementSchema,
  adminBusinessDetailSchema,
  adminBusinessListItemSchema,
  brandListSchema,
  brandSchema,
  categoryListSchema,
  categorySchema,
  documentSchema,
  mediaSchema,
  onboardingSchema,
  publicStoreSchema,
  signedUrlSchema,
  storefrontSchema,
  uploadTicketSchema,
  type UploadTicket,
  adminInviteSchema,
  adminListItemSchema,
  adminSchema,
  adminSessionSchema,
  addressSchema,
  auditLogItemSchema,
  businessSchema,
  challengeSchema,
  emirateListSchema,
  errorEnvelopeSchema,
  meSchema,
  memberSchema,
  mfaEnrollmentSchema,
  myMembershipSchema,
  pageSchema,
  sessionSchema,
  tokenPairSchema,
} from '@jays/contracts';
import type {
  disputeInputSchema,
  disputeResolutionSchema,
  feeRuleInputSchema,
  financeSettingInputSchema,
  payoutHoldInputSchema,
  refundDecisionSchema,
  refundRequestInputSchema,
} from '@jays/contracts';
import {
  adminEarningSchema,
  adminPaymentSchema,
  disputeSchema,
  earningSchema,
  feeRuleSchema,
  businessTaxSchema,
  taxDocumentSchema,
  taxDocumentSummarySchema,
  vatReportSchema,
  type businessTaxInputSchema,
  financeOverviewSchema,
  financeSettingSchema,
  financeSummarySchema,
  ledgerLineSchema,
  payoutHoldSchema,
  payoutRunResultSchema,
  payoutSchema,
  reconciliationRunSchema,
  refundRequestSchema,
} from '@jays/contracts';
import {
  adminHomeServiceSchema,
  homeServiceProfileSchema,
  type homeServiceDecisionRequestSchema,
  type homeServiceProfileInputSchema,
} from '@jays/contracts';
import type { ProductSort } from '@jays/contracts';
import { z } from 'zod';

/** A failed API call, carrying the error envelope from docs/07-api.md. */
export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fieldErrors: Record<string, string[]> = {},
    readonly requestId: string | null = null,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }

  /** True when the device could not reach the API at all (offline, DNS, refused). */
  get isNetworkError(): boolean {
    return this.status === 0;
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  /** Access token for authenticated calls (user or admin, depending on the endpoints used). */
  accessToken?: () => string | null | undefined;
  /** Extra headers, e.g. Accept-Language or a forwarded client IP from a trusted server. */
  headers?: () => Record<string, string>;
}

export const loginResultSchema = z.discriminatedUnion('status', [
  sessionSchema.extend({ status: z.literal('authenticated') }),
  z.object({ status: z.literal('verification_required'), challenge: challengeSchema }),
]);
export type LoginResult = z.infer<typeof loginResultSchema>;

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Builds `?a=1&b=2` from defined values only. */
function query(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

type Page = { cursor?: string; limit?: number };

export function createApiClient(options: ApiClientOptions) {
  const doFetch = options.fetch ?? fetch;
  const base = options.baseUrl.replace(/\/$/, '');

  async function call<S extends z.ZodType>(
    method: Method,
    path: string,
    schema: S,
    body?: unknown,
    extraHeaders: Record<string, string | null | undefined> = {},
  ): Promise<z.infer<S>> {
    const headers: Record<string, string> = { accept: 'application/json', ...options.headers?.() };
    for (const [name, value] of Object.entries(extraHeaders)) if (value) headers[name] = value;
    const token = options.accessToken?.();
    if (token) headers['authorization'] = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? null : JSON.stringify(body),
        cache: 'no-store',
      });
    } catch {
      throw new ApiClientError(0, 'NETWORK_ERROR', 'Could not reach the server.');
    }
    if (response.status === 204) return schema.parse(null);
    const json: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const parsed = errorEnvelopeSchema.safeParse(json);
      const retryAfter = response.headers.get('retry-after');
      if (parsed.success) {
        const { code, message, fieldErrors, requestId } = parsed.data.error;
        throw new ApiClientError(
          response.status,
          code,
          message,
          fieldErrors,
          requestId,
          retryAfter ? Number(retryAfter) : null,
        );
      }
      throw new ApiClientError(
        response.status,
        'UNEXPECTED_RESPONSE',
        'Unexpected response from the server.',
      );
    }
    return schema.parse(json);
  }

  /** A CSV download: the body as text and the file name the server suggests. */
  async function download(path: string): Promise<{ filename: string; text: string }> {
    const headers: Record<string, string> = { accept: 'text/csv', ...options.headers?.() };
    const token = options.accessToken?.();
    if (token) headers['authorization'] = `Bearer ${token}`;
    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, { method: 'GET', headers, cache: 'no-store' });
    } catch {
      throw new ApiClientError(0, 'NETWORK_ERROR', 'Could not reach the server.');
    }
    if (!response.ok) {
      const parsed = errorEnvelopeSchema.safeParse(await response.json().catch(() => null));
      if (parsed.success) {
        const { code, message, fieldErrors, requestId } = parsed.data.error;
        throw new ApiClientError(response.status, code, message, fieldErrors, requestId);
      }
      throw new ApiClientError(response.status, 'UNEXPECTED_RESPONSE', 'Unexpected response.');
    }
    const disposition = response.headers.get('content-disposition') ?? '';
    const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'export.csv';
    return { filename, text: await response.text() };
  }

  const q = (params: { cursor?: string | undefined; limit?: number | undefined } = {}) => {
    const search = new URLSearchParams();
    if (params.cursor) search.set('cursor', params.cursor);
    if (params.limit) search.set('limit', String(params.limit));
    const text = search.toString();
    return text ? `?${text}` : '';
  };
  const none = z.null();

  const biz = (id: string) => `/businesses/${encodeURIComponent(id)}`;

  /**
   * Sends file bytes to a signed upload URL. The URL carries its own short-lived authorisation, so
   * no access token is sent with it.
   */
  async function upload(ticket: UploadTicket, bytes: Blob | Uint8Array): Promise<void> {
    let response: Response;
    try {
      response = await doFetch(ticket.uploadUrl, {
        method: ticket.method,
        headers: ticket.headers,
        body: bytes as BodyInit,
        cache: 'no-store',
      });
    } catch {
      throw new ApiClientError(0, 'NETWORK_ERROR', 'Could not reach the server.');
    }
    if (!response.ok) {
      const parsed = errorEnvelopeSchema.safeParse(await response.json().catch(() => null));
      throw parsed.success
        ? new ApiClientError(response.status, parsed.data.error.code, parsed.data.error.message)
        : new ApiClientError(response.status, 'UPLOAD_FAILED', 'The upload failed.');
    }
  }

  const cartHeaders = (cartToken?: string | null) => ({ 'x-cart-token': cartToken });
  const idem = (key: string) => ({ 'idempotency-key': key });

  return {
    // Public reference data
    emirates: () => call('GET', '/emirates', emirateListSchema),
    categories: (mode?: 'shop' | 'services') =>
      call('GET', `/categories${query({ mode })}`, categoryListSchema),
    brands: () => call('GET', '/brands', brandListSchema),
    stores: (
      params: {
        mode?: 'shop' | 'services';
        emirate?: string;
        cursor?: string;
        limit?: number;
      } = {},
    ) => call('GET', `/stores${query(params)}`, pageSchema(publicStoreSchema)),
    store: (id: string) => call('GET', `/stores/${encodeURIComponent(id)}`, publicStoreSchema),
    upload,

    // Identity
    register: (body: z.input<typeof registerRequestSchema>) =>
      call('POST', '/auth/register', challengeSchema, body),
    verify: (challengeId: string, code: string) =>
      call('POST', '/auth/verify', sessionSchema, { challengeId, code }),
    resend: (challengeId: string) =>
      call('POST', '/auth/verify/resend', challengeSchema, { challengeId }),
    login: (identifier: string, password: string) =>
      call('POST', '/auth/login', loginResultSchema, { identifier, password }),
    refresh: (refreshToken: string) =>
      call('POST', '/auth/refresh', tokenPairSchema, { refreshToken }),
    logout: (refreshToken: string) => call('POST', '/auth/logout', none, { refreshToken }),
    requestPasswordReset: (identifier: string) =>
      call('POST', '/auth/password/reset-request', challengeSchema, { identifier }),
    resetPassword: (challengeId: string, code: string, newPassword: string) =>
      call('POST', '/auth/password/reset', sessionSchema, { challengeId, code, newPassword }),

    // Me
    me: () => call('GET', '/me', meSchema),
    updateMe: (body: z.input<typeof updateMeRequestSchema>) => call('PATCH', '/me', meSchema, body),
    addresses: (params?: { cursor?: string; limit?: number }) =>
      call('GET', `/me/addresses${q(params)}`, pageSchema(addressSchema)),
    createAddress: (body: z.input<typeof addressInputSchema>) =>
      call('POST', '/me/addresses', addressSchema, body),
    memberships: (params?: { cursor?: string; limit?: number }) =>
      call('GET', `/me/memberships${q(params)}`, pageSchema(myMembershipSchema)),
    acceptMembership: (id: string) =>
      call('POST', `/me/memberships/${encodeURIComponent(id)}/accept`, myMembershipSchema),
    declineMembership: (id: string) =>
      call('POST', `/me/memberships/${encodeURIComponent(id)}/decline`, none),

    // Account and privacy (ADR-0019)
    privacy: () => call('GET', '/me/privacy', privacySchema),
    updatePrivacy: (body: z.input<typeof updatePrivacyRequestSchema>) =>
      call('PATCH', '/me/privacy', privacySchema, body),
    consentHistory: (params?: { cursor?: string; limit?: number }) =>
      call('GET', `/me/consents${q(params)}`, pageSchema(consentRecordSchema)),
    exportMyData: () => call('GET', '/me/export', dataExportSchema),
    myDocuments: (
      params: { orderId?: string; bookingId?: string; cursor?: string; limit?: number } = {},
    ) => call('GET', `/me/documents${query(params)}`, pageSchema(taxDocumentSummarySchema)),
    myDocument: (id: string) =>
      call('GET', `/me/documents/${encodeURIComponent(id)}`, taxDocumentSchema),
    requestAccountDeletion: (password: string, reason?: string) =>
      call('POST', '/me/deletion', privacySchema, { password, ...(reason ? { reason } : {}) }),
    cancelAccountDeletion: () => call('DELETE', '/me/deletion', privacySchema),
    checkUnsubscribe: (token: string) =>
      call('GET', `/unsubscribe?token=${encodeURIComponent(token)}`, unsubscribeResultSchema),
    unsubscribe: (token: string) =>
      call('POST', `/unsubscribe?token=${encodeURIComponent(token)}`, unsubscribeResultSchema),

    // Businesses
    createBusiness: (body: z.input<typeof createBusinessRequestSchema>) =>
      call('POST', '/businesses', businessSchema, body),
    business: (id: string) => call('GET', `/businesses/${encodeURIComponent(id)}`, businessSchema),
    activateMode: (id: string, mode: 'shop' | 'services') =>
      call('POST', `/businesses/${encodeURIComponent(id)}/modes/${mode}/activate`, businessSchema),
    members: (id: string, params?: { cursor?: string; limit?: number }) =>
      call(
        'GET',
        `/businesses/${encodeURIComponent(id)}/members${q(params)}`,
        pageSchema(memberSchema),
      ),
    inviteMember: (id: string, body: z.input<typeof inviteMemberRequestSchema>) =>
      call('POST', `/businesses/${encodeURIComponent(id)}/members`, memberSchema, body),
    updateMember: (id: string, memberId: string, permissions: string[]) =>
      call(
        'PATCH',
        `/businesses/${encodeURIComponent(id)}/members/${encodeURIComponent(memberId)}`,
        memberSchema,
        { permissions },
      ),
    removeMember: (id: string, memberId: string) =>
      call(
        'DELETE',
        `/businesses/${encodeURIComponent(id)}/members/${encodeURIComponent(memberId)}`,
        none,
      ),

    // Onboarding (owner), storefront and media (owner, manager)
    onboarding: (id: string) => call('GET', `${biz(id)}/onboarding`, onboardingSchema),
    updateOnboarding: (id: string, body: z.input<typeof updateOnboardingRequestSchema>) =>
      call('PATCH', `${biz(id)}/onboarding`, onboardingSchema, body),
    acceptAgreement: (id: string, version: string) =>
      call('POST', `${biz(id)}/agreement`, onboardingSchema, { version }),
    submitBusiness: (id: string) => call('POST', `${biz(id)}/submit`, onboardingSchema),
    createDocumentUpload: (id: string, body: z.input<typeof createDocumentUploadRequestSchema>) =>
      call('POST', `${biz(id)}/documents`, uploadTicketSchema, body),
    completeDocument: (id: string, documentId: string) =>
      call(
        'POST',
        `${biz(id)}/documents/${encodeURIComponent(documentId)}/complete`,
        documentSchema,
      ),
    documentDownload: (id: string, documentId: string) =>
      call(
        'GET',
        `${biz(id)}/documents/${encodeURIComponent(documentId)}/download`,
        signedUrlSchema,
      ),
    removeDocument: (id: string, documentId: string) =>
      call('DELETE', `${biz(id)}/documents/${encodeURIComponent(documentId)}`, none),
    storefront: (id: string) => call('GET', `${biz(id)}/storefront`, storefrontSchema),
    updateStorefront: (id: string, body: z.input<typeof updateStorefrontRequestSchema>) =>
      call('PATCH', `${biz(id)}/storefront`, storefrontSchema, body),
    createMediaUpload: (id: string, body: z.input<typeof createMediaUploadRequestSchema>) =>
      call('POST', `${biz(id)}/media`, uploadTicketSchema, body),
    completeMedia: (id: string, mediaId: string) =>
      call('POST', `${biz(id)}/media/${encodeURIComponent(mediaId)}/complete`, mediaSchema),

    // Public catalog
    products: (
      params: {
        q?: string;
        category?: string;
        brand?: string;
        store?: string;
        minPriceFils?: number;
        maxPriceFils?: number;
        availability?: 'in_stock' | 'all';
        onSale?: boolean;
        minRating?: number;
        sort?: ProductSort;
        cursor?: string;
        limit?: number;
      } = {},
    ) => call('GET', `/products${query(params)}`, pageSchema(publicProductListItemSchema)),
    productFacets: (
      params: {
        q?: string;
        category?: string;
        brand?: string;
        store?: string;
        minPriceFils?: number;
        maxPriceFils?: number;
        availability?: 'in_stock' | 'all';
        onSale?: boolean;
        minRating?: number;
      } = {},
    ) => call('GET', `/products/facets${query(params)}`, productFacetsSchema),
    product: (id: string) =>
      call('GET', `/products/${encodeURIComponent(id)}`, publicProductSchema),
    relatedProducts: (id: string) =>
      call(
        'GET',
        `/products/${encodeURIComponent(id)}/related`,
        z.object({ items: z.array(publicProductListItemSchema) }),
      ),

    // Wishlist and back-in-stock alerts (customer)
    wishlist: () => call('GET', '/me/wishlist', wishlistSchema),
    addToWishlist: (productId: string) =>
      call('PUT', `/me/wishlist/${encodeURIComponent(productId)}`, wishlistSchema),
    removeFromWishlist: (productId: string) =>
      call('DELETE', `/me/wishlist/${encodeURIComponent(productId)}`, wishlistSchema),
    stockAlerts: () => call('GET', '/me/stock-alerts', stockAlertListSchema),
    addStockAlert: (variantId: string) =>
      call('POST', `/me/stock-alerts/${encodeURIComponent(variantId)}`, stockAlertListSchema),
    removeStockAlert: (variantId: string) =>
      call('DELETE', `/me/stock-alerts/${encodeURIComponent(variantId)}`, stockAlertListSchema),

    // Cart, checkout and orders (customer). Guests pass the cart token the cart response returned.
    cart: (cartToken?: string | null) =>
      call('GET', '/cart', cartSchema, undefined, cartHeaders(cartToken)),
    putCartItem: (variantId: string, qty: number, cartToken?: string | null) =>
      call(
        'PUT',
        `/cart/items/${encodeURIComponent(variantId)}`,
        cartSchema,
        { qty },
        cartHeaders(cartToken),
      ),
    removeCartItem: (variantId: string, cartToken?: string | null) =>
      call(
        'DELETE',
        `/cart/items/${encodeURIComponent(variantId)}`,
        cartSchema,
        undefined,
        cartHeaders(cartToken),
      ),
    mergeCart: (cartToken: string) => call('POST', '/cart/merge', cartSchema, { cartToken }),
    quote: (addressId: string, deliveryMethods?: Record<string, 'standard' | 'express'>) =>
      call('POST', '/checkout/quote', quoteSchema, {
        addressId,
        ...(deliveryMethods ? { deliveryMethods } : {}),
      }),
    /** Send the same idempotency key when retrying, so a lost response never creates two orders. */
    createOrder: (quoteId: string, idempotencyKey: string) =>
      call('POST', '/orders', createOrderResponseSchema, { quoteId }, idem(idempotencyKey)),
    orders: (params?: { cursor?: string; limit?: number }) =>
      call('GET', `/orders${q(params)}`, pageSchema(orderListItemSchema)),
    order: (id: string) => call('GET', `/orders/${encodeURIComponent(id)}`, orderSchema),
    // Bookings (phase 4)
    venue: (businessId: string) =>
      call('GET', `/venues/${encodeURIComponent(businessId)}`, publicVenueSchema),
    availability: (params: {
      branchId: string;
      serviceId: string;
      date: string;
      staffId?: string;
      location?: 'venue' | 'home';
      /** Comma-separated add-on ids. */
      addonIds?: string;
    }) => call('GET', `/availability${query(params)}`, availabilitySchema),
    // Service discovery (phase 8.7)
    searchServices: (
      params: {
        q?: string;
        category?: string;
        emirate?: string;
        location?: 'venue' | 'home';
        minPriceFils?: number;
        maxPriceFils?: number;
        minRating?: number;
        sort?: ServiceSort;
        cursor?: string;
        limit?: number;
      } = {},
    ) => call('GET', `/services${query(params)}`, pageSchema(publicServiceListItemSchema)),
    nextAvailable: (
      serviceId: string,
      params: { branchId?: string; staffId?: string; location?: 'venue' | 'home' } = {},
    ) =>
      call(
        'GET',
        `/services/${encodeURIComponent(serviceId)}/next-available${query(params)}`,
        nextAvailableSchema,
      ),
    waitlist: () => call('GET', '/me/waitlist', waitlistListSchema),
    joinWaitlist: (body: z.input<typeof joinWaitlistRequestSchema>) =>
      call('POST', '/me/waitlist', waitlistEntrySchema, body),
    leaveWaitlist: (entryId: string) =>
      call('DELETE', `/me/waitlist/${encodeURIComponent(entryId)}`, waitlistListSchema),
    rebook: (bookingId: string) =>
      call('GET', `/bookings/${encodeURIComponent(bookingId)}/rebook`, rebookSchema),
    legalDocuments: () => call('GET', '/legal', legalDocumentListSchema),
    legalDocument: (kind: string) =>
      call('GET', `/legal/${encodeURIComponent(kind)}`, legalDocumentSchema),
    myLegal: () => call('GET', '/me/legal', myLegalSchema),
    acceptLegal: (body: z.input<typeof acceptLegalRequestSchema>) =>
      call('POST', '/me/legal/accept', myLegalSchema, body),
    /** Send the same idempotency key when retrying, so a lost response never holds twice. */
    holdBooking: (body: z.input<typeof holdRequestSchema>, idempotencyKey: string) =>
      call('POST', '/bookings/hold', bookingSchema, body, idem(idempotencyKey)),
    payBooking: (id: string) =>
      call('POST', `/bookings/${encodeURIComponent(id)}/pay`, payBookingResponseSchema),
    bookings: (params: { scope?: 'upcoming' | 'past'; cursor?: string; limit?: number } = {}) =>
      call('GET', `/bookings${query(params)}`, pageSchema(bookingSchema)),
    booking: (id: string) => call('GET', `/bookings/${encodeURIComponent(id)}`, bookingSchema),
    cancelBooking: (id: string, reason?: string) =>
      call('POST', `/bookings/${encodeURIComponent(id)}/cancel`, bookingSchema, {
        reason: reason ?? null,
      }),
    rescheduleBooking: (id: string, startAt: string, staffId?: string | null) =>
      call('POST', `/bookings/${encodeURIComponent(id)}/reschedule`, bookingSchema, {
        startAt,
        staffId: staffId ?? null,
      }),
    /** The mock provider's hosted payment step (local development only). */
    mockConfirmPayment: (
      intentId: string,
      clientSecret: string,
      outcome: z.input<typeof mockPaymentOutcomeSchema> = 'success',
    ) =>
      call(
        'POST',
        `/mock-psp/intents/${encodeURIComponent(intentId)}/confirm`,
        mockConfirmResponseSchema,
        {
          clientSecret,
          outcome,
        },
      ),

    // Merchant catalog, inventory, delivery and orders
    merchantProducts: (
      id: string,
      params: { status?: string; q?: string; cursor?: string; limit?: number } = {},
    ) =>
      call('GET', `${biz(id)}/products${query(params)}`, pageSchema(merchantProductListItemSchema)),
    merchantProduct: (id: string, productId: string) =>
      call('GET', `${biz(id)}/products/${encodeURIComponent(productId)}`, merchantProductSchema),
    createProduct: (id: string, body: z.input<typeof createProductRequestSchema>) =>
      call('POST', `${biz(id)}/products`, merchantProductSchema, body),
    updateProduct: (
      id: string,
      productId: string,
      body: z.input<typeof updateProductRequestSchema>,
    ) =>
      call(
        'PATCH',
        `${biz(id)}/products/${encodeURIComponent(productId)}`,
        merchantProductSchema,
        body,
      ),
    submitProduct: (id: string, productId: string) =>
      call(
        'POST',
        `${biz(id)}/products/${encodeURIComponent(productId)}/submit`,
        merchantProductSchema,
      ),
    archiveProduct: (id: string, productId: string) =>
      call(
        'POST',
        `${biz(id)}/products/${encodeURIComponent(productId)}/archive`,
        merchantProductSchema,
      ),
    addVariant: (id: string, productId: string, body: z.input<typeof variantInputSchema>) =>
      call(
        'POST',
        `${biz(id)}/products/${encodeURIComponent(productId)}/variants`,
        merchantVariantSchema,
        body,
      ),
    updateVariant: (
      id: string,
      variantId: string,
      body: z.input<typeof updateVariantRequestSchema>,
    ) =>
      call(
        'PATCH',
        `${biz(id)}/variants/${encodeURIComponent(variantId)}`,
        merchantVariantSchema,
        body,
      ),
    createProductImageUpload: (id: string, body: z.input<typeof productImageUploadRequestSchema>) =>
      call('POST', `${biz(id)}/product-images`, uploadTicketSchema, body),
    completeProductImage: (id: string, mediaId: string) =>
      call(
        'POST',
        `${biz(id)}/product-images/${encodeURIComponent(mediaId)}/complete`,
        mediaSchema,
      ),
    inventory: (
      id: string,
      params: { lowStock?: 'true' | 'false'; q?: string; cursor?: string; limit?: number } = {},
    ) => call('GET', `${biz(id)}/inventory${query(params)}`, pageSchema(inventoryItemSchema)),
    adjustStock: (
      id: string,
      body: z.input<typeof stockAdjustRequestSchema>,
      idempotencyKey: string,
    ) =>
      call('POST', `${biz(id)}/inventory/adjust`, inventoryItemSchema, body, idem(idempotencyKey)),
    stockMovements: (id: string, variantId: string, params?: { cursor?: string; limit?: number }) =>
      call(
        'GET',
        `${biz(id)}/inventory/${encodeURIComponent(variantId)}/movements${q(params)}`,
        pageSchema(stockMovementSchema),
      ),
    deliveryZones: (id: string) => call('GET', `${biz(id)}/delivery-zones`, deliveryZoneListSchema),
    returnPolicy: (id: string) => call('GET', `${biz(id)}/return-policy`, returnPolicySchema),
    putReturnPolicy: (id: string, body: z.input<typeof putReturnPolicyRequestSchema>) =>
      call('PUT', `${biz(id)}/return-policy`, returnPolicySchema, body),
    putDeliveryZones: (id: string, body: z.input<typeof putDeliveryZonesRequestSchema>) =>
      call('PUT', `${biz(id)}/delivery-zones`, deliveryZoneListSchema, body),
    merchantOrders: (
      id: string,
      params: { status?: string; cursor?: string; limit?: number } = {},
    ) => call('GET', `${biz(id)}/orders${query(params)}`, pageSchema(merchantOrderListItemSchema)),
    merchantOrder: (id: string, merchantOrderId: string) =>
      call('GET', `${biz(id)}/orders/${encodeURIComponent(merchantOrderId)}`, merchantOrderSchema),

    // Business: branches, services, staff, blocks, calendar (phase 4)
    branches: (id: string) => call('GET', `${biz(id)}/branches`, z.array(branchSchema)),
    branch: (id: string, branchId: string) =>
      call('GET', `${biz(id)}/branches/${encodeURIComponent(branchId)}`, branchSchema),
    createBranch: (id: string, body: z.input<typeof branchInputSchema>) =>
      call('POST', `${biz(id)}/branches`, branchSchema, body),
    updateBranch: (id: string, branchId: string, body: z.input<typeof updateBranchRequestSchema>) =>
      call('PATCH', `${biz(id)}/branches/${encodeURIComponent(branchId)}`, branchSchema, body),
    closures: (id: string, branchId: string) =>
      call(
        'GET',
        `${biz(id)}/branches/${encodeURIComponent(branchId)}/closures`,
        z.array(closureSchema),
      ),
    addClosure: (id: string, branchId: string, body: z.input<typeof closureInputSchema>) =>
      call(
        'POST',
        `${biz(id)}/branches/${encodeURIComponent(branchId)}/closures`,
        closureSchema,
        body,
      ),
    removeClosure: (id: string, branchId: string, closureId: string) =>
      call(
        'DELETE',
        `${biz(id)}/branches/${encodeURIComponent(branchId)}/closures/${encodeURIComponent(closureId)}`,
        none,
      ),
    services: (id: string) => call('GET', `${biz(id)}/services`, z.array(serviceSchema)),
    service: (id: string, serviceId: string) =>
      call('GET', `${biz(id)}/services/${encodeURIComponent(serviceId)}`, serviceSchema),
    createService: (id: string, body: z.input<typeof serviceInputSchema>) =>
      call('POST', `${biz(id)}/services`, serviceSchema, body),
    updateService: (
      id: string,
      serviceId: string,
      body: z.input<typeof updateServiceRequestSchema>,
    ) => call('PATCH', `${biz(id)}/services/${encodeURIComponent(serviceId)}`, serviceSchema, body),
    addons: (id: string, serviceId: string) =>
      call('GET', `${biz(id)}/services/${encodeURIComponent(serviceId)}/addons`, addonListSchema),
    createAddon: (id: string, serviceId: string, body: z.input<typeof addonInputSchema>) =>
      call(
        'POST',
        `${biz(id)}/services/${encodeURIComponent(serviceId)}/addons`,
        addonSchema,
        body,
      ),
    updateAddon: (id: string, addonId: string, body: z.input<typeof updateAddonRequestSchema>) =>
      call('PATCH', `${biz(id)}/addons/${encodeURIComponent(addonId)}`, addonSchema, body),
    portfolio: (id: string) => call('GET', `${biz(id)}/portfolio`, portfolioListSchema),
    createPortfolioImageUpload: (
      id: string,
      body: z.input<typeof portfolioImageUploadRequestSchema>,
    ) => call('POST', `${biz(id)}/portfolio-images`, uploadTicketSchema, body),
    completePortfolioImage: (id: string, mediaId: string) =>
      call(
        'POST',
        `${biz(id)}/portfolio-images/${encodeURIComponent(mediaId)}/complete`,
        mediaSchema,
      ),
    addPortfolioItem: (id: string, body: z.input<typeof createPortfolioItemRequestSchema>) =>
      call('POST', `${biz(id)}/portfolio`, portfolioItemSchema, body),
    removePortfolioItem: (id: string, itemId: string) =>
      call('DELETE', `${biz(id)}/portfolio/${encodeURIComponent(itemId)}`, portfolioListSchema),
    staff: (id: string) => call('GET', `${biz(id)}/staff`, z.array(staffSchema)),
    staffMember: (id: string, staffId: string) =>
      call('GET', `${biz(id)}/staff/${encodeURIComponent(staffId)}`, staffSchema),
    createStaff: (id: string, body: z.input<typeof staffInputSchema>) =>
      call('POST', `${biz(id)}/staff`, staffSchema, body),
    updateStaff: (id: string, staffId: string, body: z.input<typeof updateStaffRequestSchema>) =>
      call('PATCH', `${biz(id)}/staff/${encodeURIComponent(staffId)}`, staffSchema, body),
    putShifts: (id: string, staffId: string, body: z.input<typeof putShiftsRequestSchema>) =>
      call('PUT', `${biz(id)}/staff/${encodeURIComponent(staffId)}/shifts`, staffSchema, body),
    blocks: (
      id: string,
      params: { staffId?: string; from?: string; cursor?: string; limit?: number } = {},
    ) => call('GET', `${biz(id)}/blocks${query(params)}`, pageSchema(blockSchema)),
    addBlock: (id: string, body: z.input<typeof blockInputSchema>) =>
      call('POST', `${biz(id)}/blocks`, blockSchema, body),
    removeBlock: (id: string, blockId: string) =>
      call('DELETE', `${biz(id)}/blocks/${encodeURIComponent(blockId)}`, none),
    calendar: (
      id: string,
      params: Omit<z.input<typeof merchantBookingListQuerySchema>, 'limit'> & { limit?: number },
    ) => call('GET', `${biz(id)}/bookings${query(params)}`, pageSchema(merchantBookingSchema)),
    merchantAgreement: (id: string) =>
      call('GET', `${biz(id)}/legal/merchant-agreement`, merchantAgreementSchema),
    acceptMerchantAgreement: (id: string, version: number) =>
      call('POST', `${biz(id)}/legal/merchant-agreement/accept`, merchantAgreementSchema, {
        version,
      }),
    merchantBooking: (id: string, bookingId: string) =>
      call('GET', `${biz(id)}/bookings/${encodeURIComponent(bookingId)}`, merchantBookingSchema),
    createManualBooking: (id: string, body: z.input<typeof manualBookingRequestSchema>) =>
      call('POST', `${biz(id)}/bookings`, merchantBookingSchema, body),
    bookingAction: (
      id: string,
      bookingId: string,
      body: z.input<typeof bookingActionRequestSchema>,
    ) =>
      call(
        'POST',
        `${biz(id)}/bookings/${encodeURIComponent(bookingId)}/actions`,
        merchantBookingSchema,
        body,
      ),
    updateTravel: (
      id: string,
      bookingId: string,
      body: z.input<typeof travelUpdateRequestSchema>,
    ) =>
      call(
        'POST',
        `${biz(id)}/bookings/${encodeURIComponent(bookingId)}/travel`,
        merchantBookingSchema,
        body,
      ),

    // Admin
    adminLogin: (email: string, password: string, totpCode: string) =>
      call('POST', '/admin/auth/login', adminSessionSchema, { email, password, totpCode }),
    adminRefresh: (refreshToken: string) =>
      call('POST', '/admin/auth/refresh', tokenPairSchema, { refreshToken }),
    adminLogout: (refreshToken: string) =>
      call('POST', '/admin/auth/logout', none, { refreshToken }),
    adminMe: () => call('GET', '/admin/me', adminSchema),
    acceptAdminInvite: (body: z.input<typeof acceptInviteRequestSchema>) =>
      call('POST', '/admin/invites/accept', mfaEnrollmentSchema, body),
    confirmAdminMfa: (body: z.input<typeof confirmMfaRequestSchema>) =>
      call('POST', '/admin/invites/confirm-mfa', adminSessionSchema, body),
    admins: (params?: { cursor?: string; limit?: number }) =>
      call('GET', `/admin/admins${q(params)}`, pageSchema(adminListItemSchema)),
    inviteAdmin: (body: z.input<typeof createAdminInviteRequestSchema>) =>
      call('POST', '/admin/admins/invites', adminInviteSchema, body),
    auditLogs: (params?: { cursor?: string; limit?: number }) =>
      call('GET', `/admin/audit-logs${q(params)}`, pageSchema(auditLogItemSchema)),
    adminBusinesses: (
      params: {
        status?: z.output<typeof adminBusinessListQuerySchema>['status'];
        cursor?: string;
        limit?: number;
      } = {},
    ) => call('GET', `/admin/businesses${query(params)}`, pageSchema(adminBusinessListItemSchema)),
    adminBusiness: (id: string) =>
      call('GET', `/admin/businesses/${encodeURIComponent(id)}`, adminBusinessDetailSchema),
    adminBusinessAction: (id: string, body: z.input<typeof businessActionRequestSchema>) =>
      call(
        'POST',
        `/admin/businesses/${encodeURIComponent(id)}/actions`,
        adminBusinessDetailSchema,
        body,
      ),
    adminDocumentDownload: (id: string, documentId: string) =>
      call(
        'GET',
        `/admin/businesses/${encodeURIComponent(id)}/documents/${encodeURIComponent(documentId)}/download`,
        signedUrlSchema,
      ),
    adminCategories: (mode?: 'shop' | 'services') =>
      call('GET', `/admin/categories${query({ mode })}`, categoryListSchema),
    createCategory: (body: z.input<typeof createCategoryRequestSchema>) =>
      call('POST', '/admin/categories', categorySchema, body),
    updateCategory: (id: string, body: z.input<typeof updateCategoryRequestSchema>) =>
      call('PATCH', `/admin/categories/${encodeURIComponent(id)}`, categorySchema, body),
    adminProducts: (params: { status?: string; cursor?: string; limit?: number } = {}) =>
      call('GET', `/admin/products${query(params)}`, pageSchema(adminProductListItemSchema)),
    adminProduct: (id: string) =>
      call('GET', `/admin/products/${encodeURIComponent(id)}`, adminProductDetailSchema),
    adminProductAction: (id: string, body: z.input<typeof productActionRequestSchema>) =>
      call(
        'POST',
        `/admin/products/${encodeURIComponent(id)}/actions`,
        adminProductDetailSchema,
        body,
      ),
    adminBookings: (
      params: {
        status?: z.output<typeof bookingStatusSchema>;
        businessId?: string;
        cursor?: string;
        limit?: number;
      } = {},
    ) => call('GET', `/admin/bookings${query(params)}`, pageSchema(adminBookingSchema)),
    adminServices: (params: { status?: string; cursor?: string; limit?: number } = {}) =>
      call('GET', `/admin/services${query(params)}`, pageSchema(adminServiceSchema)),
    adminServiceAction: (id: string, body: z.input<typeof adminServiceActionRequestSchema>) =>
      call('POST', `/admin/services/${encodeURIComponent(id)}/actions`, adminServiceSchema, body),
    adminBrands: () => call('GET', '/admin/brands', brandListSchema),
    createBrand: (body: z.input<typeof createBrandRequestSchema>) =>
      call('POST', '/admin/brands', brandSchema, body),
    updateBrand: (id: string, body: z.input<typeof updateBrandRequestSchema>) =>
      call('PATCH', `/admin/brands/${encodeURIComponent(id)}`, brandSchema, body),
    // Business finance (finance.view)
    financeSummary: (id: string) => call('GET', `${biz(id)}/finance/summary`, financeSummarySchema),
    businessDocuments: (id: string, params: Page & { kind?: string } = {}) =>
      call(
        'GET',
        `${biz(id)}/finance/documents${query(params)}`,
        pageSchema(taxDocumentSummarySchema),
      ),
    businessDocument: (id: string, documentId: string) =>
      call(
        'GET',
        `${biz(id)}/finance/documents/${encodeURIComponent(documentId)}`,
        taxDocumentSchema,
      ),
    financeEarnings: (id: string, params: Page & { status?: string } = {}) =>
      call('GET', `${biz(id)}/finance/earnings${query(params)}`, pageSchema(earningSchema)),
    financeLedger: (id: string, params: Page = {}) =>
      call('GET', `${biz(id)}/finance/ledger${query(params)}`, pageSchema(ledgerLineSchema)),
    financePayouts: (id: string, params: Page & { status?: string } = {}) =>
      call('GET', `${biz(id)}/finance/payouts${query(params)}`, pageSchema(payoutSchema)),

    // Admin finance
    adminFinanceOverview: () => call('GET', '/admin/finance/overview', financeOverviewSchema),
    adminCreateFeeRule: (body: z.input<typeof feeRuleInputSchema>) =>
      call('POST', '/admin/finance/fee-rules', z.array(feeRuleSchema), body),
    adminCreateFinanceSetting: (body: z.input<typeof financeSettingInputSchema>) =>
      call('POST', '/admin/finance/settings', z.array(financeSettingSchema), body),
    adminTaxDocuments: (params: Page & { businessId?: string; kind?: string } = {}) =>
      call('GET', `/admin/finance/documents${query(params)}`, pageSchema(taxDocumentSummarySchema)),
    adminTaxDocument: (id: string) =>
      call('GET', `/admin/finance/documents/${encodeURIComponent(id)}`, taxDocumentSchema),
    adminVatReport: (from: string, to: string) =>
      call('GET', `/admin/finance/vat-report${query({ from, to })}`, vatReportSchema),
    // Home services (phase 8.5)
    homeServices: (businessId: string) =>
      call(
        'GET',
        `/businesses/${encodeURIComponent(businessId)}/home-services`,
        homeServiceProfileSchema,
      ),
    saveHomeServices: (businessId: string, body: z.input<typeof homeServiceProfileInputSchema>) =>
      call(
        'PUT',
        `/businesses/${encodeURIComponent(businessId)}/home-services`,
        homeServiceProfileSchema,
        body,
      ),
    submitHomeServices: (businessId: string) =>
      call(
        'POST',
        `/businesses/${encodeURIComponent(businessId)}/home-services/submit`,
        homeServiceProfileSchema,
      ),
    adminHomeServices: (params: Page & { status?: string } = {}) =>
      call('GET', `/admin/home-services${query(params)}`, pageSchema(adminHomeServiceSchema)),
    adminHomeService: (businessId: string) =>
      call('GET', `/admin/home-services/${encodeURIComponent(businessId)}`, adminHomeServiceSchema),
    adminDecideHomeServices: (
      businessId: string,
      body: z.input<typeof homeServiceDecisionRequestSchema>,
    ) =>
      call(
        'POST',
        `/admin/home-services/${encodeURIComponent(businessId)}/decision`,
        adminHomeServiceSchema,
        body,
      ),
    adminBusinessTax: (businessId: string) =>
      call(
        'GET',
        `/admin/finance/businesses/${encodeURIComponent(businessId)}/tax`,
        businessTaxSchema,
      ),
    adminSetBusinessTax: (businessId: string, body: z.input<typeof businessTaxInputSchema>) =>
      call(
        'PUT',
        `/admin/finance/businesses/${encodeURIComponent(businessId)}/tax`,
        businessTaxSchema,
        body,
      ),
    adminPayments: (params: Page & { status?: string; needsAttention?: 'true' | 'false' } = {}) =>
      call('GET', `/admin/finance/payments${query(params)}`, pageSchema(adminPaymentSchema)),
    adminPayment: (id: string) =>
      call('GET', `/admin/finance/payments/${encodeURIComponent(id)}`, adminPaymentSchema),
    adminRefundRequests: (params: Page & { status?: string } = {}) =>
      call(
        'GET',
        `/admin/finance/refund-requests${query(params)}`,
        pageSchema(refundRequestSchema),
      ),
    adminCreateRefundRequest: (body: z.input<typeof refundRequestInputSchema>) =>
      call('POST', '/admin/finance/refund-requests', refundRequestSchema, body),
    adminDecideRefundRequest: (id: string, body: z.input<typeof refundDecisionSchema>) =>
      call(
        'POST',
        `/admin/finance/refund-requests/${encodeURIComponent(id)}/decision`,
        refundRequestSchema,
        body,
      ),
    adminEarnings: (params: Page & { businessId?: string; status?: string } = {}) =>
      call('GET', `/admin/finance/earnings${query(params)}`, pageSchema(adminEarningSchema)),
    adminDisputes: (params: Page & { status?: string } = {}) =>
      call('GET', `/admin/finance/disputes${query(params)}`, pageSchema(disputeSchema)),
    adminOpenDispute: (body: z.input<typeof disputeInputSchema>) =>
      call('POST', '/admin/finance/disputes', disputeSchema, body),
    adminResolveDispute: (id: string, body: z.input<typeof disputeResolutionSchema>) =>
      call(
        'POST',
        `/admin/finance/disputes/${encodeURIComponent(id)}/resolution`,
        disputeSchema,
        body,
      ),
    adminPayoutHolds: () => call('GET', '/admin/finance/holds', z.array(payoutHoldSchema)),
    adminPlacePayoutHold: (body: z.input<typeof payoutHoldInputSchema>) =>
      call('POST', '/admin/finance/holds', z.array(payoutHoldSchema), body),
    adminReleasePayoutHold: (id: string) =>
      call(
        'POST',
        `/admin/finance/holds/${encodeURIComponent(id)}/release`,
        z.array(payoutHoldSchema),
      ),
    adminPayouts: (params: Page & { status?: string; businessId?: string } = {}) =>
      call('GET', `/admin/finance/payouts${query(params)}`, pageSchema(payoutSchema)),
    adminRunPayouts: () => call('POST', '/admin/finance/payout-runs', payoutRunResultSchema),
    adminReconciliationRuns: (params: Page = {}) =>
      call(
        'GET',
        `/admin/finance/reconciliation-runs${query(params)}`,
        pageSchema(reconciliationRunSchema),
      ),
    adminRunReconciliation: (date?: string) =>
      call(
        'POST',
        '/admin/finance/reconciliation-runs',
        reconciliationRunSchema,
        date ? { date } : {},
      ),
    adminResolveReconciliationItem: (id: string, note: string) =>
      call(
        'POST',
        `/admin/finance/reconciliation-items/${encodeURIComponent(id)}/resolve`,
        reconciliationRunSchema,
        { note },
      ),

    // After-sales (phase 6): customer
    cancelSuborder: (orderId: string, body: z.input<typeof customerCancelRequestSchema>) =>
      call('POST', `/orders/${encodeURIComponent(orderId)}/cancel`, orderSchema, body),
    requestReturn: (orderId: string, body: z.input<typeof returnRequestInputSchema>) =>
      call('POST', `/orders/${encodeURIComponent(orderId)}/returns`, returnSchema, body),
    myReturns: (params: Page = {}) =>
      call('GET', `/me/returns${query(params)}`, pageSchema(returnSchema)),
    createReview: (body: z.input<typeof reviewInputSchema>) =>
      call('POST', '/reviews', myReviewSchema, body),
    myReviews: (params: Page = {}) =>
      call('GET', `/me/reviews${query(params)}`, pageSchema(myReviewSchema)),
    productReviews: (productId: string, params: Page = {}) =>
      call(
        'GET',
        `/products/${encodeURIComponent(productId)}/reviews${query(params)}`,
        reviewSummarySchema,
      ),
    venueReviews: (businessId: string, params: Page = {}) =>
      call(
        'GET',
        `/venues/${encodeURIComponent(businessId)}/reviews${query(params)}`,
        reviewSummarySchema,
      ),
    openTicket: (body: z.input<typeof ticketInputSchema>) =>
      call('POST', '/support/tickets', ticketSchema, body),
    myTickets: (params: Page = {}) =>
      call('GET', `/support/tickets${query(params)}`, pageSchema(ticketListItemSchema)),
    supportInfo: () => call('GET', '/support/info', supportInfoSchema),
    ticketAttachmentUpload: (
      id: string,
      body: {
        fileName: string;
        contentType: 'application/pdf' | 'image/jpeg' | 'image/png';
        sizeBytes: number;
      },
    ) =>
      call(
        'POST',
        `/support/tickets/${encodeURIComponent(id)}/attachments`,
        uploadTicketSchema,
        body,
      ),
    completeTicketAttachment: (id: string, attachmentId: string) =>
      call(
        'POST',
        `/support/tickets/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachmentId)}/complete`,
        ticketSchema,
      ),
    ticketAttachment: (id: string, attachmentId: string) =>
      call(
        'GET',
        `/support/tickets/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachmentId)}/download`,
        signedUrlSchema,
      ),
    myTicket: (id: string) =>
      call('GET', `/support/tickets/${encodeURIComponent(id)}`, ticketSchema),
    replyToTicket: (id: string, body: string) =>
      call('POST', `/support/tickets/${encodeURIComponent(id)}/messages`, ticketSchema, { body }),
    notifications: (params: Page = {}) =>
      call('GET', `/me/notifications${query(params)}`, notificationPageSchema),
    markNotificationsRead: (ids?: string[]) =>
      call('POST', '/me/notifications/read', notificationPageSchema, ids ? { ids } : {}),

    // After-sales: business
    fulfil: (id: string, moId: string, body: z.input<typeof fulfillmentActionRequestSchema>) =>
      call(
        'POST',
        `${biz(id)}/orders/${encodeURIComponent(moId)}/fulfillment`,
        merchantOrderSchema,
        body,
      ),
    businessReturns: (id: string, params: Page & { status?: string } = {}) =>
      call('GET', `${biz(id)}/returns${query(params)}`, pageSchema(returnSchema)),
    businessReturn: (id: string, returnId: string) =>
      call('GET', `${biz(id)}/returns/${encodeURIComponent(returnId)}`, returnSchema),
    returnAction: (id: string, returnId: string, body: z.input<typeof returnActionRequestSchema>) =>
      call(
        'POST',
        `${biz(id)}/returns/${encodeURIComponent(returnId)}/actions`,
        returnSchema,
        body,
      ),
    businessReviews: (id: string, params: Page = {}) =>
      call('GET', `${biz(id)}/reviews${query(params)}`, pageSchema(merchantReviewSchema)),
    replyToReview: (id: string, reviewId: string, body: string) =>
      call(
        'POST',
        `${biz(id)}/reviews/${encodeURIComponent(reviewId)}/replies`,
        merchantReviewSchema,
        { body },
      ),
    reportReview: (id: string, reviewId: string, reason: string) =>
      call(
        'POST',
        `${biz(id)}/reviews/${encodeURIComponent(reviewId)}/report`,
        merchantReviewSchema,
        { reason },
      ),
    businessDashboard: (
      id: string,
      params: {
        from?: string | undefined;
        to?: string | undefined;
        branchId?: string | undefined;
      } = {},
    ) => call('GET', `${biz(id)}/dashboard${query(params)}`, businessDashboardSchema),
    businessStatement: (id: string, params: { from: string; to: string }) =>
      download(`${biz(id)}/finance/statement${query(params)}`),

    // After-sales: admin
    adminDashboard: (params: { from?: string | undefined; to?: string | undefined } = {}) =>
      call('GET', `/admin/dashboard${query(params)}`, adminDashboardSchema),
    adminOrders: (params: Page & { status?: string; stuck?: boolean } = {}) =>
      call('GET', `/admin/orders${query(params)}`, pageSchema(adminOrderSchema)),
    adminReviews: (params: Page & { filter?: string } = {}) =>
      call('GET', `/admin/reviews${query(params)}`, pageSchema(adminReviewSchema)),
    adminModerateReview: (id: string, body: z.input<typeof reviewModerationSchema>) =>
      call('POST', `/admin/reviews/${encodeURIComponent(id)}/moderation`, adminReviewSchema, body),
    adminTickets: (params: Page & { queue?: string } = {}) =>
      call('GET', `/admin/support/tickets${query(params)}`, pageSchema(adminTicketListItemSchema)),
    adminTicket: (id: string) =>
      call('GET', `/admin/support/tickets/${encodeURIComponent(id)}`, adminTicketSchema),
    adminTicketMessage: (id: string, body: { body: string; internal?: boolean }) =>
      call(
        'POST',
        `/admin/support/tickets/${encodeURIComponent(id)}/messages`,
        adminTicketSchema,
        body,
      ),
    adminTicketAction: (
      id: string,
      action:
        | 'assign_to_me'
        | 'unassign'
        | 'resolve'
        | { action: 'set_priority'; priority: 'low' | 'normal' | 'high' | 'urgent' }
        | { action: 'escalate'; escalation: 'payment' | 'security' | 'operations'; reason: string },
    ) =>
      call(
        'POST',
        `/admin/support/tickets/${encodeURIComponent(id)}/actions`,
        adminTicketSchema,
        typeof action === 'string' ? { action } : action,
      ),
    adminTicketAttachment: (id: string, attachmentId: string) =>
      call(
        'GET',
        `/admin/support/tickets/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachmentId)}/download`,
        signedUrlSchema,
      ),
    adminEmirates: () => call('GET', '/admin/operations/emirates', adminEmirateListSchema),
    adminLegal: () => call('GET', '/admin/legal', adminLegalListSchema),
    adminLegalDocument: (id: string) =>
      call('GET', `/admin/legal/${encodeURIComponent(id)}`, adminLegalDocumentSchema),
    adminCreateLegalDraft: (body: z.input<typeof createLegalDraftRequestSchema>) =>
      call('POST', '/admin/legal', adminLegalDocumentSchema, body),
    adminUpdateLegalDraft: (id: string, body: z.input<typeof updateLegalDraftRequestSchema>) =>
      call('PATCH', `/admin/legal/${encodeURIComponent(id)}`, adminLegalDocumentSchema, body),
    adminPublishLegal: (id: string, body: z.input<typeof publishLegalRequestSchema> = {}) =>
      call(
        'POST',
        `/admin/legal/${encodeURIComponent(id)}/publish`,
        adminLegalDocumentSchema,
        body,
      ),
    adminSetEmirate: (code: string, enabled: boolean) =>
      call(
        'PATCH',
        `/admin/operations/emirates/${encodeURIComponent(code)}`,
        adminEmirateListSchema,
        {
          enabled,
        },
      ),
    adminNotificationTemplates: () =>
      call('GET', '/admin/notifications/templates', z.array(notificationTemplateSchema)),
    adminCreateNotificationTemplate: (body: z.input<typeof notificationTemplateInputSchema>) =>
      call('POST', '/admin/notifications/templates', z.array(notificationTemplateSchema), body),
    adminOutboxHealth: () => call('GET', '/admin/notifications/health', outboxHealthSchema),
    adminFailedNotifications: () =>
      call('GET', '/admin/notifications/failed', z.array(failedOutboxEventSchema)),
    adminRetryNotification: (id: string) =>
      call(
        'POST',
        `/admin/notifications/failed/${encodeURIComponent(id)}/retry`,
        outboxHealthSchema,
      ),
    adminExport: (kind: string, params: { from: string; to: string }) =>
      download(`/admin/exports/${encodeURIComponent(kind)}${query(params)}`),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
