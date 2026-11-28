import { describe, expect, it } from 'vitest';
import {
  allocateRefund,
  balanced,
  canApproveRefund,
  commissionFor,
  commissionVatFor,
  feeRuleFor,
  FINANCE_SETTING_DEFAULTS,
  LedgerError,
  needsSecondApproval,
  netOf,
  paymentStatusAfterRefunds,
  payoutAmount,
  postings,
  settingAt,
  type FeeRule,
} from './finance.js';

const at = (iso: string) => new Date(iso);
const sum = (lines: { debitFils: number; creditFils: number }[]) => [
  lines.reduce((a, l) => a + l.debitFils, 0),
  lines.reduce((a, l) => a + l.creditFils, 0),
];

describe('fee rules', () => {
  const rules: FeeRule[] = [
    {
      id: 'p1',
      mode: 'shop',
      businessId: null,
      commissionBps: 1000,
      effectiveAt: at('2026-01-01T00:00:00Z'),
    },
    {
      id: 'p2',
      mode: 'shop',
      businessId: null,
      commissionBps: 1200,
      effectiveAt: at('2026-12-01T00:00:00Z'),
    },
    {
      id: 'm1',
      mode: 'shop',
      businessId: 'b1',
      commissionBps: 800,
      effectiveAt: at('2026-06-01T00:00:00Z'),
    },
    {
      id: 's1',
      mode: 'services',
      businessId: null,
      commissionBps: 1500,
      effectiveAt: at('2026-01-01T00:00:00Z'),
    },
  ];

  it('prefers the merchant rule, then the latest platform rule in force', () => {
    expect(feeRuleFor(rules, 'shop', 'b1', at('2026-07-01T00:00:00Z'))?.id).toBe('m1');
    expect(feeRuleFor(rules, 'shop', 'b1', at('2026-05-31T23:59:59Z'))?.id).toBe('p1');
    expect(feeRuleFor(rules, 'shop', 'b2', at('2026-11-30T23:59:59Z'))?.id).toBe('p1');
    expect(feeRuleFor(rules, 'shop', 'b2', at('2026-12-01T00:00:00Z'))?.id).toBe('p2');
    expect(feeRuleFor(rules, 'services', 'b1', at('2026-07-01T00:00:00Z'))?.id).toBe('s1');
  });

  it('has no rule before the first one takes effect', () => {
    expect(feeRuleFor(rules, 'shop', 'b2', at('2025-12-31T00:00:00Z'))).toBeUndefined();
  });

  it('rounds commission half-up', () => {
    expect(commissionFor(10_000, 1000)).toBe(1000);
    expect(commissionFor(105, 1000)).toBe(11); // 10.5 -> 11
    expect(commissionFor(104, 1000)).toBe(10);
    expect(commissionFor(0, 1000)).toBe(0);
  });
});

describe('settings', () => {
  it('uses the row in force, else the default', () => {
    const rows = [
      {
        key: 'payout_dispute_window_days' as const,
        value: 14,
        effectiveAt: at('2026-06-01T00:00:00Z'),
      },
    ];
    expect(settingAt(rows, 'payout_dispute_window_days', at('2026-07-01T00:00:00Z'))).toBe(14);
    expect(settingAt(rows, 'payout_dispute_window_days', at('2026-05-01T00:00:00Z'))).toBe(
      FINANCE_SETTING_DEFAULTS.payout_dispute_window_days,
    );
    expect(settingAt(rows, 'payout_minimum_fils', at('2026-07-01T00:00:00Z'))).toBe(0);
  });
});

describe('refund allocation', () => {
  const e = {
    grossFils: 10_001,
    commissionFils: 1_000,
    refundedFils: 0,
    commissionRefundedFils: 0,
  };

  it('returns commission in proportion and never strands a fils', () => {
    const first = allocateRefund(e, 3_333);
    expect(first.commissionFils).toBe(333); // 333.23 -> 333
    const after = { ...e, refundedFils: 3_333, commissionRefundedFils: 333 };
    const last = allocateRefund(after, 6_668);
    expect(last.commissionFils).toBe(667);
    expect(first.commissionFils + last.commissionFils).toBe(e.commissionFils);
    expect(netOf({ ...after, refundedFils: 10_001, commissionRefundedFils: 1_000 })).toBe(0);
  });

  it('returns no commission on the travel or delivery part (ADR-0027)', () => {
    // 105.00 service (100.00 + VAT, 10.00 commission) + 21.00 travel fee.
    const home = {
      grossFils: 12_600,
      commissionFils: 1_000,
      refundedFils: 0,
      commissionRefundedFils: 0,
      nonCommissionableFils: 2_100,
    };
    const travelOnly = allocateRefund(home, 2_100, { nonCommissionableFils: 2_100 });
    expect(travelOnly).toEqual({
      merchantFils: 2_100,
      commissionFils: 0,
      vatFils: 0,
      nonCommissionableFils: 2_100,
    });
    // Half the service back: half the commission, measured on the service part only.
    expect(allocateRefund(home, 5_250, { nonCommissionableFils: 0 }).commissionFils).toBe(500);
    // Not named: the earning's own mix (1/6 travel), so 1,050 travel and 5,250 service.
    expect(allocateRefund(home, 6_300)).toMatchObject({
      commissionFils: 500,
      nonCommissionableFils: 1_050,
    });
    // A full refund with no named travel part still returns all commission and empties both parts.
    const all = allocateRefund(home, 12_600);
    expect(all.commissionFils).toBe(1_000);
    expect(all.nonCommissionableFils).toBe(2_100);
    // Asking for more travel than is left moves the rest to the commissionable part.
    const after = { ...home, refundedFils: 2_100, nonCommissionableRefundedFils: 2_100 };
    const rest = allocateRefund(after, 10_500, { nonCommissionableFils: 2_100 });
    expect(rest).toMatchObject({ commissionFils: 1_000, nonCommissionableFils: 0 });
  });

  it('refuses refunds above what is left (T09)', () => {
    expect(() => allocateRefund(e, 10_002)).toThrow(/exceeds/);
    expect(() => allocateRefund({ ...e, refundedFils: 10_000 }, 2)).toThrow(/exceeds/);
    expect(() => allocateRefund(e, 0)).toThrow();
  });

  it('computes net after commission and refunds', () => {
    expect(netOf(e)).toBe(9_001);
    expect(netOf({ ...e, refundedFils: 5_000, commissionRefundedFils: 500 })).toBe(4_501);
  });
});

describe('ledger postings', () => {
  it('balance by construction and keep business accounts scoped', () => {
    for (const lines of [
      postings.capture('b1', 10_000, 1_000),
      postings.capture('b1', 10_000, 0),
      postings.lateCapture(500),
      postings.lateRefund(500),
      postings.reversal('b1', { merchantFils: 900, commissionFils: 100 }),
      postings.payoutInitiated('b1', 9_000),
      postings.payoutPaid('b1', 9_000),
      postings.payoutFailed('b1', 9_000),
    ]) {
      const [d, c] = sum(lines);
      expect(d).toBe(c);
      expect(d).toBeGreaterThan(0);
    }
    expect(postings.capture('b1', 10_000, 0)).toHaveLength(2); // zero commission line dropped
  });

  it('refuses unbalanced or malformed postings', () => {
    expect(() =>
      balanced([
        { account: 'psp_clearing', businessId: null, debitFils: 10, creditFils: 0 },
        { account: 'platform_commission', businessId: null, debitFils: 0, creditFils: 9 },
      ]),
    ).toThrow(LedgerError);
    expect(() =>
      balanced([
        { account: 'psp_clearing', businessId: null, debitFils: 10, creditFils: 0 },
        { account: 'merchant_payable', businessId: null, debitFils: 0, creditFils: 10 },
      ]),
    ).toThrow(/business/);
    expect(() =>
      balanced([
        { account: 'psp_clearing', businessId: null, debitFils: 10, creditFils: 10 },
        { account: 'platform_commission', businessId: null, debitFils: 0, creditFils: 0 },
      ]),
    ).toThrow(LedgerError);
  });
});

describe('payouts and approvals', () => {
  it('pays the eligible net capped by the ledger balance and the minimum', () => {
    expect(
      payoutAmount({ eligibleNetFils: 9_000, payableBalanceFils: 20_000, minimumFils: 0 }),
    ).toBe(9_000);
    expect(
      payoutAmount({ eligibleNetFils: 9_000, payableBalanceFils: 4_000, minimumFils: 0 }),
    ).toBe(4_000);
    expect(
      payoutAmount({ eligibleNetFils: 9_000, payableBalanceFils: -100, minimumFils: 0 }),
    ).toBeNull();
    expect(
      payoutAmount({ eligibleNetFils: 9_000, payableBalanceFils: 9_000, minimumFils: 10_000 }),
    ).toBeNull();
    expect(
      payoutAmount({ eligibleNetFils: 0, payableBalanceFils: 9_000, minimumFils: 0 }),
    ).toBeNull();
  });

  it('needs a second, different approver above the threshold (T16)', () => {
    expect(needsSecondApproval(50_000, 50_000)).toBe(false);
    expect(needsSecondApproval(50_001, 50_000)).toBe(true);
    const base = {
      requestedBy: 'a1',
      status: 'pending_approval' as const,
      needsSecondApproval: true,
    };
    expect(canApproveRefund({ ...base, approver: 'a2' })).toEqual({ ok: true });
    expect(canApproveRefund({ ...base, approver: 'a1' })).toEqual({
      ok: false,
      reason: 'SAME_APPROVER',
    });
    expect(canApproveRefund({ ...base, approver: 'a2', status: 'approved' })).toEqual({
      ok: false,
      reason: 'ALREADY_DECIDED',
    });
  });

  it('derives the payment status from its refunds', () => {
    const p = {
      capturedFils: 1000,
      succeededFils: 0,
      pendingCount: 0,
      failedWithoutSuccess: false,
    };
    expect(paymentStatusAfterRefunds({ ...p, pendingCount: 1 })).toBe('refund_pending');
    expect(paymentStatusAfterRefunds({ ...p, succeededFils: 1000 })).toBe('refunded');
    expect(paymentStatusAfterRefunds({ ...p, succeededFils: 400 })).toBe('partially_refunded');
    expect(paymentStatusAfterRefunds({ ...p, failedWithoutSuccess: true })).toBe('refund_failed');
    expect(paymentStatusAfterRefunds(p)).toBe('succeeded');
  });
});

describe('commission by category and VAT on commission (D2, D4)', () => {
  const t0 = at('2026-01-01T00:00:00Z');
  const rules: FeeRule[] = [
    { id: 'platform', mode: 'shop', businessId: null, commissionBps: 1_000, effectiveAt: t0 },
    {
      id: 'beauty',
      mode: 'shop',
      businessId: null,
      categoryId: 'beauty',
      commissionBps: 800,
      effectiveAt: t0,
    },
    { id: 'biz', mode: 'shop', businessId: 'b1', commissionBps: 700, effectiveAt: t0 },
    {
      id: 'biz-skin',
      mode: 'shop',
      businessId: 'b1',
      categoryId: 'skincare',
      commissionBps: 500,
      effectiveAt: t0,
    },
    { id: 'svc', mode: 'services', businessId: null, commissionBps: 1_200, effectiveAt: t0 },
  ];
  const now = at('2026-06-01T00:00:00Z');

  it('picks the most specific rule: business and category, business, category, platform', () => {
    expect(feeRuleFor(rules, 'shop', 'b1', now, ['skincare', 'beauty'])?.id).toBe('biz-skin');
    expect(feeRuleFor(rules, 'shop', 'b1', now, ['makeup', 'beauty'])?.id).toBe('biz');
    expect(feeRuleFor(rules, 'shop', 'b2', now, ['skincare', 'beauty'])?.id).toBe('beauty');
    expect(feeRuleFor(rules, 'shop', 'b2', now, ['fashion'])?.id).toBe('platform');
    expect(feeRuleFor(rules, 'services', 'b1', now, ['skincare'])?.id).toBe('svc');
  });

  it('charges VAT on commission only when the platform is registered', () => {
    expect(commissionVatFor(1_001, 500, false)).toBe(0);
    expect(commissionVatFor(1_001, 500, true)).toBe(50); // 50.05 -> 50
    expect(commissionVatFor(1_010, 500, true)).toBe(51); // 50.5 -> 51 (half-up)
  });

  it('returns commission VAT with refunds and leaves nothing behind', () => {
    const e = {
      grossFils: 10_000,
      commissionFils: 1_000,
      commissionVatFils: 50,
      refundedFils: 0,
      commissionRefundedFils: 0,
      commissionVatRefundedFils: 0,
    };
    expect(netOf(e)).toBe(8_950);
    const first = allocateRefund(e, 3_333);
    expect(first).toEqual({
      merchantFils: 2_983,
      commissionFils: 333,
      vatFils: 17,
      nonCommissionableFils: 0,
    });
    const after = {
      ...e,
      refundedFils: 3_333,
      commissionRefundedFils: 333,
      commissionVatRefundedFils: 17,
    };
    const last = allocateRefund(after, 6_667);
    expect(last.vatFils + first.vatFils).toBe(50);
    expect(
      netOf({
        ...after,
        refundedFils: 10_000,
        commissionRefundedFils: 1_000,
        commissionVatRefundedFils: 50,
      }),
    ).toBe(0);
    const [d, c] = sum(postings.capture('b1', 10_000, 1_000, 50));
    expect(d).toBe(c);
    const [rd, rc] = sum(postings.reversal('b1', first));
    expect(rd).toBe(rc);
  });
});
