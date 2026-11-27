import { describe, expect, it } from 'vitest';
import {
  canApplyProductAction,
  canEditProduct,
  canSubmitProduct,
  cartLineIssues,
  checkStockAdjustment,
  type DeliveryZoneRule,
  priceOrder,
  PricingError,
  type PricingLine,
} from './commerce.js';
import { extractInclusiveTax, fils } from './money.js';

const rates = { standard: 500, zero_rated: 0, exempt: 0 };
const zone = (feeFils: number, freeOverFils: number | null = null): DeliveryZoneRule => ({
  feeFils,
  freeOverFils,
  minDays: 1,
  maxDays: 3,
});
const line = (over: Partial<PricingLine>): PricingLine => ({
  variantId: '00000000-0000-4000-8000-000000000001',
  productId: '00000000-0000-4000-8000-0000000000aa',
  businessId: 'b1',
  qty: 1,
  unitPriceFils: 10_500,
  taxClass: 'standard',
  ...over,
});

describe('extractInclusiveTax', () => {
  it('extracts 5% VAT from an inclusive amount with explicit rounding', () => {
    expect(extractInclusiveTax(fils(10_500), 500, 'half_up')).toBe(500);
    expect(extractInclusiveTax(fils(100), 500, 'half_up')).toBe(5); // 4.76 -> 5
    expect(extractInclusiveTax(fils(100), 500, 'down')).toBe(4);
    expect(extractInclusiveTax(fils(999), 0, 'half_up')).toBe(0);
  });
});

describe('priceOrder', () => {
  it('splits by merchant, adds delivery per merchant and reconciles to the order total (T05)', () => {
    const priced = priceOrder(
      [
        line({ businessId: 'b2', variantId: 'v3', qty: 2, unitPriceFils: 4_999 }),
        line({ businessId: 'b1', variantId: 'v2', qty: 1, unitPriceFils: 12_000 }),
        line({
          businessId: 'b1',
          variantId: 'v1',
          qty: 3,
          unitPriceFils: 1_050,
          taxClass: 'zero_rated',
        }),
      ],
      new Map([
        ['b1', zone(1_500)],
        ['b2', zone(2_000, 5_000)],
      ]),
      rates,
    );
    expect(priced.groups.map((g) => g.businessId)).toEqual(['b1', 'b2']);
    expect(priced.groups[0]?.lines.map((l) => l.variantId)).toEqual(['v1', 'v2']);
    const [b1, b2] = priced.groups;
    expect(b1?.subtotalFils).toBe(3 * 1_050 + 12_000);
    expect(b1?.deliveryFils).toBe(1_500);
    // b2 subtotal 9998 is over the 5000 free-delivery threshold.
    expect(b2?.deliveryFils).toBe(0);
    for (const g of priced.groups) {
      expect(g.totalFils).toBe(g.subtotalFils + g.deliveryFils - g.discountFils);
      expect(g.taxFils).toBe(g.deliveryTaxFils + g.lines.reduce((s, l) => s + l.taxFils, 0));
    }
    expect(priced.totalFils).toBe(priced.groups.reduce((s, g) => s + g.totalFils, 0));
    expect(priced.taxFils).toBe(priced.groups.reduce((s, g) => s + g.taxFils, 0));
    expect(priced.totalFils).toBe(priced.subtotalFils + priced.deliveryFils);
    // zero-rated line carries no tax
    expect(b1?.lines[0]?.taxFils).toBe(0);
    expect(b1?.lines[1]?.taxFils).toBe(extractInclusiveTax(fils(12_000), 500, 'half_up'));
  });

  it('refuses an empty order, a bad line and a seller without a zone for the address', () => {
    expect(() => priceOrder([], new Map(), rates)).toThrow(PricingError);
    expect(() => priceOrder([line({ qty: 0 })], new Map([['b1', zone(0)]]), rates)).toThrow(
      'INVALID_LINE',
    );
    try {
      priceOrder([line({ businessId: 'b9' })], new Map([['b1', zone(0)]]), rates);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(PricingError);
      expect((error as PricingError).businessIds).toEqual(['b9']);
    }
  });

  it('is deterministic regardless of input order', () => {
    const lines = [
      line({ businessId: 'b2', variantId: 'v9' }),
      line({ businessId: 'b1', variantId: 'v4' }),
    ];
    const zones = new Map([
      ['b1', zone(100)],
      ['b2', zone(100)],
    ]);
    expect(priceOrder(lines, zones, rates)).toEqual(priceOrder([...lines].reverse(), zones, rates));
  });
});

describe('stock adjustments', () => {
  it('never lets stock on hand fall below reserved stock', () => {
    expect(checkStockAdjustment({ onHand: 5, reserved: 3 }, -2, 'correction')).toEqual({
      ok: true,
      onHandAfter: 3,
    });
    expect(checkStockAdjustment({ onHand: 5, reserved: 3 }, -3, 'damaged')).toMatchObject({
      ok: false,
      code: 'INSUFFICIENT_STOCK',
    });
    expect(checkStockAdjustment({ onHand: 0, reserved: 0 }, -1, 'lost')).toMatchObject({
      ok: false,
    });
  });

  it('checks the direction and size of the change against the reason', () => {
    expect(checkStockAdjustment({ onHand: 5, reserved: 0 }, 0, 'correction').ok).toBe(false);
    expect(checkStockAdjustment({ onHand: 5, reserved: 0 }, 2, 'damaged').ok).toBe(false);
    expect(checkStockAdjustment({ onHand: 5, reserved: 0 }, -2, 'restock').ok).toBe(false);
    expect(checkStockAdjustment({ onHand: 5, reserved: 0 }, 100_001, 'restock').ok).toBe(false);
    expect(checkStockAdjustment({ onHand: 5, reserved: 0 }, 1.5, 'restock').ok).toBe(false);
  });
});

describe('listing review rules', () => {
  it('allows each admin action only where it makes sense', () => {
    expect(canApplyProductAction('submitted', false, 'approve')).toBe(true);
    expect(canApplyProductAction('draft', false, 'approve')).toBe(false);
    expect(canApplyProductAction('active', false, 'approve')).toBe(false);
    expect(canApplyProductAction('active', true, 'approve')).toBe(true);
    expect(canApplyProductAction('active', true, 'reject')).toBe(true);
    expect(canApplyProductAction('active', false, 'suspend')).toBe(true);
    expect(canApplyProductAction('suspended', false, 'reinstate')).toBe(true);
    expect(canApplyProductAction('archived', true, 'approve')).toBe(false);
  });

  it('lets merchants edit and submit only in the right states', () => {
    expect(canEditProduct('submitted')).toBe(false);
    expect(canEditProduct('archived')).toBe(false);
    expect(canEditProduct('active')).toBe(true);
    expect(canSubmitProduct('rejected')).toBe(true);
    expect(canSubmitProduct('active')).toBe(false);
  });
});

describe('cart line issues', () => {
  const base = { purchasable: true, qty: 2, available: 5, priceFils: 100, priceSeenFils: 100 };
  it('flags unavailable, out of stock, short stock and price changes', () => {
    expect(cartLineIssues(base)).toEqual([]);
    expect(cartLineIssues({ ...base, purchasable: false })).toEqual(['unavailable']);
    expect(cartLineIssues({ ...base, available: 0 })).toEqual(['out_of_stock']);
    expect(cartLineIssues({ ...base, available: 1 })).toEqual(['insufficient_stock']);
    expect(cartLineIssues({ ...base, priceFils: 120 })).toEqual(['price_changed']);
  });
});
