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

export async function ticketPriority(f: FormData) {
  const ticketId = id(f, 'ticketId', '/admin/support');
  const path = `/admin/support/${ticketId}`;
  const priority = str(f, 'priority');
  if (!['low', 'normal', 'high', 'urgent'].includes(priority)) redirect(path);
  try {
    await (
      await serverApi()
    ).adminTicketAction(ticketId, {
      action: 'set_priority',
      priority: priority as 'low' | 'normal' | 'high' | 'urgent',
    });
  } catch (error) {
    fail(path, error);
  }
  redirect(`${path}?saved=1`);
}

/** Payment and security incidents follow their own procedure (D12; RUNBOOK). */
export async function ticketEscalate(f: FormData) {
  const ticketId = id(f, 'ticketId', '/admin/support');
  const path = `/admin/support/${ticketId}`;
  const escalation = str(f, 'escalation');
  if (!['payment', 'security', 'operations'].includes(escalation)) redirect(path);
  try {
    await (
      await serverApi()
    ).adminTicketAction(ticketId, {
      action: 'escalate',
      escalation: escalation as 'payment' | 'security' | 'operations',
      reason: str(f, 'reason'),
    });
  } catch (error) {
    fail(path, error);
  }
  redirect(`${path}?saved=1`);
}

/** Opens a five-minute link to a scanned attachment (audited). */
export async function ticketAttachment(f: FormData) {
  const ticketId = id(f, 'ticketId', '/admin/support');
  const attachmentId = id(f, 'attachmentId', `/admin/support/${ticketId}`);
  let url: string;
  try {
    url = (await (await serverApi()).adminTicketAttachment(ticketId, attachmentId)).url;
  } catch (error) {
    fail(`/admin/support/${ticketId}`, error);
  }
  redirect(url);
}

export async function setEmirate(f: FormData) {
  const path = '/admin/operations';
  const code = str(f, 'code');
  if (!/^[A-Z]{3}$/.test(code)) redirect(path);
  try {
    await (await serverApi()).adminSetEmirate(code, str(f, 'enabled') === 'on');
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

export async function retryNotification(f: FormData) {
  const path = '/admin/notifications';
  const outboxId = id(f, 'outboxId', path);
  try {
    await (await serverApi()).adminRetryNotification(outboxId);
  } catch (error) {
    fail(path, error);
  }
  redirect(`${path}?retried=1`);
}
