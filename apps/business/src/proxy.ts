import { tokenPairSchema } from '@jays/contracts';
import { type NextRequest, NextResponse } from 'next/server';
import { ACCESS_COOKIE, REFRESH_COOKIE, cookieOptions } from './lib/session';

const API_URL = process.env['API_URL'] ?? 'http://localhost:3000/v1';

/**
 * Runs before each page render. When the short-lived access cookie has expired but a refresh
 * cookie exists, it rotates the tokens once and passes the new access token to this render.
 * Signed-out visitors to /business are sent to sign in.
 */
export async function proxy(request: NextRequest) {
  const isPrefetch =
    request.headers.has('next-router-prefetch') || request.headers.get('purpose') === 'prefetch';
  let access = request.cookies.get(ACCESS_COOKIE)?.value;
  const refresh = request.cookies.get(REFRESH_COOKIE)?.value;
  let rotated: ReturnType<typeof tokenPairSchema.parse> | null = null;
  let refreshFailed = false;

  if (!access && refresh && !isPrefetch) {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: refresh }),
        cache: 'no-store',
      });
      if (res.ok) {
        rotated = tokenPairSchema.parse(await res.json());
        access = rotated.accessToken;
        request.cookies.set(ACCESS_COOKIE, rotated.accessToken);
        request.cookies.set(REFRESH_COOKIE, rotated.refreshToken);
      } else if (res.status === 401) {
        refreshFailed = true;
      }
    } catch {
      // API unreachable: leave cookies alone; the page shows its offline/error state.
    }
  }

  const needsAuth = request.nextUrl.pathname.startsWith('/business');
  const response =
    needsAuth && !access && !isPrefetch
      ? NextResponse.redirect(
          new URL(
            `/sign-in?returnTo=${encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search)}`,
            request.url,
          ),
        )
      : NextResponse.next({ request: { headers: request.headers } });
  if (rotated) {
    response.cookies.set(
      ACCESS_COOKIE,
      rotated.accessToken,
      cookieOptions(rotated.accessTokenExpiresAt),
    );
    response.cookies.set(
      REFRESH_COOKIE,
      rotated.refreshToken,
      cookieOptions(rotated.refreshTokenExpiresAt),
    );
  }
  if (refreshFailed) response.cookies.delete(REFRESH_COOKIE);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
