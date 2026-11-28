import { Logger } from '@nestjs/common';
import type { Notifier, OutboundMessage } from '../auth/notifier.js';
import { maskContact } from '../auth/crypto.js';
import type { EmailBudget } from './email-budget.js';
import { ESSENTIAL_TEMPLATES, renderEmail } from './email-templates.js';

const RESEND_API = 'https://api.resend.com';
const TIMEOUT_MS = 10_000;

/** Resend refused or could not be reached. The message never contains the key or address. */
export class EmailSendError extends Error {
  constructor(readonly status: number | null) {
    super(`email provider refused the message${status ? ` (${status})` : ''}`);
    this.name = 'EmailSendError';
  }
}

/**
 * Email through Resend's free plan (ADR-0031), over its REST API with `fetch`, so no SDK is
 * added. Every email reserves a slot in the daily budget first; the slot is given back if
 * Resend refuses the message. There is no SMS provider (ADR-0024).
 */
export class ResendNotifier implements Notifier {
  private readonly log = new Logger('ResendNotifier');

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly budget: EmailBudget,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly apiBase: string = RESEND_API,
  ) {}

  supports(channel: OutboundMessage['channel']): boolean {
    return channel === 'email';
  }

  async send(message: OutboundMessage): Promise<void> {
    if (message.channel !== 'email') throw new EmailSendError(null);
    const essential = ESSENTIAL_TEMPLATES.has(message.template);
    await this.budget.reserve(essential);
    const email = renderEmail(message);
    let status: number | null;
    try {
      const res = await this.fetchImpl(`${this.apiBase}/emails`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
          ...(message.idempotencyKey ? { 'idempotency-key': message.idempotencyKey } : {}),
        },
        body: JSON.stringify({
          from: this.from,
          to: [message.to],
          subject: email.subject,
          html: email.html,
          text: email.text,
          tags: [{ name: 'template', value: message.template.replaceAll('.', '_') }],
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      status = res.status;
      if (res.ok) return;
    } catch {
      status = null;
    }
    // Not sent: give the slot back and let the caller retry (the outbox backs off).
    await this.budget.release(essential);
    this.log.warn(
      { status, to: maskContact(message.to), template: message.template },
      'email not accepted',
    );
    throw new EmailSendError(status);
  }
}
