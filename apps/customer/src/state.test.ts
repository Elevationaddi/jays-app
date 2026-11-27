import type { Me, TokenPair } from '@jays/contracts';
import { describe, expect, it } from 'vitest';
import { initialState, reducer, type AppState, type Action } from './state';

const run = (actions: Action[], start: AppState = initialState('en')) =>
  actions.reduce(reducer, start);
const user: Me = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'layla@example.test',
  emailVerified: true,
  phone: null,
  phoneVerified: false,
  status: 'active',
  displayName: 'Layla',
  locale: 'ar',
  emirate: null,
  preferredMode: null,
  marketingConsent: false,
  hasBusinessMembership: false,
  createdAt: '2026-11-27T00:00:00.000Z',
};
const tokens: TokenPair = {
  tokenType: 'Bearer',
  accessToken: 'a',
  accessTokenExpiresAt: '2026-11-27T00:15:00.000Z',
  refreshToken: 'r',
  refreshTokenExpiresAt: '2026-12-27T00:00:00.000Z',
};

describe('customer navigation state', () => {
  it('lets a guest pick either mode from the welcome cards (T01)', () => {
    expect(run([{ type: 'chooseMode', mode: 'shop' }]).route).toBe('/shop');
    expect(run([{ type: 'chooseMode', mode: 'services' }]).route).toBe('/services');
  });

  it("keeps each mode's place when switching back and forth", () => {
    const s = run([
      { type: 'chooseMode', mode: 'shop' },
      { type: 'navigate', route: '/account' },
      { type: 'chooseMode', mode: 'services' },
      { type: 'chooseMode', mode: 'shop' },
    ]);
    expect(s.mode).toBe('shop');
    expect(s.route).toBe('/shop');
  });

  it('returns to where you were after sign-in and keeps your choices (T01)', () => {
    const s = run([
      { type: 'setEmirate', emirate: 'SHJ' },
      { type: 'chooseMode', mode: 'services' },
      { type: 'requireSignIn', returnTo: '/services' },
      { type: 'signedIn', user, tokens },
    ]);
    expect(s.route).toBe('/services');
    expect(s.mode).toBe('services');
    expect(s.emirate).toBe('SHJ');
    expect(s.locale).toBe('ar'); // the account's saved language wins
    expect(s.session?.user.id).toBe(user.id);
  });

  it('keeps the mode after sign-out', () => {
    const s = run([
      { type: 'chooseMode', mode: 'shop' },
      { type: 'signedIn', user, tokens },
      { type: 'navigate', route: '/account' },
      { type: 'signedOut' },
    ]);
    expect(s.session).toBeNull();
    expect(s.route).toBe('/shop');
  });

  it('opens a store inside its mode and returns to it after switching modes', () => {
    const s = run([
      { type: 'chooseMode', mode: 'shop' },
      { type: 'openStore', mode: 'shop', storeId: 'store-1' },
      { type: 'chooseMode', mode: 'services' },
      { type: 'chooseMode', mode: 'shop' },
    ]);
    expect(s.route).toBe('/shop/store');
    expect(s.storeByMode).toEqual({ shop: 'store-1', services: null });
    expect(run([{ type: 'navigate', route: '/shop' }], s).route).toBe('/shop');
  });

  it('keeps the guest cart and your place in the shop when switching modes (T01)', () => {
    const s = run([
      { type: 'chooseMode', mode: 'shop' },
      { type: 'openProduct', productId: 'p-1' },
      { type: 'cart', cartToken: 'guest-token', count: 2 },
      { type: 'chooseMode', mode: 'services' },
      { type: 'chooseMode', mode: 'shop' },
    ]);
    expect(s.route).toBe('/shop/product');
    expect(s.productId).toBe('p-1');
    expect(s.cartToken).toBe('guest-token');
    expect(s.cartCount).toBe(2);
  });

  it('returns to checkout after signing in from the cart', () => {
    const s = run([
      { type: 'chooseMode', mode: 'shop' },
      { type: 'navigate', route: '/cart' },
      { type: 'requireSignIn', returnTo: '/checkout' },
      { type: 'signedIn', user, tokens },
    ]);
    expect(s.route).toBe('/checkout');
    expect(s.mode).toBe('shop');
  });

  it('forgets the guest cart token on sign-out', () => {
    const s = run([
      { type: 'signedIn', user, tokens },
      { type: 'cart', cartToken: null, count: 3 },
      { type: 'signedOut' },
    ]);
    expect(s.cartCount).toBe(0);
    expect(s.cartToken).toBeNull();
  });
});
