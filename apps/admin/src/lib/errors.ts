import type { MessageKey } from '@jays/i18n';

/** Maps API error codes to UI copy. Unknown codes fall back to a generic message. */
export function errorMessageKey(code: string | undefined): MessageKey | null {
  switch (code) {
    case undefined:
    case '':
      return null;
    case 'INVALID_CREDENTIALS':
      return 'auth.error.invalidCredentials';
    case 'OTP_INVALID':
      return 'auth.error.otpInvalid';
    case 'OTP_EXPIRED':
      return 'auth.error.otpExpired';
    case 'OTP_ATTEMPTS_EXCEEDED':
      return 'auth.error.otpLocked';
    case 'RATE_LIMITED':
    case 'OTP_RESEND_COOLDOWN':
    case 'OTP_SEND_LIMIT':
      return 'auth.error.rateLimited';
    case 'VALIDATION_FAILED':
      return 'auth.error.validation';
    case 'NETWORK_ERROR':
      return 'common.offline';
    default:
      return 'common.error';
  }
}
