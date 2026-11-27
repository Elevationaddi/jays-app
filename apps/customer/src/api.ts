import { createApiClient } from '@jays/api-client';

/** The API base URL comes from EXPO_PUBLIC_API_URL; the default is the local API. */
export const API_URL = process.env['EXPO_PUBLIC_API_URL'] ?? 'http://localhost:3000/v1';

export function makeApi(accessToken: () => string | null | undefined, locale: () => string) {
  return createApiClient({
    baseUrl: API_URL,
    accessToken,
    headers: () => ({ 'accept-language': locale() }),
  });
}
