import { ApiClientError } from '@jays/api-client';
import { NextResponse, type NextRequest } from 'next/server';
import { serverApi } from '../../../../../../lib/api';

/** Swaps the session for a five-minute signed link to the owner's private document (audited by the API). */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ businessId: string; documentId: string }> },
) {
  const { businessId, documentId } = await params;
  try {
    const link = await (await serverApi()).documentDownload(businessId, documentId);
    return NextResponse.redirect(link.url, { status: 303 });
  } catch (error) {
    const code = error instanceof ApiClientError ? error.code : 'INTERNAL';
    return NextResponse.redirect(
      new URL(`/business/${businessId}/onboarding?error=${encodeURIComponent(code)}`, request.url),
      { status: 303 },
    );
  }
}
