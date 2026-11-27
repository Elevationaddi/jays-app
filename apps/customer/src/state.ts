import type { Challenge, Me, TokenPair } from '@jays/contracts';
import type { Mode } from '@jays/domain';
import type { Locale } from '@jays/i18n';

/** App route identifiers from docs/02-customer.md that exist in phase 1. */
export type Route =
  '/welcome' | '/shop' | '/services' | '/auth' | '/auth/verify' | '/auth/reset' | '/account';

export interface AppState {
  locale: Locale;
  emirate: string | null;
  mode: Mode | null;
  route: Route;
  /** Last route visited in each mode, so switching modes never loses your place (or, later, your cart). */
  routeByMode: Record<Mode, Route>;
  session: { user: Me; tokens: TokenPair } | null;
  /** Where to return after sign-in, and the open verification challenge if any. */
  auth: { returnTo: Route; challenge: Challenge | null };
}

export type Action =
  | { type: 'setLocale'; locale: Locale }
  | { type: 'setEmirate'; emirate: string }
  | { type: 'chooseMode'; mode: Mode }
  | { type: 'navigate'; route: Route }
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
    session: null,
    auth: { returnTo: '/welcome', challenge: null },
  };
}

function modeOf(route: Route): Mode | null {
  if (route === '/shop') return 'shop';
  if (route === '/services') return 'services';
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
      return {
        ...state,
        session: null,
        route: state.mode ? state.routeByMode[state.mode] : '/welcome',
      };
  }
}
