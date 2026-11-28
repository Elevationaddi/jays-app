-- Phase 6: fulfillment and returns, reviews, support tickets, notifications (ADR-0016).

-- ---------------------------------------------------------------------------------------------
-- Fulfillment. A suborder moves paid -> processing -> shipped -> delivered, or is canceled before
-- dispatch. Shipment details live on the suborder (one shipment per seller in the MVP) and every
-- change is kept in an append-only timeline.
ALTER TABLE merchant_orders ADD COLUMN processing_at timestamptz;
ALTER TABLE merchant_orders ADD COLUMN shipped_at timestamptz;
ALTER TABLE merchant_orders ADD COLUMN canceled_at timestamptz;
ALTER TABLE merchant_orders ADD COLUMN carrier text
  CHECK (carrier IS NULL OR length(btrim(carrier)) BETWEEN 1 AND 80);
ALTER TABLE merchant_orders ADD COLUMN tracking_number text
  CHECK (tracking_number IS NULL OR length(btrim(tracking_number)) BETWEEN 1 AND 100);
ALTER TABLE merchant_orders ADD COLUMN tracking_url text
  CHECK (tracking_url IS NULL OR (tracking_url ~ '^https://' AND length(tracking_url) <= 500));
ALTER TABLE merchant_orders ADD CONSTRAINT merchant_orders_shipped_has_tracking
  CHECK (shipped_at IS NULL OR (carrier IS NOT NULL AND tracking_number IS NOT NULL));
ALTER TABLE merchant_orders ADD CONSTRAINT merchant_orders_delivered_after_shipped
  CHECK (status <> 'delivered' OR (delivered_at IS NOT NULL AND shipped_at IS NOT NULL));

CREATE TABLE merchant_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_order_id uuid NOT NULL REFERENCES merchant_orders (id),
  status text NOT NULL CHECK (status IN (
    'paid', 'processing', 'shipped', 'delivered', 'canceled', 'return_requested',
    'return_approved', 'return_rejected', 'return_received', 'refunded')),
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'admin', 'system')),
  actor_id uuid,
  note text CHECK (note IS NULL OR length(note) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (actor_type = 'system' OR actor_id IS NOT NULL)
);
CREATE INDEX merchant_order_events_mo_idx ON merchant_order_events (merchant_order_id, created_at, id);
CREATE TRIGGER merchant_order_events_append_only BEFORE UPDATE OR DELETE ON merchant_order_events
  FOR EACH ROW EXECUTE FUNCTION append_only();

-- ---------------------------------------------------------------------------------------------
-- Returns: requested -> approved/rejected -> received -> refund_pending -> refunded/refund_failed
-- (docs/05-workflows.md). Restocking is a separate, explicit inventory adjustment.
CREATE TABLE return_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_order_id uuid NOT NULL REFERENCES merchant_orders (id),
  order_id uuid NOT NULL REFERENCES orders (id),
  business_id uuid NOT NULL REFERENCES businesses (id),
  user_id uuid NOT NULL REFERENCES users (id),
  status text NOT NULL DEFAULT 'requested' CHECK (status IN (
    'requested', 'approved', 'rejected', 'received', 'refund_pending', 'refunded',
    'refund_failed')),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 1000),
  amount_fils integer NOT NULL CHECK (amount_fils > 0),
  decision_reason text CHECK (decision_reason IS NULL OR length(decision_reason) <= 1000),
  decided_by uuid REFERENCES users (id),
  decided_at timestamptz,
  received_at timestamptz,
  refund_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'rejected' OR decision_reason IS NOT NULL),
  CHECK (status = 'requested' OR decided_at IS NOT NULL)
);
-- One return in progress per suborder at a time.
CREATE UNIQUE INDEX return_requests_open_idx ON return_requests (merchant_order_id)
  WHERE status IN ('requested', 'approved', 'received', 'refund_pending');
CREATE INDEX return_requests_business_idx ON return_requests (business_id, created_at DESC, id);
CREATE INDEX return_requests_user_idx ON return_requests (user_id, created_at DESC);
CREATE TRIGGER return_requests_updated_at BEFORE UPDATE ON return_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE return_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_request_id uuid NOT NULL REFERENCES return_requests (id),
  order_item_id uuid NOT NULL REFERENCES order_items (id),
  qty integer NOT NULL CHECK (qty > 0),
  amount_fils integer NOT NULL CHECK (amount_fils > 0),
  UNIQUE (return_request_id, order_item_id)
);
CREATE INDEX return_items_order_item_idx ON return_items (order_item_id);

ALTER TABLE refunds DROP CONSTRAINT refunds_reason_check;
ALTER TABLE refunds ADD CONSTRAINT refunds_reason_check CHECK (reason IN (
  'late_payment', 'customer_cancellation', 'business_cancellation', 'admin', 'return'));
ALTER TABLE refunds ADD COLUMN return_request_id uuid UNIQUE REFERENCES return_requests (id);
ALTER TABLE refunds ADD CONSTRAINT refunds_return_has_request
  CHECK ((reason = 'return') = (return_request_id IS NOT NULL));
ALTER TABLE return_requests ADD CONSTRAINT return_requests_refund_fk
  FOREIGN KEY (refund_id) REFERENCES refunds (id);

-- ---------------------------------------------------------------------------------------------
-- Reviews (T10): only for a delivered order item or a completed booking, one each. Merchants
-- reply (history kept) and report; admins hide and restore with a reason.
CREATE TABLE reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  business_id uuid NOT NULL REFERENCES businesses (id),
  target_type text NOT NULL CHECK (target_type IN ('product', 'booking')),
  order_item_id uuid UNIQUE REFERENCES order_items (id),
  product_id uuid REFERENCES products (id),
  booking_id uuid UNIQUE REFERENCES bookings (id),
  service_id uuid REFERENCES services (id),
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body text CHECK (body IS NULL OR length(body) <= 2000),
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'hidden')),
  hidden_reason text CHECK (hidden_reason IS NULL OR length(hidden_reason) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((target_type = 'product') = (order_item_id IS NOT NULL AND product_id IS NOT NULL)),
  CHECK ((target_type = 'booking') = (booking_id IS NOT NULL AND service_id IS NOT NULL)),
  CHECK ((status = 'hidden') = (hidden_reason IS NOT NULL))
);
CREATE INDEX reviews_product_idx ON reviews (product_id, created_at DESC) WHERE status = 'published';
CREATE INDEX reviews_business_idx ON reviews (business_id, created_at DESC, id);
CREATE TRIGGER reviews_updated_at BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE review_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES reviews (id),
  author_id uuid NOT NULL REFERENCES users (id),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX review_replies_review_idx ON review_replies (review_id, created_at, id);
CREATE TRIGGER review_replies_append_only BEFORE UPDATE OR DELETE ON review_replies
  FOR EACH ROW EXECUTE FUNCTION append_only();

CREATE TABLE review_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES reviews (id),
  business_id uuid NOT NULL REFERENCES businesses (id),
  reported_by uuid NOT NULL REFERENCES users (id),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 1000),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES admin_accounts (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((resolved_at IS NULL) = (resolved_by IS NULL))
);
CREATE UNIQUE INDEX review_reports_open_idx ON review_reports (review_id) WHERE resolved_at IS NULL;

-- ---------------------------------------------------------------------------------------------
-- Support tickets: open -> assigned -> awaiting_reply -> resolved -> reopened. Internal notes
-- are never shown to the customer.
CREATE TABLE support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  type text NOT NULL CHECK (type IN ('order', 'booking', 'payment', 'account', 'other')),
  order_id uuid REFERENCES orders (id),
  booking_id uuid REFERENCES bookings (id),
  subject text NOT NULL CHECK (length(btrim(subject)) BETWEEN 3 AND 200),
  status text NOT NULL DEFAULT 'open' CHECK (status IN (
    'open', 'assigned', 'awaiting_reply', 'resolved', 'reopened')),
  assigned_admin_id uuid REFERENCES admin_accounts (id),
  sla_due_at timestamptz NOT NULL,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT (order_id IS NOT NULL AND booking_id IS NOT NULL)),
  CHECK ((status = 'resolved') = (resolved_at IS NOT NULL)),
  CHECK (status <> 'assigned' OR assigned_admin_id IS NOT NULL)
);
CREATE INDEX support_tickets_user_idx ON support_tickets (user_id, last_message_at DESC);
CREATE INDEX support_tickets_queue_idx ON support_tickets (status, sla_due_at, id);
CREATE TRIGGER support_tickets_updated_at BEFORE UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE ticket_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES support_tickets (id),
  author_type text NOT NULL CHECK (author_type IN ('customer', 'admin')),
  author_id uuid NOT NULL,
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 5000),
  internal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (author_type = 'admin' OR NOT internal)
);
CREATE INDEX ticket_messages_ticket_idx ON ticket_messages (ticket_id, created_at, id);
CREATE TRIGGER ticket_messages_append_only BEFORE UPDATE OR DELETE ON ticket_messages
  FOR EACH ROW EXECUTE FUNCTION append_only();

-- ---------------------------------------------------------------------------------------------
-- Notifications. Templates are versioned per event and language; the newest version is used.
-- The dispatcher turns outbox events into in-app notifications and emails, at most once per
-- recipient and channel, retrying failed sends with backoff (T12).
CREATE TABLE notification_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL CHECK (event_type ~ '^[a-z_]+(\.[a-z_]+)+$'),
  locale text NOT NULL CHECK (locale IN ('en', 'ar')),
  version integer NOT NULL CHECK (version > 0),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  created_by uuid REFERENCES admin_accounts (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_type, locale, version)
);
CREATE TRIGGER notification_templates_append_only BEFORE UPDATE OR DELETE ON notification_templates
  FOR EACH ROW EXECUTE FUNCTION append_only();

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  outbox_id uuid NOT NULL REFERENCES outbox (id),
  event_type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  link text CHECK (link IS NULL OR (link ~ '^/' AND length(link) <= 300)),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (outbox_id, user_id)
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC, id);

CREATE TABLE notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_id uuid NOT NULL REFERENCES outbox (id),
  user_id uuid NOT NULL REFERENCES users (id),
  channel text NOT NULL CHECK (channel IN ('email', 'sms')),
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (outbox_id, user_id, channel)
);

INSERT INTO notification_templates (event_type, locale, version, title, body) VALUES
  ('order.paid', 'en', 1, 'Order {ref} confirmed', 'Thank you. We have received your payment of {amount}.'),
  ('order.paid', 'ar', 1, 'تم تأكيد الطلب {ref}', 'شكرًا لك. استلمنا دفعتك بقيمة {amount}.'),
  ('order.shipped', 'en', 1, 'Your order from {business} is on its way', 'Carrier {carrier}, tracking number {tracking}.'),
  ('order.shipped', 'ar', 1, 'طلبك من {business} في الطريق', 'شركة الشحن {carrier}، رقم التتبع {tracking}.'),
  ('order.delivered', 'en', 1, 'Your order from {business} was delivered', 'We hope you enjoy it. You can now leave a review.'),
  ('order.delivered', 'ar', 1, 'تم توصيل طلبك من {business}', 'نتمنى أن ينال إعجابك. يمكنك الآن كتابة تقييم.'),
  ('order.canceled', 'en', 1, 'Part of order {ref} was canceled', '{business} canceled your items. A refund of {amount} is on its way.'),
  ('order.canceled', 'ar', 1, 'تم إلغاء جزء من الطلب {ref}', 'ألغى {business} منتجاتك. سيصلك استرداد بقيمة {amount}.'),
  ('return.requested', 'en', 1, 'New return request for order {ref}', 'A customer asked to return items worth {amount}.'),
  ('return.requested', 'ar', 1, 'طلب إرجاع جديد للطلب {ref}', 'طلب عميل إرجاع منتجات بقيمة {amount}.'),
  ('return.approved', 'en', 1, 'Your return to {business} was approved', 'Send the items back; the refund follows once they arrive.'),
  ('return.approved', 'ar', 1, 'تمت الموافقة على إرجاعك إلى {business}', 'أرسل المنتجات، وسيصلك الاسترداد بعد وصولها.'),
  ('return.rejected', 'en', 1, 'Your return to {business} was declined', 'Reason: {reason}. Contact support if you disagree.'),
  ('return.rejected', 'ar', 1, 'تم رفض إرجاعك إلى {business}', 'السبب: {reason}. تواصل مع الدعم إذا لم توافق.'),
  ('return.refunded', 'en', 1, 'Your refund of {amount} is complete', 'The money is on its way back to your payment method.'),
  ('return.refunded', 'ar', 1, 'اكتمل استرداد {amount}', 'المبلغ في طريقه إلى وسيلة الدفع الخاصة بك.'),
  ('booking.confirmed', 'en', 1, 'Appointment at {business} confirmed', 'See you on {when}.'),
  ('booking.confirmed', 'ar', 1, 'تم تأكيد موعدك في {business}', 'نراك في {when}.'),
  ('booking.canceled', 'en', 1, 'Appointment at {business} canceled', 'Your appointment on {when} was canceled.'),
  ('booking.canceled', 'ar', 1, 'تم إلغاء موعدك في {business}', 'تم إلغاء موعدك في {when}.'),
  ('booking.rescheduled', 'en', 1, 'Appointment at {business} moved', 'Your appointment is now on {when}.'),
  ('booking.rescheduled', 'ar', 1, 'تم تغيير موعدك في {business}', 'موعدك الآن في {when}.'),
  ('ticket.replied', 'en', 1, 'Support replied: {subject}', 'Open the conversation to read the reply.'),
  ('ticket.replied', 'ar', 1, 'رد الدعم: {subject}', 'افتح المحادثة لقراءة الرد.'),
  ('review.replied', 'en', 1, '{business} replied to your review', 'Open the review to read the reply.'),
  ('review.replied', 'ar', 1, 'رد {business} على تقييمك', 'افتح التقييم لقراءة الرد.');
