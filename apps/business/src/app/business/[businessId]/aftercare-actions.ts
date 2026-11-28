'use server';

import { ApiClientError } from '@jays/api-client';
import { FULFILLMENT_ACTIONS, type FulfillmentAction } from '@jays/domain';
import { redirect } from 'next/navigation';
import { serverApi } from '../../../lib/api';

const UUID = /^[0-9a-f-]{36}$/i;
const text = (f: FormData, name: string) => String(f.get(name) ?? '').trim();
const optional = (f: FormData, name: string) => text(f, name) || undefined;

function uuid(f: FormData, name: string): string {
  const id = text(f, name);
  if (!UUID.test(id)) redirect('/business/gateway');
  return id;
}

function fail(path: string, error: unknown): never {
  const code = error instanceof ApiClientError ? error.code : 'INTERNAL';
  redirect(`${path}?error=${encodeURIComponent(code)}`);
}

/** Process, ship, deliver or cancel a suborder. The status the merchant saw guards against races. */
export async function fulfil(f: FormData) {
  const id = uuid(f, 'businessId');
  const moId = uuid(f, 'merchantOrderId');
  const path = `/business/${id}/orders/${moId}`;
  const action = text(f, 'action') as FulfillmentAction;
  const expected = text(f, 'expectedStatus');
  if (!(FULFILLMENT_ACTIONS as readonly string[]).includes(action)) redirect(path);
  try {
    await (
      await serverApi()
    ).fulfil(id, moId, {
      action,
      expectedStatus: expected as 'paid' | 'processing' | 'shipped',
      carrier: optional(f, 'carrier'),
      trackingNumber: optional(f, 'trackingNumber'),
      trackingUrl: optional(f, 'trackingUrl'),
      reason: optional(f, 'reason'),
    });
  } catch (error) {
    fail(path, error);
  }
  redirect(`${path}?saved=${action}`);
}

export async function returnAction(f: FormData) {
  const id = uuid(f, 'businessId');
  const returnId = uuid(f, 'returnId');
  const path = `/business/${id}/returns`;
  const action = text(f, 'action');
  if (!['approve', 'reject', 'receive'].includes(action)) redirect(path);
  try {
    await (
      await serverApi()
    ).returnAction(id, returnId, {
      action: action as 'approve' | 'reject' | 'receive',
      reason: optional(f, 'reason'),
    });
  } catch (error) {
    fail(path, error);
  }
  redirect(`${path}?saved=${action}`);
}

export async function replyToReview(f: FormData) {
  const id = uuid(f, 'businessId');
  const reviewId = uuid(f, 'reviewId');
  const path = `/business/${id}/reviews`;
  try {
    await (await serverApi()).replyToReview(id, reviewId, text(f, 'body'));
  } catch (error) {
    fail(path, error);
  }
  redirect(`${path}?saved=reply`);
}

export async function reportReview(f: FormData) {
  const id = uuid(f, 'businessId');
  const reviewId = uuid(f, 'reviewId');
  const path = `/business/${id}/reviews`;
  try {
    await (await serverApi()).reportReview(id, reviewId, text(f, 'reason'));
  } catch (error) {
    fail(path, error);
  }
  redirect(`${path}?saved=report`);
}
