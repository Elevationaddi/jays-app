'use server';

import { ApiClientError } from '@jays/api-client';
import { redirect } from 'next/navigation';
import { serverApi } from '../../lib/api';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

function fail(path: string, error: unknown): never {
  const code = error instanceof ApiClientError ? error.code : 'INTERNAL';
  redirect(`${path}${path.includes('?') ? '&' : '?'}error=${encodeURIComponent(code)}`);
}

function id(f: FormData, k: string, fallback: string) {
  const v = str(f, k);
  if (!UUID.test(v)) redirect(fallback);
  return v;
}

export async function moderateReview(f: FormData) {
  const back = str(f, 'back').startsWith('/admin/reviews') ? str(f, 'back') : '/admin/reviews';
  const reviewId = id(f, 'reviewId', back);
  const action = str(f, 'action');
  if (!['hide', 'restore', 'dismiss_report'].includes(action)) redirect(back);
  try {
    await (
      await serverApi()
    ).adminModerateReview(reviewId, {
      action: action as 'hide' | 'restore' | 'dismiss_report',
      reason: str(f, 'reason'),
    });
  } catch (error) {
    fail(back, error);
  }
  redirect(`${back}${back.includes('?') ? '&' : '?'}saved=1`);
}

export async function ticketMessage(f: FormData) {
  const ticketId = id(f, 'ticketId', '/admin/support');
  const path = `/admin/support/${ticketId}`;
  try {
    await (
      await serverApi()
    ).adminTicketMessage(ticketId, { body: str(f, 'body'), internal: f.get('internal') === 'on' });
  } catch (error) {
    fail(path, error);
  }
  redirect(`${path}?saved=1`);
}

export async function ticketAction(f: FormData) {
  const ticketId = id(f, 'ticketId', '/admin/support');
  const path = `/admin/support/${ticketId}`;
  const action = str(f, 'action');
  if (!['assign_to_me', 'unassign', 'resolve'].includes(action)) redirect(path);
  try {
    await (await serverApi()).adminTicketAction(ticketId, action as 'resolve');
  } catch (error) {
    fail(path, error);
  }
  redirect(`${path}?saved=1`);
}

export async function saveTemplate(f: FormData) {
  const path = '/admin/notifications';
  const locale = str(f, 'locale');
  try {
    await (
      await serverApi()
    ).adminCreateNotificationTemplate({
      eventType: str(f, 'eventType'),
      locale: locale === 'ar' ? 'ar' : 'en',
      title: str(f, 'title'),
      body: str(f, 'body'),
    });
  } catch (error) {
    fail(path, error);
  }
  redirect(`${path}?saved=1`);
}
