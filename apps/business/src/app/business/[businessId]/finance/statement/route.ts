import { ApiClientError } from '@jays/api-client';
import { type NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { serverApi } from '../../../../../lib/api';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Streams the earnings statement CSV from the API (finance.view; audited there). */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ businessId: string }> },
) {
  const { businessId } = await params;
  const from = request.nextUrl.searchParams.get('from') ?? '';
  const to = request.nextUrl.searchParams.get('to') ?? '';
  const back = (code: string) =>
    NextResponse.redirect(
      new URL(`/business/${businessId}/finance?error=${encodeURIComponent(code)}`, request.url),
      { status: 303 },
    );
  if (!DATE.test(from) || !DATE.test(to)) return back('VALIDATION_FAILED');
  try {
    const file = await (await serverApi()).businessStatement(businessId, { from, to });
    return new NextResponse(file.text, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${file.filename.replace(/[^\w.-]/g, '')}"`,
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    return back(error instanceof ApiClientError ? error.code : 'INTERNAL');
  }
}
