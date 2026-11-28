import { describe, expect, it } from 'vitest';
import {
  canReview,
  customerCanCancel,
  fulfillmentTransition,
  renderTemplate,
  retryDelayMs,
  returnAmount,
  returnTransition,
  templatePlaceholders,
  ticketTransition,
  withinReturnWindow,
} from './aftercare.js';

describe('fulfillment', () => {
  it('moves forward only', () => {
    expect(fulfillmentTransition('paid', 'process')).toBe('processing');
    expect(fulfillmentTransition('paid', 'ship')).toBe('shipped');
    expect(fulfillmentTransition('processing', 'ship')).toBe('shipped');
    expect(fulfillmentTransition('shipped', 'deliver')).toBe('delivered');
    expect(fulfillmentTransition('paid', 'deliver')).toBeNull();
    expect(fulfillmentTransition('delivered', 'ship')).toBeNull();
    expect(fulfillmentTransition('pending_payment', 'process')).toBeNull();
  });

  it('cancels only before dispatch', () => {
    expect(fulfillmentTransition('processing', 'cancel')).toBe('canceled');
    expect(fulfillmentTransition('shipped', 'cancel')).toBeNull();
    expect(customerCanCancel('paid')).toBe(true);
    expect(customerCanCancel('processing')).toBe(false);
  });
});

describe('returns', () => {
  it('accepts returns for 14 days after delivery', () => {
    const delivered = new Date('2027-01-01T10:00:00Z');
    expect(withinReturnWindow(delivered, new Date('2027-01-15T10:00:00Z'))).toBe(true);
    expect(withinReturnWindow(delivered, new Date('2027-01-15T10:00:01Z'))).toBe(false);
  });

  it('never refunds more than a line paid, putting the remainder on the last unit', () => {
    const line = { qty: 3, lineTotalFils: 10_000, discountFils: 0, alreadyReturnedQty: 0 };
    expect(returnAmount(line, 1)).toBe(3_333);
    expect(returnAmount({ ...line, alreadyReturnedQty: 1 }, 2)).toBe(6_667);
    expect(returnAmount(line, 3)).toBe(10_000);
    expect(returnAmount({ ...line, discountFils: 1_000 }, 3)).toBe(9_000);
    expect(() => returnAmount({ ...line, alreadyReturnedQty: 2 }, 2)).toThrow(RangeError);
    expect(() => returnAmount(line, 0)).toThrow(RangeError);
  });

  it('follows requested -> approved/rejected -> received', () => {
    expect(returnTransition('requested', 'approve')).toBe('approved');
    expect(returnTransition('requested', 'reject')).toBe('rejected');
    expect(returnTransition('approved', 'receive')).toBe('received');
    expect(returnTransition('requested', 'receive')).toBeNull();
    expect(returnTransition('rejected', 'approve')).toBeNull();
  });
});

describe('reviews (T10)', () => {
  it('needs a delivered item or a completed appointment', () => {
    expect(canReview({ kind: 'order_item', suborderStatus: 'delivered' })).toBe(true);
    expect(canReview({ kind: 'order_item', suborderStatus: 'shipped' })).toBe(false);
    expect(canReview({ kind: 'booking', status: 'completed' })).toBe(true);
    expect(canReview({ kind: 'booking', status: 'no_show' })).toBe(false);
  });
});

describe('support tickets', () => {
  it('follows open -> assigned -> awaiting_reply -> resolved -> reopened', () => {
    expect(ticketTransition('open', 'assign')).toBe('assigned');
    expect(ticketTransition('assigned', 'admin_reply')).toBe('awaiting_reply');
    expect(ticketTransition('awaiting_reply', 'customer_reply')).toBe('open');
    expect(ticketTransition('assigned', 'customer_reply')).toBe('assigned');
    expect(ticketTransition('awaiting_reply', 'resolve')).toBe('resolved');
    expect(ticketTransition('resolved', 'customer_reply')).toBe('reopened');
    expect(ticketTransition('resolved', 'admin_reply')).toBeNull();
  });
});

describe('notification templates', () => {
  it('fills placeholders and leaves unknown ones visible', () => {
    expect(renderTemplate('Order {ref} for {amount}', { ref: 'AB12' })).toBe(
      'Order AB12 for {amount}',
    );
    expect(templatePlaceholders('{b} and {a} and {b}')).toEqual(['a', 'b']);
  });

  it('backs off exponentially up to an hour', () => {
    expect(retryDelayMs(1)).toBe(30_000);
    expect(retryDelayMs(2)).toBe(60_000);
    expect(retryDelayMs(20)).toBe(3_600_000);
  });
});
