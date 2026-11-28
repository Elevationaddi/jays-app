import {
  addFils,
  extractInclusiveTax,
  type Fils,
  fils,
  multiplyFils,
  type RoundingMode,
} from './money.js';

/**
 * Product catalog, inventory, cart, quote and order rules (docs/03-business.md, docs/05-workflows.md,
 * ADR-0013). Pure functions: the API applies them inside database transactions.
 */

// ---------------------------------------------------------------------------------------------
// Products and listing review

export const PRODUCT_STATUSES = [
  'draft',
  'submitted',
  'active',
  'rejected',
  'suspended',
  'archived',
] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const TAX_CLASSES = ['standard', 'zero_rated', 'exempt'] as const;
export type TaxClass = (typeof TAX_CLASSES)[number];

/**
 * Admin listing actions. `approve` and `reject` decide a first submission or pending changes to
 * a live listing; `suspend` takes a live listing down and `reinstate` restores it.
 */
export const PRODUCT_REVIEW_ACTIONS = ['approve', 'reject', 'suspend', 'reinstate'] as const;
export type ProductReviewAction = (typeof PRODUCT_REVIEW_ACTIONS)[number];
export const PRODUCT_ACTIONS_REQUIRING_REASON: readonly ProductReviewAction[] = [
  'reject',
  'suspend',
  'reinstate',
];

/** Whether an admin action applies to a product in `status`, with or without pending changes. */
export function canApplyProductAction(
  status: ProductStatus,
  changesPending: boolean,
  action: ProductReviewAction,
): boolean {
  switch (action) {
    case 'approve':
    case 'reject':
      return (
        status === 'submitted' ||
        (changesPending && (status === 'active' || status === 'suspended'))
      );
    case 'suspend':
      return status === 'active';
    case 'reinstate':
      return status === 'suspended';
  }
}

/** The merchant can edit content while the product is not under first review or archived. */
export function canEditProduct(status: ProductStatus): boolean {
  return (
    status === 'draft' || status === 'rejected' || status === 'active' || status === 'suspended'
  );
}

/** A first submission is possible from draft or after a rejection. */
export function canSubmitProduct(status: ProductStatus): boolean {
  return status === 'draft' || status === 'rejected';
}

// ---------------------------------------------------------------------------------------------
// Inventory

/** Reasons a merchant may give for a manual stock adjustment. `sale` is system-only. */
export const STOCK_ADJUST_REASONS = [
  'initial_stock',
  'restock',
  'damaged',
  'lost',
  'correction',
  'return_restock',
] as const;
export type StockAdjustReason = (typeof STOCK_ADJUST_REASONS)[number];

/** Largest single adjustment, to catch typing mistakes (one extra zero). */
export const STOCK_ADJUST_MAX = 100_000;

/** Reasons that can only remove stock, and those that can only add it. */
const REMOVES: readonly StockAdjustReason[] = ['damaged', 'lost'];
const ADDS: readonly StockAdjustReason[] = ['initial_stock', 'restock', 'return_restock'];

export type AdjustCheck =
  | { ok: true; onHandAfter: number }
  | { ok: false; code: 'INVALID_DELTA' | 'INSUFFICIENT_STOCK'; message: string };

/**
 * Checks a manual adjustment against the locked variant row. Stock on hand may never fall below
 * reserved stock (units held for unpaid orders), so available stock never goes negative.
 */
export function checkStockAdjustment(
  current: { onHand: number; reserved: number },
  delta: number,
  reason: StockAdjustReason,
): AdjustCheck {
  if (!Number.isSafeInteger(delta) || delta === 0 || Math.abs(delta) > STOCK_ADJUST_MAX) {
    return {
      ok: false,
      code: 'INVALID_DELTA',
      message: 'The change must be a whole number other than zero.',
    };
  }
  if (REMOVES.includes(reason) && delta > 0) {
    return { ok: false, code: 'INVALID_DELTA', message: 'This reason can only remove stock.' };
  }
  if (ADDS.includes(reason) && delta < 0) {
    return { ok: false, code: 'INVALID_DELTA', message: 'This reason can only add stock.' };
  }
  const onHandAfter = current.onHand + delta;
  if (onHandAfter < current.reserved) {
    return {
      ok: false,
      code: 'INSUFFICIENT_STOCK',
      message: `Only ${current.onHand - current.reserved} units are available to remove; the rest are reserved for unpaid orders.`,
    };
  }
  return { ok: true, onHandAfter };
}

export function availableStock(v: { onHand: number; reserved: number }): number {
  return Math.max(0, v.onHand - v.reserved);
}

// ---------------------------------------------------------------------------------------------
// Cart, quote and order timing

export const CART_MAX_QTY = 99;
export const CART_MAX_LINES = 50;
/** A quote's prices hold for this long; after that the client asks for a new one. */
export const QUOTE_TTL_SECONDS = 15 * 60;
/** Stock is reserved for an unpaid order for this long; then the order expires. */
export const PAYMENT_WINDOW_SECONDS = 15 * 60;
/**
 * Rounding for the VAT contained in prices. Rounding is founder decision D4 (ADR-0007); this is
 * the proposed default and is passed explicitly everywhere (ADR-0005).
 */
export const TAX_ROUNDING: RoundingMode = 'half_up';

export type CartLineIssue = 'unavailable' | 'out_of_stock' | 'insufficient_stock' | 'price_changed';

/** Problems with a cart line that block checkout (price changes only need acknowledging). */
export function cartLineIssues(line: {
  purchasable: boolean;
  qty: number;
  available: number;
  priceFils: number;
  priceSeenFils: number;
}): CartLineIssue[] {
  if (!line.purchasable) return ['unavailable'];
  const issues: CartLineIssue[] = [];
  if (line.available === 0) issues.push('out_of_stock');
  else if (line.qty > line.available) issues.push('insufficient_stock');
  if (line.priceFils !== line.priceSeenFils) issues.push('price_changed');
  return issues;
}

export const BLOCKING_ISSUES: readonly CartLineIssue[] = [
  'unavailable',
  'out_of_stock',
  'insufficient_stock',
];

// ---------------------------------------------------------------------------------------------
// Pricing

export interface PricingLine {
  variantId: string;
  productId: string;
  businessId: string;
  qty: number;
  unitPriceFils: number;
  taxClass: TaxClass;
}

export interface DeliveryZoneRule {
  feeFils: number;
  freeOverFils: number | null;
  minDays: number;
  maxDays: number;
}

export interface PricedLine extends PricingLine {
  lineTotalFils: number;
  taxRateBps: number;
  taxFils: number;
}

export interface PricedGroup {
  businessId: string;
  lines: PricedLine[];
  subtotalFils: number;
  deliveryFils: number;
  deliveryTaxFils: number;
  discountFils: number;
  taxFils: number;
  totalFils: number;
  delivery: DeliveryZoneRule;
}

export interface PricedOrder {
  groups: PricedGroup[];
  subtotalFils: number;
  deliveryFils: number;
  discountFils: number;
  taxFils: number;
  totalFils: number;
}

export class PricingError extends Error {
  constructor(
    readonly code: 'EMPTY' | 'NO_DELIVERY_ZONE' | 'INVALID_LINE',
    readonly businessIds: string[] = [],
  ) {
    super(code);
    this.name = 'PricingError';
  }
}

/**
 * Prices a multi-seller order in integer fils. Prices are VAT-inclusive (ADR-0013): each line's
 * tax is extracted from its line total, delivery is taxed at the standard rate, and every
 * merchant group adds up on its own, so the order total is exactly the sum of its suborders (T05).
 * Groups and lines come out in a stable order (business id, then variant id).
 */
export function priceOrder(
  lines: readonly PricingLine[],
  zones: ReadonlyMap<string, DeliveryZoneRule>,
  taxRates: Readonly<Record<TaxClass, number>>,
  rounding: RoundingMode = TAX_ROUNDING,
  /**
   * D4: businesses registered for VAT. Prices stay VAT-inclusive; a business that is not
   * registered charges no VAT, so its lines and delivery carry none. Omitted: every business.
   */
  vatRegistered?: ReadonlySet<string>,
): PricedOrder {
  if (lines.length === 0) throw new PricingError('EMPTY');
  for (const l of lines) {
    if (
      !Number.isSafeInteger(l.qty) ||
      l.qty <= 0 ||
      !Number.isSafeInteger(l.unitPriceFils) ||
      l.unitPriceFils <= 0
    ) {
      throw new PricingError('INVALID_LINE');
    }
  }
  const byBusiness = new Map<string, PricingLine[]>();
  for (const line of [...lines].sort((a, b) =>
    a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0,
  )) {
    const group = byBusiness.get(line.businessId) ?? [];
    group.push(line);
    byBusiness.set(line.businessId, group);
  }
  const businessIds = [...byBusiness.keys()].sort();
  const missing = businessIds.filter((id) => !zones.has(id));
  if (missing.length > 0) throw new PricingError('NO_DELIVERY_ZONE', missing);

  const groups: PricedGroup[] = businessIds.map((businessId) => {
    const zone = zones.get(businessId) as DeliveryZoneRule;
    const charges = !vatRegistered || vatRegistered.has(businessId);
    const priced: PricedLine[] = (byBusiness.get(businessId) ?? []).map((line) => {
      const lineTotal = multiplyFils(fils(line.unitPriceFils), line.qty);
      const bps = charges ? taxRates[line.taxClass] : 0;
      return {
        ...line,
        lineTotalFils: lineTotal,
        taxRateBps: bps,
        taxFils: extractInclusiveTax(lineTotal, bps, rounding),
      };
    });
    const subtotal = addFils(...priced.map((l) => fils(l.lineTotalFils)));
    const free = zone.freeOverFils !== null && subtotal >= zone.freeOverFils;
    const delivery = fils(free ? 0 : zone.feeFils);
    const deliveryTax = extractInclusiveTax(delivery, charges ? taxRates.standard : 0, rounding);
    const tax = addFils(deliveryTax, ...priced.map((l) => fils(l.taxFils)));
    return {
      businessId,
      lines: priced,
      subtotalFils: subtotal,
      deliveryFils: delivery,
      deliveryTaxFils: deliveryTax,
      discountFils: 0,
      taxFils: tax,
      totalFils: addFils(subtotal, delivery),
      delivery: zone,
    };
  });
  const sum = (pick: (g: PricedGroup) => number): Fils =>
    addFils(...groups.map((g) => fils(pick(g))));
  return {
    groups,
    subtotalFils: sum((g) => g.subtotalFils),
    deliveryFils: sum((g) => g.deliveryFils),
    discountFils: 0,
    taxFils: sum((g) => g.taxFils),
    totalFils: sum((g) => g.totalFils),
  };
}

// ---------------------------------------------------------------------------------------------
// Orders

export const ORDER_STATUSES = [
  'pending_payment',
  'paid',
  'failed',
  'expired',
  'partially_refunded',
  'refunded',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const MERCHANT_ORDER_STATUSES = [
  'pending_payment',
  'paid',
  'processing',
  'shipped',
  'delivered',
  'canceled',
] as const;
export type MerchantOrderStatus = (typeof MERCHANT_ORDER_STATUSES)[number];

/** Mock payment outcomes for local development and tests (ADR-0006). */
export const MOCK_PAYMENT_OUTCOMES = ['success', 'fail', 'timeout', 'duplicate'] as const;
export type MockPaymentOutcome = (typeof MOCK_PAYMENT_OUTCOMES)[number];

/** Idempotency-Key header format (docs/07-api.md). */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
