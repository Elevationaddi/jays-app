import { z } from 'zod';

/** Error codes from docs/07-api.md, keyed by HTTP status. */
export const ERROR_CODES = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  POLICY_VIOLATION: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  DEPENDENCY_UNAVAILABLE: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string(),
    fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
    requestId: z.string().min(1),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

/** Maps an HTTP status to the generic code used when no more specific code applies. */
export function defaultCodeForStatus(status: number): ErrorCode {
  const match = (Object.entries(ERROR_CODES) as [ErrorCode, number][]).find(
    ([, s]) => s === status,
  );
  if (match) return match[0];
  return status >= 500 ? 'INTERNAL' : 'VALIDATION_FAILED';
}
