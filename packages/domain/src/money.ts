/**
 * Money is stored and computed as integer fils (1 AED = 100 fils). Floating point amounts are
 * never accepted. Percentages are basis points (1% = 100 bps). See docs/adr/0005.
 */

export const CURRENCY = 'AED' as const;
export const FILS_PER_AED = 100;

declare const filsBrand: unique symbol;
/** A non-negative integer amount of fils. */
export type Fils = number & { readonly [filsBrand]: true };

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

export function fils(amount: number): Fils {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new MoneyError(`Amount must be a non-negative safe integer of fils, got ${amount}`);
  }
  return amount as Fils;
}

export function addFils(...amounts: Fils[]): Fils {
  return fils(amounts.reduce<number>((sum, amount) => sum + amount, 0));
}

export function subtractFils(from: Fils, amount: Fils): Fils {
  if (amount > from) {
    throw new MoneyError('Result would be negative');
  }
  return fils(from - amount);
}

export function multiplyFils(amount: Fils, quantity: number): Fils {
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new MoneyError(`Quantity must be a non-negative integer, got ${quantity}`);
  }
  return fils(amount * quantity);
}

/**
 * Rounding is a commercial and tax decision that is not yet approved (docs/adr/0007), so callers
 * must state it explicitly. No default is provided on purpose.
 */
export type RoundingMode = 'half_up' | 'half_even' | 'down' | 'up';

/** Returns `amount * bps / 10000` rounded to whole fils using the given mode. */
export function applyBasisPoints(amount: Fils, bps: number, rounding: RoundingMode): Fils {
  if (!Number.isSafeInteger(bps) || bps < 0) {
    throw new MoneyError(`Basis points must be a non-negative integer, got ${bps}`);
  }
  // Integer arithmetic only: quotient and remainder of amount*bps / 10000.
  const numerator = BigInt(amount) * BigInt(bps);
  const denominator = 10_000n;
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  let result = quotient;
  switch (rounding) {
    case 'down':
      break;
    case 'up':
      if (remainder > 0n) result += 1n;
      break;
    case 'half_up':
      if (remainder * 2n >= denominator) result += 1n;
      break;
    case 'half_even':
      if (
        remainder * 2n > denominator ||
        (remainder * 2n === denominator && quotient % 2n === 1n)
      ) {
        result += 1n;
      }
      break;
  }
  return fils(Number(result));
}

/** Formats fils for display. Formatting only; never parse displayed values back into money. */
export function formatAed(amount: Fils, locale: 'en' | 'ar'): string {
  const tag = locale === 'ar' ? 'ar-AE' : 'en-AE';
  return new Intl.NumberFormat(tag, {
    style: 'currency',
    currency: CURRENCY,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount / FILS_PER_AED);
}
