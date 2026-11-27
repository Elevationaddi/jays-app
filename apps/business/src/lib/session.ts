import type { TokenPair } from '@jays/contracts';
import { cookies } from 'next/headers';

/**
 * Web sessions (ADR-0011): the browser never sees tokens. The Next.js server keeps the access and
 * refresh tokens in HttpOnly, SameSite=Lax cookies (Secure in production) and calls the API
 * server-to-server. Server Actions reject cross-origin posts (Origin must match Host), which,
 * with SameSite cookies, is the CSRF protection.
 */
export const ACCESS_COOKIE = 'jays_at';
export const REFRESH_COOKIE = 'jays_rt';
export const WORKSPACE_COOKIE = 'jays_workspace';

const base = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};

export function cookieOptions(expiresAt: string) {
  return { ...base, expires: new Date(expiresAt) };
}

/** Only callable from Server Actions and Route Handlers. */
export async function storeTokens(tokens: TokenPair): Promise<void> {
  const jar = await cookies();
  jar.set(ACCESS_COOKIE, tokens.accessToken, cookieOptions(tokens.accessTokenExpiresAt));
  jar.set(REFRESH_COOKIE, tokens.refreshToken, cookieOptions(tokens.refreshTokenExpiresAt));
}

export async function clearTokens(): Promise<void> {
  const jar = await cookies();
  jar.delete(ACCESS_COOKIE);
  jar.delete(REFRESH_COOKIE);
}
