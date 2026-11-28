import { pushDeviceListSchema } from '@jays/contracts';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotificationsService } from '../aftercare/notifications.service.js';
import {
  addToCart,
  approvedShop,
  customerWithAddress,
  listedProduct,
  pay,
  placedOrder,
  quoteFor,
} from '../testing/commerce.js';
import { bearer, type Harness, signUp, startHarness, uniquePhone } from '../testing/harness.js';
import { EmailBudget, EmailBudgetExceededError } from './email-budget.js';

// Mock tests (ADR-0031): the mock email notifier and mock push sender stand in for Resend and
// Firebase Cloud Messaging. The email budget runs against the real database.
let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});

const token = (n: string) => `fictional-fcm-token-${n}-${Math.random().toString(36).slice(2)}`;

describe('push devices (ADR-0031)', () => {
  it('registers idempotently, moves a token to its latest account and never returns it', async () => {
    const a = await signUp(h);
    const b = await signUp(h);
    const t = token('shared');
    const register = (s: typeof a) =>
      h
        .http()
        .post('/v1/me/push-devices')
        .set('Authorization', bearer(s))
        .send({ token: t, platform: 'android' })
        .expect(200);
    await register(a);
    await register(a);
    const listA = pushDeviceListSchema.parse(
      (await h.http().get('/v1/me/push-devices').set('Authorization', bearer(a)).expect(200)).body,
    );
    expect(listA.items).toHaveLength(1);
    expect(JSON.stringify(listA)).not.toContain(t);

    await register(b);
    const after = pushDeviceListSchema.parse(
      (await h.http().get('/v1/me/push-devices').set('Authorization', bearer(a)).expect(200)).body,
    );
    expect(after.items).toHaveLength(0);

    await h
      .http()
      .post('/v1/me/push-devices/unregister')
      .set('Authorization', bearer(b))
      .send({ token: t })
      .expect(204);
    const none = pushDeviceListSchema.parse(
      (await h.http().get('/v1/me/push-devices').set('Authorization', bearer(b)).expect(200)).body,
    );
    expect(none.items).toHaveLength(0);
    await h
      .http()
      .post('/v1/me/push-devices')
      .set('Authorization', bearer(b))
      .send({ token: 'bad token with spaces', platform: 'ios' })
      .expect(400);
  });

  it('pushes an event once per device, revokes dead tokens and respects the push switch', async () => {
    const shop = await approvedShop(h);
    const product = await listedProduct(h, shop, [{ priceFils: 10_000, stock: 5 }]);
    const { customer, addressId } = await customerWithAddress(h, 'DXB');
    const live = token('live');
    const dead = token('dead');
    for (const t of [live, dead]) {
      await h
        .http()
        .post('/v1/me/push-devices')
        .set('Authorization', bearer(customer))
        .send({ token: t, platform: 'ios' })
        .expect(200);
    }
    h.push.invalidTokens.add(dead);
    await addToCart(h, customer, product.variantIds[0] as string, 1);
    const q = await quoteFor(h, customer, addressId);
    const order = await placedOrder(h, customer, q.quoteId);
    await pay(h, order);
    const event = await h.db
      .selectFrom('outbox')
      .select('id')
      .where('event_type', '=', 'order.paid')
      .where(sql<string>`payload ->> 'orderId'`, '=', order.orderId)
      .executeTakeFirstOrThrow();
    const dispatcher = h.app.get(NotificationsService);
    await dispatcher.dispatch(10, [event.id]);
    const pushed = h.push.sent.filter((m) => m.token === live);
    expect(pushed).toHaveLength(1);
    expect(pushed[0]!.link).toBe(`/orders/${order.orderId}`);
    const devices = await h.db
      .selectFrom('push_devices')
      .select(['token', 'revoked_at', 'revoke_reason'])
      .where('user_id', '=', customer.user.id)
      .execute();
    expect(devices.find((d) => d.token === dead)).toMatchObject({ revoke_reason: 'invalid' });
    expect(devices.find((d) => d.token === live)?.revoked_at).toBeNull();

    // A retry of the same event sends nothing new.
    await h.db
      .updateTable('outbox')
      .set({ status: 'pending' })
      .where('id', '=', event.id)
      .execute();
    await dispatcher.dispatch(10, [event.id]);
    expect(h.push.sent.filter((m) => m.token === live)).toHaveLength(1);

    // With push switched off, nothing is pushed.
    await h
      .http()
      .patch('/v1/me/privacy')
      .set('Authorization', bearer(customer))
      .send({ notifications: { push: false } })
      .expect(200);
    await h.db.deleteFrom('notification_deliveries').where('outbox_id', '=', event.id).execute();
    await h.db
      .updateTable('outbox')
      .set({ status: 'pending' })
      .where('id', '=', event.id)
      .execute();
    await dispatcher.dispatch(10, [event.id]);
    expect(h.push.sent.filter((m) => m.token === live)).toHaveLength(1);
  });
});

describe('email budget (ADR-0031)', () => {
  // A day of its own, so no other test shares the counter.
  const day = new Date(Date.UTC(2090 + Math.floor(Math.random() * 9), 2, 10, 12));
  const budget = () => new EmailBudget(h.db, { now: () => day }, 10, 1000);

  it('stops non-essential email at 80% of the day and keeps the rest for security email', async () => {
    const b = budget();
    for (let i = 0; i < 8; i++) await b.reserve(false);
    const blocked = await b.reserve(false).catch((e: unknown) => e);
    expect(blocked).toBeInstanceOf(EmailBudgetExceededError);
    expect((blocked as EmailBudgetExceededError).retryAt.toISOString()).toBe(
      new Date(Date.UTC(day.getUTCFullYear(), 2, 11, 0, 5)).toISOString(),
    );
    await b.reserve(true);
    await b.reserve(true);
    await expect(b.reserve(true)).rejects.toBeInstanceOf(EmailBudgetExceededError);
    await b.release(true);
    await b.reserve(true);
    expect(await b.usage()).toEqual({
      day: { sent: 10, limit: 10 },
      month: { sent: 10, limit: 1000 },
    });
  });

  it('never lets concurrent senders overshoot the daily limit', async () => {
    const other = new Date(day.getTime() + 2 * 86_400_000);
    const b = new EmailBudget(h.db, { now: () => other }, 10, 1000);
    const results = await Promise.allSettled(Array.from({ length: 15 }, () => b.reserve(true)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(10);
  });
});

describe('no SMS provider (ADR-0031)', () => {
  it('refuses sign-up and recovery by phone when text messages are unavailable', async () => {
    h.notifier.sms = false;
    try {
      const reg = await h
        .http()
        .post('/v1/auth/register')
        .send({ phone: uniquePhone(), password: 'Fictional-Passw0rd', acceptTerms: true })
        .expect(422);
      expect(reg.body.error.code).toBe('SMS_UNAVAILABLE');
      const reset = await h
        .http()
        .post('/v1/auth/password/reset-request')
        .send({ identifier: uniquePhone() })
        .expect(422);
      expect(reset.body.error.code).toBe('SMS_UNAVAILABLE');
    } finally {
      h.notifier.sms = true;
    }
  });
});
