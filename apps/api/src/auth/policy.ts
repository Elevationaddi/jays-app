import type { RateLimitRule } from '../common/rate-limit.js';

/**
 * Security parameters for sign-in (ADR-0009). Engineering defaults, not commercial decisions.
 * Rate limit subjects are hashed contacts or client IPs.
 */
export const OTP_TTL_SECONDS = 10 * 60;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;
export const OTP_MAX_SENDS = 5;

export const USER_ACCESS_TTL_SECONDS = 15 * 60;
export const USER_REFRESH_IDLE_SECONDS = 30 * 24 * 3600;
export const USER_REFRESH_ABSOLUTE_SECONDS = 90 * 24 * 3600;

export const ADMIN_ACCESS_TTL_SECONDS = 10 * 60;
export const ADMIN_REFRESH_IDLE_SECONDS = 8 * 3600;
export const ADMIN_REFRESH_ABSOLUTE_SECONDS = 24 * 3600;
export const ADMIN_INVITE_TTL_SECONDS = 72 * 3600;

/** Placeholder until the founder approves the terms of use (ADR-0007). Stored on every account. */
export const TERMS_VERSION = 'draft-2026-11';

/**
 * Version of the marketing consent wording (D15). A draft until legal approves it (ADR-0018 D13,
 * D15); every consent record stores the version it was given under.
 */
export const MARKETING_POLICY_VERSION = 'draft-2026-11';

/**
 * Days between an account deletion request and the anonymisation, so a mistaken or coerced
 * request can be undone. Proposed default (ADR-0019), pending legal review.
 */
export const ACCOUNT_DELETION_GRACE_DAYS = 14;

const rule = (name: string, limit: number, windowSeconds: number): RateLimitRule => ({
  name,
  limit,
  windowSeconds,
});

export const LIMITS = {
  registerPerIp: rule('register-ip', 10, 3600),
  otpSendPerDestination: rule('otp-send-dest', 5, 3600),
  loginPerIdentifier: rule('login-id', 5, 15 * 60),
  loginPerIp: rule('login-ip', 50, 15 * 60),
  verifyPerIp: rule('verify-ip', 30, 15 * 60),
  resetPerIp: rule('reset-ip', 10, 3600),
  refreshPerIp: rule('refresh-ip', 120, 15 * 60),
  adminLoginPerEmail: rule('admin-login-email', 5, 15 * 60),
  adminLoginPerIp: rule('admin-login-ip', 20, 15 * 60),
  adminInviteAcceptPerIp: rule('admin-invite-ip', 20, 3600),
  createBusinessPerUser: rule('business-create-user', 10, 24 * 3600),
  inviteMemberPerUser: rule('member-invite-user', 50, 24 * 3600),
  uploadPerBusiness: rule('upload-business', 200, 24 * 3600),
  deletionPerUser: rule('deletion-user', 5, 15 * 60),
  unsubscribePerIp: rule('unsubscribe-ip', 60, 3600),
  ticketUploadPerUser: rule('ticket-upload-user', 30, 24 * 3600),
} as const;
