import { ApiClientError } from '@jays/api-client';
import type { MessageKey } from '@jays/i18n';

export function errorKey(error: unknown): { key: MessageKey; seconds: number } {
  if (!(error instanceof ApiClientError)) return { key: 'common.error', seconds: 0 };
  const seconds = error.retryAfterSeconds ?? 60;
  if (error.isNetworkError) return { key: 'common.offline', seconds };
  const map: Record<string, MessageKey> = {
    INVALID_CREDENTIALS: 'auth.error.invalidCredentials',
    OTP_INVALID: 'auth.error.otpInvalid',
    OTP_EXPIRED: 'auth.error.otpExpired',
    OTP_ATTEMPTS_EXCEEDED: 'auth.error.otpLocked',
    RATE_LIMITED: 'auth.error.rateLimited',
    OTP_RESEND_COOLDOWN: 'auth.error.rateLimited',
    OTP_SEND_LIMIT: 'auth.error.rateLimited',
    VALIDATION_FAILED: 'auth.error.validation',
    OUT_OF_STOCK: 'error.outOfStock',
    INSUFFICIENT_STOCK: 'error.outOfStock',
    QUOTE_STALE: 'error.quoteStale',
    QUOTE_EXPIRED: 'error.quoteExpired',
    DELIVERY_UNAVAILABLE: 'error.deliveryUnavailable',
    NO_DELIVERY_ZONE: 'error.deliveryUnavailable',
    CART_NOT_READY: 'error.cartNotReady',
    PAYMENT_PROVIDER_UNAVAILABLE: 'error.paymentUnavailable',
  };
  return { key: map[error.code] ?? 'common.error', seconds };
}
