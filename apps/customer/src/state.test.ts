import type { Me, TokenPair } from '@jays/contracts';
import { describe, expect, it } from 'vitest';
import { initialState, reducer, unsubscribeTokenFrom, type AppState, type Action } from './state';

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
  marketing: { email: false, sms: false, push: false },
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

  it('opens the booking flow in services mode and returns to it after switching modes', () => {
    const s = run([
      { type: 'chooseMode', mode: 'services' },
      { type: 'openStore', mode: 'services', storeId: 'venue-1' },
      { type: 'startBooking', serviceId: 'svc-1' },
      { type: 'chooseMode', mode: 'shop' },
      { type: 'chooseMode', mode: 'services' },
    ]);
    expect(s.route).toBe('/services/book');
    expect(s.bookServiceId).toBe('svc-1');
    expect(s.storeByMode.services).toBe('venue-1');
  });

  it('opens an appointment', () => {
    const s = run([{ type: 'openBooking', bookingId: 'b-1' }]);
    expect(s.route).toBe('/appointments/detail');
    expect(s.bookingId).toBe('b-1');
  });
});

describe('after-sales navigation', () => {
  it('opens a prefilled support ticket from an order and keeps the mode', () => {
    const s = run([
      { type: 'chooseMode', mode: 'shop' },
      { type: 'newTicket', draft: { type: 'order', orderId: 'o-1' } },
    ]);
    expect(s.route).toBe('/support/new');
    expect(s.ticketDraft).toEqual({ type: 'order', orderId: 'o-1' });
    expect(s.mode).toBe('shop');
  });

  it('opens a ticket by id', () => {
    const s = run([{ type: 'openTicket', ticketId: 't-1' }]);
    expect(s).toMatchObject({ route: '/support/detail', ticketId: 't-1' });
  });
});

describe('privacy navigation', () => {
  it('opens an unsubscribe link without signing in', () => {
    const s = run([{ type: 'openUnsubscribe', token: 'abc.def' }]);
    expect(s.route).toBe('/unsubscribe');
    expect(s.unsubscribeToken).toBe('abc.def');
    expect(s.session).toBeNull();
  });

  it('reads the token from an unsubscribe link and ignores other URLs', () => {
    expect(unsubscribeTokenFrom('https://jays.example/unsubscribe?token=abc.d-_')).toBe('abc.d-_');
    expect(unsubscribeTokenFrom('jays://unsubscribe?lang=ar&token=x%2Ey')).toBe('x.y');
    expect(unsubscribeTokenFrom('https://jays.example/shop?token=abc')).toBeNull();
    expect(unsubscribeTokenFrom('https://jays.example/unsubscribe')).toBeNull();
  });
});
