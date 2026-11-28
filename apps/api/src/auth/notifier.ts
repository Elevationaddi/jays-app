import { Logger } from '@nestjs/common';
import type { Locale } from '@jays/i18n';
import { maskContact } from './crypto.js';

export type MessageTemplate =
  | 'otp.verify_contact'
  | 'otp.password_reset'
  | 'account.exists'
  | 'admin.invite'
  /** A rendered platform notification: params carry `title` and `body` (ADR-0016). */
  | 'notification';

export interface OutboundMessage {
  channel: 'email' | 'sms';
  to: string;
  template: MessageTemplate;
  locale: Locale;
  params: Record<string, string>;
  /** Makes a retried send a no-op at the provider (one per outbox event, user and channel). */
  idempotencyKey?: string;
}

/**
 * Email/SMS delivery adapter (ADR-0031): the local mock, or Resend for email. There is no SMS
 * provider (ADR-0024), so callers check `supports('sms')` before offering text messages.
 */
export interface Notifier {
  supports(channel: OutboundMessage['channel']): boolean;
  send(message: OutboundMessage): Promise<void>;
}

/**
 * Local mock. It does not pretend delivery happened anywhere: it writes the message to the local
 * log so a developer can read the code, and keeps the last messages in memory for tests.
 * The environment schema refuses NOTIFY_PROVIDER=mock in production.
 */
export class MockNotifier implements Notifier {
  private readonly logger = new Logger('MockNotifier');
  readonly sent: OutboundMessage[] = [];
  private failures = 0;

  /** Test seam: pretend the provider has no SMS, as with Resend. */
  sms = true;

  constructor(private readonly logToConsole: boolean) {}

  supports(channel: OutboundMessage['channel']): boolean {
    return channel === 'email' || this.sms;
  }

  /** Test seam (T12): the next `count` sends throw, as a provider outage would. */
  failNext(count: number) {
    this.failures = count;
  }

  async send(message: OutboundMessage): Promise<void> {
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error('mock provider unavailable');
    }
    this.sent.push(message);
    if (this.sent.length > 500) this.sent.shift();
    if (this.logToConsole) {
      this.logger.warn(
        `[mock ${message.channel}] to=${maskContact(message.to)} template=${message.template} ${JSON.stringify(message.params)}`,
      );
    }
  }

  /** Most recent message to a destination (tests and local tooling only). */
  lastTo(to: string): OutboundMessage | undefined {
    return [...this.sent].reverse().find((m) => m.to === to);
  }
}
