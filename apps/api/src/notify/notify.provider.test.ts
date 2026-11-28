import { fcmServiceAccount } from '@jays/config';
import { describe, expect, it } from 'vitest';
import type { EmailBudget } from './email-budget.js';
import { FcmPushSender } from './push.js';
import { ResendNotifier } from './resend-notifier.js';

/**
 * Real-provider tests (ADR-0031), run only with `pnpm --filter @jays/api test:providers` and
 * credentials in the environment. Never part of CI; no result is claimed without them.
 * - Resend: RESEND_TEST_API_KEY and RESEND_TEST_FROM (a sender on a verified domain). The email
 *   goes to Resend's documented test inbox, delivered@resend.dev, and counts against the plan.
 * - FCM: FCM_TEST_SERVICE_ACCOUNT_JSON and FCM_TEST_TOKEN (a token from a test device).
 */
const resendKey = process.env['RESEND_TEST_API_KEY'];
const resendFrom = process.env['RESEND_TEST_FROM'];
const fcmJson = process.env['FCM_TEST_SERVICE_ACCOUNT_JSON'];
const fcmToken = process.env['FCM_TEST_TOKEN'];
const noBudget = { reserve: async () => {}, release: async () => {} } as unknown as EmailBudget;

describe.skipIf(!resendKey || !resendFrom)('Resend (real provider)', () => {
  it('accepts an Arabic transactional email to the test inbox', async () => {
    const notifier = new ResendNotifier(resendKey as string, resendFrom as string, noBudget);
    await expect(
      notifier.send({
        channel: 'email',
        to: 'delivered@resend.dev',
        template: 'notification',
        locale: 'ar',
        params: { title: 'اختبار', body: 'رسالة تجريبية من بيئة الاختبار.' },
      }),
    ).resolves.toBeUndefined();
  });
});

describe.skipIf(!fcmJson || !fcmToken)('Firebase Cloud Messaging (real provider)', () => {
  it('delivers a push to the test device', async () => {
    const account = fcmServiceAccount(fcmJson);
    expect(account).not.toBeNull();
    const fcm = new FcmPushSender(account as NonNullable<typeof account>);
    expect(
      await fcm.send({ token: fcmToken as string, title: 'Test', body: 'Test push', link: null }),
    ).toBe('sent');
  });
});
