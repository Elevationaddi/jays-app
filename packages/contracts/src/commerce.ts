import {
  CART_MAX_QTY,
  MERCHANT_ORDER_STATUSES,
  MOCK_PAYMENT_OUTCOMES,
  ORDER_STATUSES,
  PRODUCT_IMAGES_MAX,
  PRODUCT_REVIEW_ACTIONS,
  PRODUCT_STATUSES,
  STOCK_ADJUST_MAX,
  STOCK_ADJUST_REASONS,
  TAX_CLASSES,
  IMAGE_CONTENT_TYPES,
  IMAGE_MAX_BYTES,
} from '@jays/domain';
import { z } from 'zod';
import { emirateCodeSchema, isoDateTime } from './identity.js';
import { localizedInputSchema } from './onboarding.js';

/**
 * Product catalog, inventory, delivery zones, cart, quote, orders and payments (phase 3,
 * docs/07-api.md, ADR-0013). Money is always integer fils; the server computes every total.
 */

const localized = z.object({ en: z.string(), ar: z.string() });
const fils = z.number().int().min(0);
const positiveFils = z.number().int().min(1).max(100_000_000);
const cursorQuery = {
  cursor: z.string().min(1).max(300).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

export const productStatusSchema = z.enum(PRODUCT_STATUSES);
export const taxClassSchema = z.enum(TAX_CLASSES);
const skuSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, 'letters, digits, dot, dash or underscore');

// ---------------------------------------------------------------------------------------------
// Merchant catalog

export const variantInputSchema = z.strictObject({
  sku: skuSchema,
  name: localizedInputSchema(1, 80),
  priceFils: positiveFils,
  taxClass: taxClassSchema.default('standard'),
  barcode: z
    .string()
    .regex(/^[0-9]{8,14}$/, '8 to 14 digits')
    .nullable()
    .optional(),
  weightGrams: z.number().int().min(1).max(100_000).nullable().optional(),
  lowStockThreshold: z.number().int().min(0).max(100_000).optional(),
});
export type VariantInput = z.infer<typeof variantInputSchema>;

export const updateVariantRequestSchema = z
  .strictObject({
    name: localizedInputSchema(1, 80).optional(),
    priceFils: positiveFils.optional(),
    taxClass: taxClassSchema.optional(),
    barcode: z
      .string()
      .regex(/^[0-9]{8,14}$/, '8 to 14 digits')
      .nullable()
      .optional(),
    weightGrams: z.number().int().min(1).max(100_000).nullable().optional(),
    lowStockThreshold: z.number().int().min(0).max(100_000).optional(),
    status: z.enum(['active', 'archived']).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'nothing to change');
export type UpdateVariantRequest = z.infer<typeof updateVariantRequestSchema>;

const productContent = {
  categoryId: z.uuid(),
  brandId: z.uuid().nullable().optional(),
  title: localizedInputSchema(2, 120),
  description: localizedInputSchema(10, 4000),
  details: localizedInputSchema(1, 2000).nullable().optional(),
  returnEligible: z.boolean().default(true),
  mediaIds: z.array(z.uuid()).max(PRODUCT_IMAGES_MAX).default([]),
};

export const createProductRequestSchema = z.strictObject({
  ...productContent,
  variants: z.array(variantInputSchema).min(1).max(50),
});
export type CreateProductRequest = z.infer<typeof createProductRequestSchema>;

export const updateProductRequestSchema = z
  .strictObject({
    categoryId: productContent.categoryId.optional(),
    brandId: productContent.brandId,
    title: productContent.title.optional(),
    description: productContent.description.optional(),
    details: productContent.details,
    returnEligible: z.boolean().optional(),
    mediaIds: z.array(z.uuid()).max(PRODUCT_IMAGES_MAX).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'nothing to change');
export type UpdateProductRequest = z.infer<typeof updateProductRequestSchema>;

export const productImageUploadRequestSchema = z.strictObject({
  contentType: z.enum(IMAGE_CONTENT_TYPES),
  sizeBytes: z.number().int().min(1).max(IMAGE_MAX_BYTES),
});

export const productImageSchema = z.object({ id: z.uuid(), url: z.url().nullable() });

export const merchantVariantSchema = z.object({
  id: z.uuid(),
  sku: z.string(),
  name: localized,
  priceFils: fils,
  taxClass: taxClassSchema,
  barcode: z.string().nullable(),
  weightGrams: z.number().int().nullable(),
  lowStockThreshold: z.number().int(),
  stockOnHand: z.number().int(),
  stockReserved: z.number().int(),
  stockAvailable: z.number().int(),
  status: z.enum(['active', 'archived']),
});
export type MerchantVariant = z.infer<typeof merchantVariantSchema>;

const contentSchema = z.object({
  categoryId: z.uuid(),
  brandId: z.uuid().nullable(),
  title: localized,
  description: localized,
  details: localized.nullable(),
  returnEligible: z.boolean(),
  images: z.array(productImageSchema),
});

export const merchantProductSchema = z.object({
  id: z.uuid(),
  status: productStatusSchema,
  draft: contentSchema,
  /** What customers see; null until first approved. */
  live: contentSchema.nullable(),
  changesPending: z.boolean(),
  reviewReason: z.string().nullable(),
  suspensionReason: z.string().nullable(),
  submittedAt: isoDateTime.nullable(),
  publishedAt: isoDateTime.nullable(),
  version: z.number().int(),
  variants: z.array(merchantVariantSchema),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type MerchantProduct = z.infer<typeof merchantProductSchema>;

export const merchantProductListItemSchema = z.object({
  id: z.uuid(),
  status: productStatusSchema,
  title: localized,
  changesPending: z.boolean(),
  variantCount: z.number().int(),
  priceFromFils: fils.nullable(),
  stockAvailable: z.number().int(),
  imageUrl: z.url().nullable(),
  updatedAt: isoDateTime,
});
export type MerchantProductListItem = z.infer<typeof merchantProductListItemSchema>;

export const merchantProductListQuerySchema = z.strictObject({
  status: productStatusSchema.optional(),
  q: z.string().trim().min(1).max(100).optional(),
  ...cursorQuery,
});
export type MerchantProductListQuery = z.infer<typeof merchantProductListQuerySchema>;

// ---------------------------------------------------------------------------------------------
// Inventory

export const stockAdjustReasonSchema = z.enum(STOCK_ADJUST_REASONS);
export const stockAdjustRequestSchema = z.strictObject({
  variantId: z.uuid(),
  delta: z
    .number()
    .int()
    .min(-STOCK_ADJUST_MAX)
    .max(STOCK_ADJUST_MAX)
    .refine((n) => n !== 0, 'must not be zero'),
  reason: stockAdjustReasonSchema,
  note: z.string().trim().min(1).max(500).optional(),
});
export type StockAdjustRequest = z.infer<typeof stockAdjustRequestSchema>;

export const inventoryItemSchema = z.object({
  variantId: z.uuid(),
  productId: z.uuid(),
  productTitle: localized,
  productStatus: productStatusSchema,
  variantName: localized,
  sku: z.string(),
  stockOnHand: z.number().int(),
  stockReserved: z.number().int(),
  stockAvailable: z.number().int(),
  lowStockThreshold: z.number().int(),
  lowStock: z.boolean(),
  status: z.enum(['active', 'archived']),
});
export type InventoryItem = z.infer<typeof inventoryItemSchema>;

export const inventoryListQuerySchema = z.strictObject({
  lowStock: z.enum(['true', 'false']).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  ...cursorQuery,
});
export type InventoryListQuery = z.infer<typeof inventoryListQuerySchema>;

export const stockMovementSchema = z.object({
  id: z.uuid(),
  delta: z.number().int(),
  reason: z.enum([...STOCK_ADJUST_REASONS, 'sale']),
  note: z.string().nullable(),
  orderId: z.uuid().nullable(),
  actorType: z.enum(['user', 'admin', 'system']),
  onHandAfter: z.number().int(),
  createdAt: isoDateTime,
});

// ---------------------------------------------------------------------------------------------
// Delivery zones (merchant-defined, ADR-0007 D8)

export const deliveryZoneSchema = z.object({
  emirate: emirateCodeSchema,
  feeFils: fils,
  freeOverFils: fils.nullable(),
  minDays: z.number().int(),
  maxDays: z.number().int(),
});
export type DeliveryZone = z.infer<typeof deliveryZoneSchema>;
export const deliveryZoneListSchema = z.object({ items: z.array(deliveryZoneSchema) });

export const putDeliveryZonesRequestSchema = z.strictObject({
  zones: z
    .array(
      z
        .strictObject({
          emirate: emirateCodeSchema,
          feeFils: z.number().int().min(0).max(100_000_000),
          freeOverFils: positiveFils.nullable().optional(),
          minDays: z.number().int().min(0).max(30),
          maxDays: z.number().int().min(0).max(30),
        })
        .refine((z) => z.maxDays >= z.minDays, {
          message: 'must not be before minDays',
          path: ['maxDays'],
        }),
    )
    .max(7)
    .refine((zones) => new Set(zones.map((z) => z.emirate)).size === zones.length, {
      message: 'one zone per emirate',
    }),
});
export type PutDeliveryZonesRequest = z.infer<typeof putDeliveryZonesRequestSchema>;

// ---------------------------------------------------------------------------------------------
// Public catalog

const storeRef = z.object({ id: z.uuid(), name: localized });
const brandRef = z.object({ id: z.uuid(), name: localized });

export const publicProductListItemSchema = z.object({
  id: z.uuid(),
  title: localized,
  brand: brandRef.nullable(),
  store: storeRef,
  categoryId: z.uuid(),
  imageUrl: z.url().nullable(),
  priceFromFils: fils,
  priceToFils: fils,
  currency: z.literal('AED'),
  inStock: z.boolean(),
  publishedAt: isoDateTime,
});
export type PublicProductListItem = z.infer<typeof publicProductListItemSchema>;

export const publicVariantSchema = z.object({
  id: z.uuid(),
  name: localized,
  sku: z.string(),
  priceFils: fils,
  /** In stock now. No count is promised: stock is only held at checkout. */
  inStock: z.boolean(),
  /** Set when few units remain (at or below the merchant's low-stock threshold). */
  lowStock: z.boolean(),
});

export const publicProductSchema = z.object({
  id: z.uuid(),
  title: localized,
  description: localized,
  details: localized.nullable(),
  brand: brandRef.nullable(),
  store: storeRef,
  categoryId: z.uuid(),
  images: z.array(z.url()),
  returnEligible: z.boolean(),
  currency: z.literal('AED'),
  variants: z.array(publicVariantSchema),
  delivery: z.array(deliveryZoneSchema),
  inStock: z.boolean(),
  publishedAt: isoDateTime,
});
export type PublicProduct = z.infer<typeof publicProductSchema>;

export const productListQuerySchema = z.strictObject({
  q: z.string().trim().min(1).max(100).optional(),
  category: z.uuid().optional(),
  brand: z.uuid().optional(),
  store: z.uuid().optional(),
  minPriceFils: z.coerce.number().int().min(0).optional(),
  maxPriceFils: z.coerce.number().int().min(0).optional(),
  availability: z.enum(['in_stock', 'all']).default('all'),
  sort: z.enum(['newest', 'price_asc', 'price_desc']).default('newest'),
  ...cursorQuery,
});
export type ProductListQuery = z.infer<typeof productListQuerySchema>;

// ---------------------------------------------------------------------------------------------
// Cart

export const cartLineIssueSchema = z.enum([
  'unavailable',
  'out_of_stock',
  'insufficient_stock',
  'price_changed',
]);

export const cartLineSchema = z.object({
  variantId: z.uuid(),
  productId: z.uuid(),
  title: localized,
  variantName: localized,
  imageUrl: z.url().nullable(),
  qty: z.number().int(),
  unitPriceFils: fils,
  priceSeenFils: fils,
  lineTotalFils: fils,
  inStock: z.boolean(),
  issues: z.array(cartLineIssueSchema),
});

export const cartGroupSchema = z.object({
  store: storeRef,
  lines: z.array(cartLineSchema),
  subtotalFils: fils,
});

export const cartSchema = z.object({
  /** Present for a guest cart: keep it and send it as X-Cart-Token; merge it after sign-in. */
  cartToken: z.string().nullable(),
  groups: z.array(cartGroupSchema),
  itemCount: z.number().int(),
  subtotalFils: fils,
  currency: z.literal('AED'),
  /** False while any line is unavailable or short of stock. */
  checkoutReady: z.boolean(),
});
export type CartView = z.infer<typeof cartSchema>;

export const putCartItemRequestSchema = z.strictObject({
  qty: z.number().int().min(1).max(CART_MAX_QTY),
});
export const mergeCartRequestSchema = z.strictObject({
  cartToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'is not a cart token'),
});

// ---------------------------------------------------------------------------------------------
// Quote and orders

export const quoteRequestSchema = z.strictObject({
  addressId: z.uuid(),
});

const pricedLineSchema = z.object({
  variantId: z.uuid(),
  productId: z.uuid(),
  title: localized,
  variantName: localized,
  sku: z.string(),
  qty: z.number().int(),
  unitPriceFils: fils,
  lineTotalFils: fils,
  taxFils: fils,
});

const deliveryInfoSchema = z.object({
  emirate: emirateCodeSchema,
  feeFils: fils,
  minDays: z.number().int(),
  maxDays: z.number().int(),
});

export const quoteGroupSchema = z.object({
  store: storeRef,
  lines: z.array(pricedLineSchema),
  delivery: deliveryInfoSchema,
  subtotalFils: fils,
  deliveryFils: fils,
  discountFils: fils,
  taxFils: fils,
  totalFils: fils,
});

export const totalsSchema = z.object({
  subtotalFils: fils,
  deliveryFils: fils,
  discountFils: fils,
  taxFils: fils,
  totalFils: fils,
  currency: z.literal('AED'),
});

export const quoteSchema = totalsSchema.extend({
  quoteId: z.uuid(),
  expiresAt: isoDateTime,
  groups: z.array(quoteGroupSchema),
});
export type QuoteView = z.infer<typeof quoteSchema>;

export const createOrderRequestSchema = z.strictObject({ quoteId: z.uuid() });

export const orderStatusSchema = z.enum(ORDER_STATUSES);
export const merchantOrderStatusSchema = z.enum(MERCHANT_ORDER_STATUSES);

export const createOrderResponseSchema = z.object({
  orderId: z.uuid(),
  status: orderStatusSchema,
  totalFils: fils,
  currency: z.literal('AED'),
  paymentExpiresAt: isoDateTime,
  /** Client-scoped token for the provider's payment UI. Null once the order is settled. */
  paymentClientSecret: z.string().nullable(),
  paymentIntentId: z.string().nullable(),
});
export type CreateOrderResponse = z.infer<typeof createOrderResponseSchema>;

const addressSnapshotSchema = z.object({
  emirate: emirateCodeSchema,
  area: z.string(),
  street: z.string(),
  building: z.string(),
  unit: z.string().nullable(),
});

export const orderItemSchema = z.object({
  id: z.uuid(),
  productId: z.uuid(),
  variantId: z.uuid(),
  title: localized,
  variantName: localized,
  sku: z.string(),
  qty: z.number().int(),
  unitPriceFils: fils,
  lineTotalFils: fils,
  taxFils: fils,
});

export const orderShipmentGroupSchema = z.object({
  id: z.uuid(),
  store: storeRef,
  status: merchantOrderStatusSchema,
  cancelReason: z.string().nullable(),
  items: z.array(orderItemSchema),
  delivery: deliveryInfoSchema,
  subtotalFils: fils,
  deliveryFils: fils,
  discountFils: fils,
  taxFils: fils,
  totalFils: fils,
});

export const orderSchema = totalsSchema.extend({
  id: z.uuid(),
  status: orderStatusSchema,
  paymentStatus: z.string().nullable(),
  paymentExpiresAt: isoDateTime,
  paymentClientSecret: z.string().nullable(),
  paymentIntentId: z.string().nullable(),
  address: addressSnapshotSchema,
  merchants: z.array(orderShipmentGroupSchema),
  createdAt: isoDateTime,
  paidAt: isoDateTime.nullable(),
});
export type OrderView = z.infer<typeof orderSchema>;

export const orderListItemSchema = z.object({
  id: z.uuid(),
  status: orderStatusSchema,
  totalFils: fils,
  currency: z.literal('AED'),
  itemCount: z.number().int(),
  merchantCount: z.number().int(),
  createdAt: isoDateTime,
});
export const orderListQuerySchema = z.strictObject({ ...cursorQuery });

// Merchant view of a suborder: own items only, minimal customer data.
export const merchantOrderSchema = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  status: merchantOrderStatusSchema,
  cancelReason: z.string().nullable(),
  items: z.array(orderItemSchema),
  delivery: deliveryInfoSchema,
  address: addressSnapshotSchema,
  customerName: z.string().nullable(),
  subtotalFils: fils,
  deliveryFils: fils,
  discountFils: fils,
  taxFils: fils,
  totalFils: fils,
  currency: z.literal('AED'),
  createdAt: isoDateTime,
});
export type MerchantOrderView = z.infer<typeof merchantOrderSchema>;
export const merchantOrderListItemSchema = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  status: merchantOrderStatusSchema,
  itemCount: z.number().int(),
  totalFils: fils,
  currency: z.literal('AED'),
  createdAt: isoDateTime,
});
export const merchantOrderListQuerySchema = z.strictObject({
  status: merchantOrderStatusSchema.optional(),
  ...cursorQuery,
});
export type MerchantOrderListQuery = z.infer<typeof merchantOrderListQuerySchema>;

// ---------------------------------------------------------------------------------------------
// Payments

export const mockPaymentOutcomeSchema = z.enum(MOCK_PAYMENT_OUTCOMES);
export const mockConfirmRequestSchema = z.strictObject({
  clientSecret: z.string().min(1).max(200),
  outcome: mockPaymentOutcomeSchema.default('success'),
});
export const mockConfirmResponseSchema = z.object({
  intentId: z.string(),
  outcome: mockPaymentOutcomeSchema,
  /** Webhooks are delivered asynchronously; the order changes only when one is verified. */
  webhooksQueued: z.number().int(),
});
export const webhookAckSchema = z.object({ received: z.literal(true), duplicate: z.boolean() });

// ---------------------------------------------------------------------------------------------
// Admin listing review

export const productReviewActionSchema = z.enum(PRODUCT_REVIEW_ACTIONS);
export const productActionRequestSchema = z.strictObject({
  action: productReviewActionSchema,
  reason: z.string().trim().min(3).max(1000).optional(),
  expectedVersion: z.number().int().min(1),
});
export type ProductActionRequest = z.infer<typeof productActionRequestSchema>;

export const adminProductListQuerySchema = z.strictObject({
  status: z.enum(['pending', ...PRODUCT_STATUSES, 'all']).default('pending'),
  ...cursorQuery,
});
export type AdminProductListQuery = z.infer<typeof adminProductListQuerySchema>;

export const adminProductListItemSchema = z.object({
  id: z.uuid(),
  business: storeRef,
  status: productStatusSchema,
  title: localized,
  changesPending: z.boolean(),
  submittedAt: isoDateTime.nullable(),
  version: z.number().int(),
  createdAt: isoDateTime,
});

export const adminProductDetailSchema = merchantProductSchema.extend({
  business: storeRef.extend({ status: z.string() }),
  history: z.array(
    z.object({
      id: z.uuid(),
      action: z.string(),
      actorType: z.string(),
      reason: z.string().nullable(),
      createdAt: isoDateTime,
    }),
  ),
});
export type AdminProductDetail = z.infer<typeof adminProductDetailSchema>;
