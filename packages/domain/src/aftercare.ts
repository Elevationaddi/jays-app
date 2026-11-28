/**
 * After the sale (docs/05-workflows.md; ADR-0016): suborder fulfillment, cancellations, returns,
 * reviews, support tickets and notification templates. Pure rules, no I/O.
 */

// Fulfillment -------------------------------------------------------------------------------------

export const FULFILLMENT_ACTIONS = ['process', 'ship', 'deliver', 'cancel'] as const;
export type FulfillmentAction = (typeof FULFILLMENT_ACTIONS)[number];
export type SuborderStatus =
  'pending_payment' | 'paid' | 'processing' | 'shipped' | 'delivered' | 'canceled';

const NEXT: Record<FulfillmentAction, { from: readonly SuborderStatus[]; to: SuborderStatus }> = {
  process: { from: ['paid'], to: 'processing' },
  ship: { from: ['paid', 'processing'], to: 'shipped' },
  deliver: { from: ['shipped'], to: 'delivered' },
  // Cancellation is only possible before dispatch; afterwards the return workflow applies.
  cancel: { from: ['paid', 'processing'], to: 'canceled' },
};

/** The status a merchant action leads to, or null when the action is not allowed now. */
export function fulfillmentTransition(
  status: SuborderStatus,
  action: FulfillmentAction,
): SuborderStatus | null {
  const rule = NEXT[action];
  return rule.from.includes(status) ? rule.to : null;
}

/** A customer may cancel a suborder only before the merchant starts processing it. */
export function customerCanCancel(status: SuborderStatus): boolean {
  return status === 'paid';
}

// Returns -------------------------------------------------------------------------------------------

/** Proposed default (ADR-0007 D7, ADR-0016): returns accepted for 14 days after delivery. */
export const RETURN_WINDOW_DAYS = 14;

/**
 * A business may offer a longer window, never a shorter one, until a lawyer confirms the
 * statutory minimum (ADR-0029; legal review checklist 4.4).
 */
export const RETURN_WINDOW_MIN_DAYS = RETURN_WINDOW_DAYS;
export const RETURN_WINDOW_MAX_DAYS = 90;

/**
 * Whether an item can be returned: the categories it sits in (its own and every parent) must all
 * be returnable, unless the customer reports it faulty or wrong, which is always accepted for
 * review by the business.
 */
export function itemReturnable(categoryChainReturnable: readonly boolean[], faulty: boolean) {
  return faulty || categoryChainReturnable.every(Boolean);
}

/** The categories marked non-returnable, with every category beneath them. */
export function nonReturnableCategories(
  categories: readonly { id: string; parentId: string | null; returnable: boolean }[],
): Set<string> {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const out = new Set<string>();
  for (const c of categories) {
    let cur: (typeof categories)[number] | undefined = c;
    for (let depth = 0; cur && depth < 10; depth++) {
      if (!cur.returnable) {
        out.add(c.id);
        break;
      }
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
  }
  return out;
}

export function withinReturnWindow(deliveredAt: Date, now: Date, days = RETURN_WINDOW_DAYS) {
  return now.getTime() <= deliveredAt.getTime() + days * 86_400_000;
}

export interface ReturnLine {
  qty: number;
  lineTotalFils: number;
  discountFils: number;
  /** Units of this line already returned or being returned. */
  alreadyReturnedQty: number;
}

/**
 * What returning `qty` units of a line refunds: the line's paid value (VAT-inclusive, after its
 * discount) spread evenly over its units, with the rounding remainder on the last unit so the
 * whole line never refunds more or less than was paid. Delivery is not refunded on a return.
 */
export function returnAmount(line: ReturnLine, qty: number): number {
  if (!Number.isInteger(qty) || qty <= 0) throw new RangeError('Quantity must be positive.');
  if (line.alreadyReturnedQty + qty > line.qty) throw new RangeError('More than was bought.');
  const paid = line.lineTotalFils - line.discountFils;
  const perUnit = Math.floor(paid / line.qty);
  const remainder = paid - perUnit * line.qty;
  const includesLast = line.alreadyReturnedQty + qty === line.qty;
  return perUnit * qty + (includesLast ? remainder : 0);
}

export type ReturnAction = 'approve' | 'reject' | 'receive';
export type ReturnStatus =
  | 'requested'
  | 'approved'
  | 'rejected'
  | 'received'
  | 'refund_pending'
  | 'refunded'
  | 'refund_failed';

export function returnTransition(status: ReturnStatus, action: ReturnAction): ReturnStatus | null {
  if (action === 'approve' && status === 'requested') return 'approved';
  if (action === 'reject' && status === 'requested') return 'rejected';
  if (action === 'receive' && status === 'approved') return 'received';
  return null;
}

// Reviews -------------------------------------------------------------------------------------------

/** T10: only a delivered order item or a completed appointment can be reviewed. */
export function canReview(
  target:
    { kind: 'order_item'; suborderStatus: SuborderStatus } | { kind: 'booking'; status: string },
): boolean {
  return target.kind === 'order_item'
    ? target.suborderStatus === 'delivered'
    : target.status === 'completed';
}

// Support -------------------------------------------------------------------------------------------

export type TicketStatus = 'open' | 'assigned' | 'awaiting_reply' | 'resolved' | 'reopened';
export type TicketEvent = 'assign' | 'admin_reply' | 'customer_reply' | 'resolve';

/** Proposed default (ADR-0016; support hours are founder decision D12): first reply within 24 h. */
export const TICKET_SLA_HOURS = 24;

/** Proposed support hours (D12): 9 AM to 9 PM every day, UAE time (UTC+4, no daylight saving). */
export const SUPPORT_HOURS = { opens: '09:00', closes: '21:00', timeZone: 'Asia/Dubai' } as const;

export function supportOpenAt(now: Date): boolean {
  const minutes = (now.getUTCHours() * 60 + now.getUTCMinutes() + 4 * 60) % (24 * 60);
  return minutes >= 9 * 60 && minutes < 21 * 60;
}

export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';
export type TicketEscalation = 'payment' | 'security' | 'operations';

/** Payment questions start high; everything else normal (D12). */
export function initialTicketPriority(type: string): TicketPriority {
  return type === 'payment' ? 'high' : 'normal';
}

/** Payment and security escalations are always urgent (D12: separate escalation procedures). */
export function escalatedPriority(escalation: TicketEscalation, current: TicketPriority) {
  return escalation === 'operations' && current !== 'urgent' ? 'high' : 'urgent';
}

export function ticketTransition(status: TicketStatus, event: TicketEvent): TicketStatus | null {
  switch (event) {
    case 'assign':
      return status === 'resolved' ? null : 'assigned';
    case 'admin_reply':
      return status === 'resolved' ? null : 'awaiting_reply';
    case 'customer_reply':
      // A customer writing on a resolved ticket reopens it; otherwise it goes back to the queue.
      return status === 'resolved' ? 'reopened' : status === 'awaiting_reply' ? 'open' : status;
    case 'resolve':
      return status === 'resolved' ? null : 'resolved';
  }
}

// Notifications -------------------------------------------------------------------------------------

/**
 * Fills `{name}` placeholders. Values are plain text: the caller escapes for the channel. Unknown
 * placeholders stay visible so a broken template is noticed rather than silently blank.
 */
export function renderTemplate(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match);
}

/** Placeholders a template uses, for validating admin edits. */
export function templatePlaceholders(template: string): string[] {
  return [...new Set([...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string))].sort();
}

export const NOTIFICATION_MAX_ATTEMPTS = 6;

/** Exponential backoff for a failed delivery: 30 s, 1 min, 2 min ... capped at 1 hour. */
export function retryDelayMs(attempts: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 3_600_000);
}
