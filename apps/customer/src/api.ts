import { createApiClient } from '@jays/api-client';

/** The API base URL comes from EXPO_PUBLIC_API_URL; the default is the local API. */
export const API_URL = process.env['EXPO_PUBLIC_API_URL'] ?? 'http://localhost:3000/v1';

/**
 * Private staging (ADR-0035). Staging builds carry the staging access header; the web build itself
 * sits behind Vercel Authentication, so only signed-in team members can load it.
 */
export const IS_STAGING = process.env['EXPO_PUBLIC_APP_ENV'] === 'staging';
const STAGING_TOKEN = process.env['EXPO_PUBLIC_STAGING_ACCESS_TOKEN'];
export const stagingHeaders = (): Record<string, string> =>
  STAGING_TOKEN ? { 'x-staging-access': STAGING_TOKEN } : {};

export function makeApi(accessToken: () => string | null | undefined, locale: () => string) {
  return createApiClient({
    baseUrl: API_URL,
    accessToken,
    headers: () => ({ ...stagingHeaders(), 'accept-language': locale() }),
  });
}
