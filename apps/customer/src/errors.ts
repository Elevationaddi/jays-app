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
    SLOT_UNAVAILABLE: 'error.slotUnavailable',
    HOLD_LIMIT: 'error.holdLimit',
    HOLD_EXPIRED: 'error.holdExpired',
    CANCEL_TOO_LATE: 'error.cancelTooLate',
    RESCHEDULE_NOT_ALLOWED: 'error.rescheduleNotAllowed',
    OUTSIDE_BOOKING_WINDOW: 'error.outsideWindow',
    NOT_REFUNDABLE: 'error.notRefundable',
    RETURN_OPEN: 'error.returnOpen',
    RETURN_WINDOW_CLOSED: 'error.returnWindowClosed',
    RETURN_EXCEEDS_PURCHASE: 'error.returnExceedsPurchase',
    ALREADY_REVIEWED: 'error.alreadyReviewed',
    NOT_REVIEWABLE: 'error.notReviewable',
    INVALID_TRANSITION: 'care.changed',
    VERSION_CONFLICT: 'care.changed',
    PASSWORD_INCORRECT: 'error.passwordIncorrect',
    DELETION_PENDING: 'error.deletionPending',
    ACCOUNT_HAS_OPEN_ACTIVITY: 'error.openActivity',
    INVALID_UNSUBSCRIBE_LINK: 'unsubscribe.invalid',
  };
  return { key: map[error.code] ?? 'common.error', seconds };
}
