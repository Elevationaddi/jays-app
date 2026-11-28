import type { Challenge, Me, ProductSort, ServiceSort, TokenPair } from '@jays/contracts';
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
  | '/services/search'
  | '/appointments'
  | '/appointments/detail'
  | '/shop/product'
  | '/shop/search'
  | '/wishlist'
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
  | '/legal'
  | '/legal/detail'
  | '/unsubscribe';

/** What a new support ticket is about, prefilled from an order or appointment. */
export interface TicketDraft {
  type: 'order' | 'booking' | 'payment' | 'account' | 'other';
  orderId?: string;
  bookingId?: string;
}

/** Product search filters (phase 8.6). */
export interface SearchFilters {
  q?: string;
  category?: string;
  brand?: string;
  onSale?: boolean;
  inStock?: boolean;
  minRating?: number;
  minPriceFils?: number;
  maxPriceFils?: number;
  sort?: ProductSort;
}

/** Service search filters (phase 8.7). */
export interface ServiceFilters {
  q?: string;
  location?: 'venue' | 'home';
  minRating?: number;
  sort?: ServiceSort;
}

/** What "Book again" or a waitlist link prefills on /services/book. */
export interface BookPrefill {
  branchId?: string;
  staffId?: string | null;
  addonIds?: string[];
  location?: 'venue' | 'home';
  addressId?: string | null;
  date?: string;
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
  /** The filters of /shop/search. */
  search: SearchFilters;
  /** Products opened recently, newest first (this device only). */
  recentProductIds: string[];
  /** Ids of saved products, for the heart buttons; null until loaded or when signed out. */
  wishlist: string[] | null;
  /** The order open in /orders/detail. */
  orderId: string | null;
  /** The service being booked in /services/book (at the venue open in services mode). */
  bookServiceId: string | null;
  bookPrefill: BookPrefill;
  /** The filters of /services/search. */
  serviceSearch: ServiceFilters;
  /** The appointment open in /appointments/detail. */
  bookingId: string | null;
  /** The support ticket open in /support/detail, and the draft for /support/new. */
  ticketId: string | null;
  ticketDraft: TicketDraft;
  /** The invoice or credit note open in /documents/detail, and where its back button goes. */
  documentId: string | null;
  documentBack: Route;
  /** The legal document open in /legal/detail (phase 8.8). */
  legalKind: string | null;
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
  | { type: 'search'; filters: SearchFilters }
  | { type: 'wishlist'; productIds: string[] | null }
  | { type: 'openOrder'; orderId: string }
  | { type: 'startBooking'; serviceId: string }
  | { type: 'openService'; venueId: string; serviceId: string; prefill?: BookPrefill }
  | { type: 'searchServices'; filters: ServiceFilters }
  | { type: 'openBooking'; bookingId: string }
  | { type: 'openTicket'; ticketId: string }
  | { type: 'newTicket'; draft: TicketDraft }
  | { type: 'openDocument'; documentId: string; back: Route }
  | { type: 'openLegal'; kind: string }
  | { type: 'openUnsubscribe'; token: string }
  | { type: 'cart'; cartToken: string | null; count: number }
  | { type: 'requireSignIn'; returnTo: Route }
  | { type: 'challenge'; challenge: Challenge }
  | { type: 'signedIn'; user: Me; tokens: TokenPair }
  | { type: 'tokens'; tokens: TokenPair }
  | { type: 'profile'; user: Me }
  | { type: 'signedOut' };

export const RECENT_MAX = 10;

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
    search: {},
    recentProductIds: [],
    wishlist: null,
    orderId: null,
    bookServiceId: null,
    bookPrefill: {},
    serviceSearch: {},
    bookingId: null,
    ticketId: null,
    ticketDraft: { type: 'other' },
    documentId: null,
    legalKind: null,
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

/** The screen a notification link opens (links are written by the API), or null. */
export function actionForLink(link: string): Action | null {
  const m = /^\/(products|orders|bookings|support)\/([0-9a-f-]{36})$/.exec(link);
  if (m?.[1] && m[2]) {
    const id = m[2];
    switch (m[1]) {
      case 'products':
        return { type: 'openProduct', productId: id };
      case 'orders':
        return { type: 'openOrder', orderId: id };
      case 'bookings':
        return { type: 'openBooking', bookingId: id };
      case 'support':
        return { type: 'openTicket', ticketId: id };
    }
  }
  const venue = /^\/venues\/([0-9a-f-]{36})\/services\/([0-9a-f-]{36})$/.exec(link);
  if (venue?.[1] && venue[2]) {
    return { type: 'openService', venueId: venue[1], serviceId: venue[2] };
  }
  if (link === '/reviews') return { type: 'navigate', route: '/orders' };
  const legal = /^\/legal\/([a-z_]{3,40})$/.exec(link);
  if (legal?.[1]) return { type: 'openLegal', kind: legal[1] };
  if (link === '/legal') return { type: 'navigate', route: '/legal' };
  return null;
}

export function modeOf(route: Route): Mode | null {
  if (
    route === '/shop' ||
    route === '/shop/store' ||
    route === '/shop/product' ||
    route === '/shop/search' ||
    route === '/cart' ||
    route === '/checkout'
  )
    return 'shop';
  if (
    route === '/services' ||
    route === '/services/store' ||
    route === '/services/book' ||
    route === '/services/search'
  )
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
        recentProductIds: [
          action.productId,
          ...state.recentProductIds.filter((id) => id !== action.productId),
        ].slice(0, RECENT_MAX),
      };
    case 'search':
      return {
        ...state,
        mode: 'shop',
        route: '/shop/search',
        search: action.filters,
        routeByMode: { ...state.routeByMode, shop: '/shop/search' },
      };
    case 'wishlist':
      return { ...state, wishlist: action.productIds };
    case 'openOrder':
      return { ...state, route: '/orders/detail', orderId: action.orderId };
    case 'startBooking':
      return {
        ...state,
        mode: 'services',
        route: '/services/book',
        bookServiceId: action.serviceId,
        bookPrefill: {},
        routeByMode: { ...state.routeByMode, services: '/services/book' },
      };
    case 'openService':
      return {
        ...state,
        mode: 'services',
        route: '/services/book',
        bookServiceId: action.serviceId,
        bookPrefill: action.prefill ?? {},
        storeByMode: { ...state.storeByMode, services: action.venueId },
        routeByMode: { ...state.routeByMode, services: '/services/book' },
      };
    case 'searchServices':
      return {
        ...state,
        mode: 'services',
        route: '/services/search',
        serviceSearch: action.filters,
        routeByMode: { ...state.routeByMode, services: '/services/search' },
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
    case 'openLegal':
      return { ...state, route: '/legal/detail', legalKind: action.kind };
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
        wishlist: null,
        route: state.mode ? state.routeByMode[state.mode] : '/welcome',
      };
  }
}
