import { createApiClient } from '@jays/api-client';
import { cookies, headers } from 'next/headers';
import { ACCESS_COOKIE } from './session';

export const API_URL = process.env['API_URL'] ?? 'http://localhost:3000/v1';

/**
 * Private staging (ADR-0035): the API refuses requests without this header. The value is a server
 * environment variable of this portal and never reaches the browser.
 */
export function stagingHeaders(): Record<string, string> {
  const token = process.env['STAGING_ACCESS_TOKEN'];
  return token ? { 'x-staging-access': token } : {};
}

/** True on the private staging deployment, where a demonstration-data notice is shown. */
export const isStaging = () => process.env['APP_ENV'] === 'staging';

/**
 * Server-side API client using the session cookie. The caller's IP is forwarded so the API's
 * per-IP rate limits see real clients (the API trusts it only with TRUST_PROXY_HOPS set).
 */
export async function serverApi() {
  const [jar, list] = await Promise.all([cookies(), headers()]);
  const token = jar.get(ACCESS_COOKIE)?.value;
  const forwarded = list.get('x-forwarded-for')?.split(',')[0]?.trim();
  return createApiClient({
    baseUrl: API_URL,
    accessToken: () => token,
    headers: () => ({
      ...stagingHeaders(),
      ...(forwarded ? { 'x-forwarded-for': forwarded } : {}),
      'user-agent': list.get('user-agent') ?? 'admin-console',
    }),
  });
}

/** Accepts only same-site relative paths, so redirects cannot be pointed at another site. */
export function safeReturnTo(
  value: FormDataEntryValue | string | null | undefined,
  fallback = '/',
): string {
  const text = typeof value === 'string' ? value : '';
  return text.startsWith('/') && !text.startsWith('//') && !text.startsWith('/\\')
    ? text
    : fallback;
}
