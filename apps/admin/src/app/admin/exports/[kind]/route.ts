import { ApiClientError } from '@jays/api-client';
import { EXPORT_KINDS } from '@jays/contracts';
import { NextResponse, type NextRequest } from 'next/server';
import { serverApi } from '../../../../lib/api';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Streams a CSV export from the API (exports.run; audited there, no personal data). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const from = request.nextUrl.searchParams.get('from') ?? '';
  const to = request.nextUrl.searchParams.get('to') ?? '';
  const back = (code: string) =>
    NextResponse.redirect(
      new URL(`/admin/dashboard?error=${encodeURIComponent(code)}`, request.url),
      {
        status: 303,
      },
    );
  if (!(EXPORT_KINDS as readonly string[]).includes(kind) || !DATE.test(from) || !DATE.test(to)) {
    return back('VALIDATION_FAILED');
  }
  try {
    const file = await (await serverApi()).adminExport(kind, { from, to });
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
