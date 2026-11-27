import type {
  acceptInviteRequestSchema,
  addressInputSchema,
  confirmMfaRequestSchema,
  createAdminInviteRequestSchema,
  createBusinessRequestSchema,
  inviteMemberRequestSchema,
  registerRequestSchema,
  updateMeRequestSchema,
} from '@jays/contracts';
import {
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

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export function createApiClient(options: ApiClientOptions) {
  const doFetch = options.fetch ?? fetch;
  const base = options.baseUrl.replace(/\/$/, '');

  async function call<S extends z.ZodType>(
    method: Method,
    path: string,
    schema: S,
    body?: unknown,
  ): Promise<z.infer<S>> {
    const headers: Record<string, string> = { accept: 'application/json', ...options.headers?.() };
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

  return {
    // Public reference data
    emirates: () => call('GET', '/emirates', emirateListSchema),

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
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
