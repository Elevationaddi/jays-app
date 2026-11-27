import { Logger } from '@nestjs/common';
import type { Locale } from '@jays/i18n';
import { maskContact } from './crypto.js';

export type MessageTemplate =
  'otp.verify_contact' | 'otp.password_reset' | 'account.exists' | 'admin.invite';

export interface OutboundMessage {
  channel: 'email' | 'sms';
  to: string;
  template: MessageTemplate;
  locale: Locale;
  params: Record<string, string>;
}

/** Email/SMS delivery adapter. A real provider replaces the mock once chosen (ADR-0007). */
export interface Notifier {
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

  constructor(private readonly logToConsole: boolean) {}

  async send(message: OutboundMessage): Promise<void> {
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
