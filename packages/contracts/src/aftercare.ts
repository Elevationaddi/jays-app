import { FULFILLMENT_ACTIONS } from '@jays/domain';
import { z } from 'zod';
import { isoDateTime } from './identity.js';

/**
 * Phase 6 contracts (ADR-0016): fulfillment actions, cancellations, returns, reviews, support
 * tickets, notifications, dashboards and exports. Amounts are integer fils in AED.
 */

const cursorQuery = {
  cursor: z.string().min(1).max(300).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};
const fils = z.number().int();
const localized = z.object({ en: z.string(), ar: z.string() });
const bizRef = z.object({ id: z.uuid(), name: localized });
const reason = z.string().trim().min(3).max(1000);
const actor = z.object({ id: z.uuid(), name: z.string() }).nullable();

// Fulfillment ---------------------------------------------------------------------------------------

export const fulfillmentActionRequestSchema = z
  .strictObject({
    action: z.enum(FULFILLMENT_ACTIONS),
    /** The status the merchant saw; a stale action is refused with 409. */
    expectedStatus: z.enum(['paid', 'processing', 'shipped']),
    carrier: z.string().trim().min(1).max(80).optional(),
    trackingNumber: z.string().trim().min(1).max(100).optional(),
    trackingUrl: z
      .url({ protocol: /^https$/ })
      .max(500)
      .optional(),
    reason: reason.optional(),
  })
  .refine((b) => b.action !== 'ship' || (b.carrier && b.trackingNumber), {
    message: 'Shipping needs a carrier and a tracking number.',
    path: ['trackingNumber'],
  })
  .refine((b) => b.action !== 'cancel' || b.reason, {
    message: 'Cancelling needs a reason.',
    path: ['reason'],
  });
export type FulfillmentActionRequest = z.infer<typeof fulfillmentActionRequestSchema>;

export const customerCancelRequestSchema = z.strictObject({
  merchantOrderId: z.uuid(),
  reason: reason.optional(),
});
export type CustomerCancelRequest = z.infer<typeof customerCancelRequestSchema>;

export const adminOrderListQuerySchema = z.strictObject({
  status: z.enum(['paid', 'processing', 'shipped', 'delivered', 'canceled']).optional(),
  /** Paid or processing for longer than two days. */
  stuck: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  ...cursorQuery,
});
export type AdminOrderListQuery = z.infer<typeof adminOrderListQuerySchema>;

export const adminOrderSchema = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  business: bizRef,
  status: z.string(),
  totalFils: fils,
  itemCount: z.number().int(),
  carrier: z.string().nullable(),
  trackingNumber: z.string().nullable(),
  paidAt: isoDateTime.nullable(),
  shippedAt: isoDateTime.nullable(),
  deliveredAt: isoDateTime.nullable(),
  openReturn: z.boolean(),
  createdAt: isoDateTime,
});
export type AdminOrderView = z.infer<typeof adminOrderSchema>;

// Returns -------------------------------------------------------------------------------------------

export const returnRequestInputSchema = z.strictObject({
  merchantOrderId: z.uuid(),
  items: z
    .array(z.strictObject({ orderItemId: z.uuid(), qty: z.number().int().min(1).max(999) }))
    .min(1)
    .max(50),
  reason,
});
export type ReturnRequestInput = z.infer<typeof returnRequestInputSchema>;

export const returnStatusSchema = z.enum([
  'requested',
  'approved',
  'rejected',
  'received',
  'refund_pending',
  'refunded',
  'refund_failed',
]);

export const returnSchema = z.object({
  id: z.uuid(),
  merchantOrderId: z.uuid(),
  orderId: z.uuid(),
  business: bizRef,
  status: returnStatusSchema,
  reason: z.string(),
  amountFils: fils,
  items: z.array(
    z.object({
      orderItemId: z.uuid(),
      title: localized,
      variantName: localized,
      qty: z.number().int(),
      amountFils: fils,
    }),
  ),
  decisionReason: z.string().nullable(),
  decidedAt: isoDateTime.nullable(),
  receivedAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
});
export type ReturnView = z.infer<typeof returnSchema>;

export const returnListQuerySchema = z.strictObject({
  status: returnStatusSchema.optional(),
  ...cursorQuery,
});
export type ReturnListQuery = z.infer<typeof returnListQuerySchema>;

export const returnActionRequestSchema = z
  .strictObject({
    action: z.enum(['approve', 'reject', 'receive']),
    reason: reason.optional(),
  })
  .refine((b) => b.action !== 'reject' || b.reason, {
    message: 'Rejecting needs a reason.',
    path: ['reason'],
  });
export type ReturnActionRequest = z.infer<typeof returnActionRequestSchema>;

// Reviews -------------------------------------------------------------------------------------------

export const reviewInputSchema = z
  .strictObject({
    orderItemId: z.uuid().optional(),
    bookingId: z.uuid().optional(),
    rating: z.number().int().min(1).max(5),
    body: z.string().trim().max(2000).optional(),
  })
  .refine((b) => !!b.orderItemId !== !!b.bookingId, {
    message: 'Review either an order item or an appointment.',
    path: ['orderItemId'],
  });
export type ReviewInput = z.infer<typeof reviewInputSchema>;

export const publicReviewSchema = z.object({
  id: z.uuid(),
  rating: z.number().int(),
  body: z.string().nullable(),
  /** First name only, or null. */
  author: z.string().nullable(),
  reply: z.object({ body: z.string(), at: isoDateTime }).nullable(),
  createdAt: isoDateTime,
});
export type PublicReview = z.infer<typeof publicReviewSchema>;

export const reviewSummarySchema = z.object({
  average: z.number().nullable(),
  count: z.number().int(),
  items: z.array(publicReviewSchema),
  nextCursor: z.string().nullable(),
});
export type ReviewSummary = z.infer<typeof reviewSummarySchema>;

export const reviewListQuerySchema = z.strictObject({ ...cursorQuery });

export const myReviewSchema = publicReviewSchema.extend({
  targetType: z.enum(['product', 'booking']),
  orderItemId: z.uuid().nullable(),
  bookingId: z.uuid().nullable(),
  business: bizRef,
  status: z.enum(['published', 'hidden']),
});
export type MyReview = z.infer<typeof myReviewSchema>;

export const merchantReviewSchema = z.object({
  id: z.uuid(),
  targetType: z.enum(['product', 'booking']),
  subject: localized,
  rating: z.number().int(),
  body: z.string().nullable(),
  author: z.string().nullable(),
  status: z.enum(['published', 'hidden']),
  replies: z.array(z.object({ body: z.string(), at: isoDateTime })),
  reported: z.boolean(),
  createdAt: isoDateTime,
});
export type MerchantReview = z.infer<typeof merchantReviewSchema>;

export const reviewReplySchema = z.strictObject({ body: z.string().trim().min(1).max(2000) });
export const reviewReportSchema = z.strictObject({ reason });

export const adminReviewSchema = merchantReviewSchema.extend({
  business: bizRef,
  hiddenReason: z.string().nullable(),
  report: z
    .object({
      id: z.uuid(),
      reason: z.string(),
      at: isoDateTime,
      resolvedAt: isoDateTime.nullable(),
    })
    .nullable(),
});
export type AdminReview = z.infer<typeof adminReviewSchema>;

export const adminReviewListQuerySchema = z.strictObject({
  filter: z.enum(['reported', 'hidden', 'all']).default('reported'),
  ...cursorQuery,
});
export type AdminReviewListQuery = z.infer<typeof adminReviewListQuerySchema>;

export const reviewModerationSchema = z.strictObject({
  action: z.enum(['hide', 'restore', 'dismiss_report']),
  reason,
});
export type ReviewModeration = z.infer<typeof reviewModerationSchema>;

// Support -------------------------------------------------------------------------------------------

export const ticketStatusSchema = z.enum([
  'open',
  'assigned',
  'awaiting_reply',
  'resolved',
  'reopened',
]);
export const ticketTypeSchema = z.enum(['order', 'booking', 'payment', 'account', 'other']);
export const ticketPrioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);
export const ticketEscalationSchema = z.enum(['payment', 'security', 'operations']);

/** A scanned file on a ticket (PDF, JPEG or PNG). Only clean files are listed. */
export const ticketAttachmentSchema = z.object({
  id: z.uuid(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int(),
  author: z.enum(['customer', 'support']),
  createdAt: isoDateTime,
});
export const ticketAttachmentUploadSchema = z.strictObject({
  fileName: z.string().trim().min(1).max(200),
  contentType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
  sizeBytes: z
    .number()
    .int()
    .min(1)
    .max(10 * 1024 * 1024),
});

export const ticketInputSchema = z.strictObject({
  type: ticketTypeSchema,
  orderId: z.uuid().optional(),
  bookingId: z.uuid().optional(),
  subject: z.string().trim().min(3).max(200),
  body: z.string().trim().min(1).max(5000),
});
export type TicketInput = z.infer<typeof ticketInputSchema>;

export const ticketMessageSchema = z.object({
  id: z.uuid(),
  author: z.enum(['customer', 'support']),
  /** Admin names are shown only to admins. */
  authorName: z.string().nullable(),
  body: z.string(),
  internal: z.boolean(),
  createdAt: isoDateTime,
});

export const ticketSchema = z.object({
  id: z.uuid(),
  type: ticketTypeSchema,
  orderId: z.uuid().nullable(),
  bookingId: z.uuid().nullable(),
  subject: z.string(),
  status: ticketStatusSchema,
  priority: ticketPrioritySchema,
  createdAt: isoDateTime,
  lastMessageAt: isoDateTime,
  messages: z.array(ticketMessageSchema),
  attachments: z.array(ticketAttachmentSchema),
});
export type TicketView = z.infer<typeof ticketSchema>;

export const ticketListItemSchema = ticketSchema.omit({ messages: true, attachments: true });
export const ticketListQuerySchema = z.strictObject({ ...cursorQuery });

export const adminTicketSchema = ticketSchema.extend({
  customer: z.object({ id: z.uuid(), name: z.string().nullable(), contact: z.string() }),
  assignedTo: actor,
  slaDueAt: isoDateTime,
  overdue: z.boolean(),
  escalation: ticketEscalationSchema.nullable(),
  escalatedAt: isoDateTime.nullable(),
  /** When support first replied to the customer (not internal notes). */
  firstResponseAt: isoDateTime.nullable(),
});
export type AdminTicketView = z.infer<typeof adminTicketSchema>;
export const adminTicketListItemSchema = adminTicketSchema.omit({
  messages: true,
  attachments: true,
});

export const adminTicketListQuerySchema = z.strictObject({
  queue: z.enum(['open', 'mine', 'awaiting_reply', 'escalated', 'resolved', 'all']).default('open'),
  ...cursorQuery,
});
export type AdminTicketListQuery = z.infer<typeof adminTicketListQuerySchema>;

export const ticketReplySchema = z.strictObject({ body: z.string().trim().min(1).max(5000) });
export const adminTicketMessageSchema = z.strictObject({
  body: z.string().trim().min(1).max(5000),
  internal: z.boolean().default(false),
});
export const adminTicketActionSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.enum(['assign_to_me', 'unassign', 'resolve']) }),
  z.strictObject({ action: z.literal('set_priority'), priority: ticketPrioritySchema }),
  /** Payment and security incidents follow their own procedure and become urgent (D12). */
  z.strictObject({
    action: z.literal('escalate'),
    escalation: ticketEscalationSchema,
    reason: z.string().trim().min(3).max(1000),
  }),
]);
export type AdminTicketAction = z.infer<typeof adminTicketActionSchema>;

// Notifications -------------------------------------------------------------------------------------

export const notificationSchema = z.object({
  id: z.uuid(),
  eventType: z.string(),
  title: z.string(),
  body: z.string(),
  link: z.string().nullable(),
  readAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
});
export const notificationPageSchema = z.object({
  items: z.array(notificationSchema),
  nextCursor: z.string().nullable(),
  unread: z.number().int(),
});
export const notificationListQuerySchema = z.strictObject({ ...cursorQuery });
export const markNotificationsReadSchema = z.strictObject({
  /** Omit to mark everything read. */
  ids: z.array(z.uuid()).max(100).optional(),
});

export const notificationTemplateSchema = z.object({
  eventType: z.string(),
  locale: z.enum(['en', 'ar']),
  version: z.number().int(),
  title: z.string(),
  body: z.string(),
  placeholders: z.array(z.string()),
  updatedBy: actor,
  updatedAt: isoDateTime,
});
export type NotificationTemplateView = z.infer<typeof notificationTemplateSchema>;
export const notificationTemplateInputSchema = z.strictObject({
  eventType: z.string().regex(/^[a-z_]+(\.[a-z_]+)+$/),
  locale: z.enum(['en', 'ar']),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(2000),
});

export const outboxHealthSchema = z.object({
  pending: z.number().int(),
  retrying: z.number().int(),
  failed: z.number().int(),
  oldestPendingSeconds: z.number().int().nullable(),
});

/** An event that used every attempt. No payload: it can hold personal data. */
export const failedOutboxEventSchema = z.object({
  id: z.uuid(),
  eventType: z.string(),
  attempts: z.number().int(),
  lastError: z.string().nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type FailedOutboxEvent = z.infer<typeof failedOutboxEventSchema>;

// Dashboards and exports ----------------------------------------------------------------------------

export const dashboardRangeSchema = z.strictObject({
  /** Inclusive local dates (Asia/Dubai). Defaults to the last 30 days. */
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  branchId: z.uuid().optional(),
});
export type DashboardRange = z.infer<typeof dashboardRangeSchema>;

const dailyPoint = z.object({ date: z.iso.date(), value: fils });

export const businessDashboardSchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  shop: z
    .object({
      grossSalesFils: fils,
      netSalesFils: fils,
      refundsFils: fils,
      orders: z.object({
        paid: z.number().int(),
        processing: z.number().int(),
        shipped: z.number().int(),
        delivered: z.number().int(),
        canceled: z.number().int(),
      }),
      openReturns: z.number().int(),
      lowStock: z.array(
        z.object({
          variantId: z.uuid(),
          title: localized,
          sku: z.string(),
          available: z.number().int(),
        }),
      ),
      daily: z.array(dailyPoint),
    })
    .nullable(),
  services: z
    .object({
      bookings: z.number().int(),
      completed: z.number().int(),
      canceled: z.number().int(),
      noShows: z.number().int(),
      revenueFils: fils,
      /** Booked staff minutes as a share of scheduled staff minutes, 0 to 1; null without shifts. */
      occupancy: z.number().nullable(),
      daily: z.array(dailyPoint),
    })
    .nullable(),
});
export type BusinessDashboard = z.infer<typeof businessDashboardSchema>;

export const adminDashboardSchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  gmvFils: z.object({ shop: fils, services: fils }),
  refundsFils: fils,
  commissionFils: fils,
  orders: z.number().int(),
  bookings: z.number().int(),
  activeMerchants: z.number().int(),
  newCustomers: z.number().int(),
  pendingVerification: z.number().int(),
  openDisputes: z.number().int(),
  payoutExceptions: z.number().int(),
  openTickets: z.number().int(),
  overdueTickets: z.number().int(),
  reportedReviews: z.number().int(),
  failedNotifications: z.number().int(),
  daily: z.array(z.object({ date: z.iso.date(), shop: fils, services: fils })),
});
export type AdminDashboard = z.infer<typeof adminDashboardSchema>;

export const EXPORT_KINDS = ['payments', 'refunds', 'payouts', 'orders', 'bookings'] as const;
export const exportKindSchema = z.enum(EXPORT_KINDS);
export const exportQuerySchema = z.strictObject({
  from: z.iso.date(),
  to: z.iso.date(),
});
export type ExportQuery = z.infer<typeof exportQuerySchema>;
