import type {
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
  publicProductListItemSchema,
  publicProductSchema,
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
        sort?: 'newest' | 'price_asc' | 'price_desc';
        cursor?: string;
        limit?: number;
      } = {},
    ) => call('GET', `/products${query(params)}`, pageSchema(publicProductListItemSchema)),
    product: (id: string) =>
      call('GET', `/products/${encodeURIComponent(id)}`, publicProductSchema),

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
    quote: (addressId: string) => call('POST', '/checkout/quote', quoteSchema, { addressId }),
    /** Send the same idempotency key when retrying, so a lost response never creates two orders. */
    createOrder: (quoteId: string, idempotencyKey: string) =>
      call('POST', '/orders', createOrderResponseSchema, { quoteId }, idem(idempotencyKey)),
    orders: (params?: { cursor?: string; limit?: number }) =>
      call('GET', `/orders${q(params)}`, pageSchema(orderListItemSchema)),
    order: (id: string) => call('GET', `/orders/${encodeURIComponent(id)}`, orderSchema),
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
    putDeliveryZones: (id: string, body: z.input<typeof putDeliveryZonesRequestSchema>) =>
      call('PUT', `${biz(id)}/delivery-zones`, deliveryZoneListSchema, body),
    merchantOrders: (
      id: string,
      params: { status?: string; cursor?: string; limit?: number } = {},
    ) => call('GET', `${biz(id)}/orders${query(params)}`, pageSchema(merchantOrderListItemSchema)),
    merchantOrder: (id: string, merchantOrderId: string) =>
      call('GET', `${biz(id)}/orders/${encodeURIComponent(merchantOrderId)}`, merchantOrderSchema),

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
    adminBrands: () => call('GET', '/admin/brands', brandListSchema),
    createBrand: (body: z.input<typeof createBrandRequestSchema>) =>
      call('POST', '/admin/brands', brandSchema, body),
    updateBrand: (id: string, body: z.input<typeof updateBrandRequestSchema>) =>
      call('PATCH', `/admin/brands/${encodeURIComponent(id)}`, brandSchema, body),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
