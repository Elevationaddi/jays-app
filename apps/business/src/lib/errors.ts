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
    case 'IN_REVIEW':
      return 'error.inReview';
    case 'PROFILE_LOCKED':
      return 'error.profileLocked';
    case 'ONBOARDING_INCOMPLETE':
      return 'error.onboardingIncomplete';
    case 'FILE_TYPE_MISMATCH':
    case 'CONTENT_TYPE_MISMATCH':
      return 'error.fileType';
    case 'FILE_TOO_LARGE':
      return 'error.fileTooLarge';
    case 'FILE_INFECTED':
      return 'error.fileInfected';
    case 'IMAGE_DIMENSIONS':
      return 'error.imageDimensions';
    case 'UPLOAD_EXPIRED':
    case 'UPLOAD_MISSING':
    case 'FILE_EMPTY':
      return 'error.uploadExpired';
    case 'VERSION_CONFLICT':
      return 'error.versionConflict';
    case 'INVALID_TRANSITION':
      return 'error.invalidTransition';
    case 'LICENSE_EXPIRED':
      return 'error.licenseExpired';
    case 'NOTHING_TO_SUBMIT':
      return 'error.nothingToSubmit';
    case 'SLUG_TAKEN':
      return 'error.slugTaken';
    case 'HAS_ACTIVE_CHILDREN':
      return 'error.hasChildren';
    case 'DEPTH_LIMIT':
      return 'error.depthLimit';
    case 'PARENT_INVALID':
      return 'error.parentInvalid';
    case 'STOREFRONT_INCOMPLETE':
      return 'error.storefrontIncomplete';
    case 'NO_PENDING_CHANGES':
      return 'error.noPendingChanges';
    case 'MODE_NOT_PENDING':
      return 'error.modeNotPending';
    case 'FORBIDDEN':
      return 'error.forbidden';
    default:
      return 'common.error';
  }
}
