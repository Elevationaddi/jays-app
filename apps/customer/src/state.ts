import type { Challenge, Me, TokenPair } from '@jays/contracts';
import type { Mode } from '@jays/domain';
import type { Locale } from '@jays/i18n';

/** App route identifiers from docs/02-customer.md that exist so far (phase 2 adds store pages). */
export type Route =
  | '/welcome'
  | '/shop'
  | '/services'
  | '/shop/store'
  | '/services/store'
  | '/services/book'
  | '/appointments'
  | '/appointments/detail'
  | '/shop/product'
  | '/cart'
  | '/checkout'
  | '/orders'
  | '/orders/detail'
  | '/auth'
  | '/auth/verify'
  | '/auth/reset'
  | '/account'
  | '/support'
  | '/support/new'
  | '/support/detail'
  | '/documents/detail'
  | '/notifications'
  | '/privacy'
  | '/unsubscribe';

/** What a new support ticket is about, prefilled from an order or appointment. */
export interface TicketDraft {
  type: 'order' | 'booking' | 'payment' | 'account' | 'other';
  orderId?: string;
  bookingId?: string;
}

export interface AppState {
  locale: Locale;
  emirate: string | null;
  mode: Mode | null;
  route: Route;
  /** Last route visited in each mode, so switching modes never loses your place (or, later, your cart). */
  routeByMode: Record<Mode, Route>;
  /** The store open in each mode, kept like the route so switching modes returns to it. */
  storeByMode: Record<Mode, string | null>;
  session: { user: Me; tokens: TokenPair } | null;
  /** The product open in the shop. */
  productId: string | null;
  /** The order open in /orders/detail. */
  orderId: string | null;
  /** The service being booked in /services/book (at the venue open in services mode). */
  bookServiceId: string | null;
  /** The appointment open in /appointments/detail. */
  bookingId: string | null;
  /** The support ticket open in /support/detail, and the draft for /support/new. */
  ticketId: string | null;
  ticketDraft: TicketDraft;
  /** The invoice or credit note open in /documents/detail, and where its back button goes. */
  documentId: string | null;
  documentBack: Route;
  /** The token from a marketing unsubscribe link opened in the app. */
  unsubscribeToken: string | null;
  /** A guest cart's token, merged into the account cart after sign-in. */
  cartToken: string | null;
  /** Items in the cart, for the tab badge. */
  cartCount: number;
  /** Where to return after sign-in, and the open verification challenge if any. */
  auth: { returnTo: Route; challenge: Challenge | null };
}

export type Action =
  | { type: 'setLocale'; locale: Locale }
  | { type: 'setEmirate'; emirate: string }
  | { type: 'chooseMode'; mode: Mode }
  | { type: 'navigate'; route: Route }
  | { type: 'openStore'; mode: Mode; storeId: string }
  | { type: 'openProduct'; productId: string }
  | { type: 'openOrder'; orderId: string }
  | { type: 'startBooking'; serviceId: string }
  | { type: 'openBooking'; bookingId: string }
  | { type: 'openTicket'; ticketId: string }
  | { type: 'newTicket'; draft: TicketDraft }
  | { type: 'openDocument'; documentId: string; back: Route }
  | { type: 'openUnsubscribe'; token: string }
  | { type: 'cart'; cartToken: string | null; count: number }
  | { type: 'requireSignIn'; returnTo: Route }
  | { type: 'challenge'; challenge: Challenge }
  | { type: 'signedIn'; user: Me; tokens: TokenPair }
  | { type: 'tokens'; tokens: TokenPair }
  | { type: 'profile'; user: Me }
  | { type: 'signedOut' };

const MODE_HOME: Record<Mode, Route> = { shop: '/shop', services: '/services' };

export function initialState(locale: Locale): AppState {
  return {
    locale,
    emirate: null,
    mode: null,
    route: '/welcome',
    routeByMode: { ...MODE_HOME },
    storeByMode: { shop: null, services: null },
    session: null,
    productId: null,
    orderId: null,
    bookServiceId: null,
    bookingId: null,
    ticketId: null,
    ticketDraft: { type: 'other' },
    documentId: null,
    documentBack: '/orders',
    unsubscribeToken: null,
    cartToken: null,
    cartCount: 0,
    auth: { returnTo: '/welcome', challenge: null },
  };
}

/** The token of an unsubscribe link (`…/unsubscribe?token=…`), or null for any other URL. */
export function unsubscribeTokenFrom(url: string): string | null {
  const match = /\/unsubscribe\/?\?(?:.*&)?token=([^&#]+)/.exec(url);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function modeOf(route: Route): Mode | null {
  if (
    route === '/shop' ||
    route === '/shop/store' ||
    route === '/shop/product' ||
    route === '/cart' ||
    route === '/checkout'
  )
    return 'shop';
  if (route === '/services' || route === '/services/store' || route === '/services/book')
    return 'services';
  return null;
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'setLocale':
      return { ...state, locale: action.locale };
    case 'setEmirate':
      return { ...state, emirate: action.emirate };
    case 'chooseMode': {
      // Remember where we are in the current mode, then restore the other mode's last place.
      const routeByMode =
        state.mode && modeOf(state.route) === state.mode
          ? { ...state.routeByMode, [state.mode]: state.route }
          : state.routeByMode;
      return { ...state, mode: action.mode, routeByMode, route: routeByMode[action.mode] };
    }
    case 'navigate': {
      const mode = modeOf(action.route);
      return {
        ...state,
        route: action.route,
        ...(mode ? { mode, routeByMode: { ...state.routeByMode, [mode]: action.route } } : {}),
      };
    }
    case 'openStore': {
      const route: Route = action.mode === 'shop' ? '/shop/store' : '/services/store';
      return {
        ...state,
        mode: action.mode,
        route,
        routeByMode: { ...state.routeByMode, [action.mode]: route },
        storeByMode: { ...state.storeByMode, [action.mode]: action.storeId },
      };
    }
    case 'openProduct':
      return {
        ...state,
        mode: 'shop',
        route: '/shop/product',
        productId: action.productId,
        routeByMode: { ...state.routeByMode, shop: '/shop/product' },
      };
    case 'openOrder':
      return { ...state, route: '/orders/detail', orderId: action.orderId };
    case 'startBooking':
      return {
        ...state,
        mode: 'services',
        route: '/services/book',
        bookServiceId: action.serviceId,
        routeByMode: { ...state.routeByMode, services: '/services/book' },
      };
    case 'openBooking':
      return { ...state, route: '/appointments/detail', bookingId: action.bookingId };
    case 'openTicket':
      return { ...state, route: '/support/detail', ticketId: action.ticketId };
    case 'newTicket':
      return { ...state, route: '/support/new', ticketDraft: action.draft };
    case 'openDocument':
      return {
        ...state,
        route: '/documents/detail',
        documentId: action.documentId,
        documentBack: action.back,
      };
    case 'openUnsubscribe':
      // Works signed out: the link itself identifies the person.
      return { ...state, route: '/unsubscribe', unsubscribeToken: action.token };
    case 'cart':
      return { ...state, cartToken: action.cartToken, cartCount: action.count };
    case 'requireSignIn':
      return { ...state, route: '/auth', auth: { returnTo: action.returnTo, challenge: null } };
    case 'challenge':
      return {
        ...state,
        route: '/auth/verify',
        auth: { ...state.auth, challenge: action.challenge },
      };
    case 'signedIn':
      // Signing in keeps language, emirate, mode and each mode's place; it returns where you were.
      return {
        ...state,
        session: { user: action.user, tokens: action.tokens },
        locale: action.user.locale,
        emirate: action.user.emirate ?? state.emirate,
        route: state.auth.returnTo,
        auth: { returnTo: '/welcome', challenge: null },
      };
    case 'tokens':
      return state.session
        ? { ...state, session: { ...state.session, tokens: action.tokens } }
        : state;
    case 'profile':
      return state.session ? { ...state, session: { ...state.session, user: action.user } } : state;
    case 'signedOut':
      // The account cart stays on the server; the device starts a fresh guest cart.
      return {
        ...state,
        session: null,
        cartToken: null,
        cartCount: 0,
        route: state.mode ? state.routeByMode[state.mode] : '/welcome',
      };
  }
}
