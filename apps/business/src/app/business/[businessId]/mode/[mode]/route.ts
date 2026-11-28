import { ApiClientError } from '@jays/api-client';
import { NextResponse, type NextRequest } from 'next/server';
import { serverApi } from '../../../../../lib/api';
import { WORKSPACE_MODE_COOKIE, modeHome } from '../../../../../lib/workspace';

/**
 * Switches the workspace between Manage Products and Manage Services: remembers the choice and
 * opens the mode's first page. The business and its capabilities come from the API, so a member
 * cannot reach a business or page they have no access to through this route.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ businessId: string; mode: string }> },
) {
  const { businessId, mode } = await params;
  if (mode !== 'shop' && mode !== 'services') {
    return NextResponse.redirect(new URL('/business/gateway', request.url));
  }
  try {
    const business = await (await serverApi()).business(businessId);
    const target =
      business.modes[mode] === 'not_activated'
        ? '/business/gateway'
        : modeHome(business.id, mode, business.myCapabilities);
    const res = NextResponse.redirect(new URL(target, request.url));
    res.cookies.set(WORKSPACE_MODE_COOKIE, mode, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env['NODE_ENV'] === 'production',
      path: '/business',
      maxAge: 60 * 60 * 24 * 365,
    });
    return res;
  } catch (error) {
    if (error instanceof ApiClientError && (error.status === 404 || error.status === 403)) {
      return NextResponse.redirect(new URL('/business/gateway', request.url));
    }
    if (error instanceof ApiClientError && error.status === 401) {
      return NextResponse.redirect(new URL('/sign-in', request.url));
    }
    throw error;
  }
}
