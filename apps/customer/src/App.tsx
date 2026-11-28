import { StatusBar } from 'expo-status-bar';
import { ApiClientError } from '@jays/api-client';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Linking } from 'react-native';
import { makeApi } from './api';
import { AppContext } from './context';
import { deviceLocale } from './locale';
import { expoPushSource, type PushPermission, stopPush, syncPush } from './push';
import { AccountScreen } from './screens/AccountScreen';
import { AppointmentScreen, AppointmentsScreen } from './screens/AppointmentsScreen';
import { AuthScreen } from './screens/AuthScreen';
import { BookScreen } from './screens/BookScreen';
import { CartScreen } from './screens/CartScreen';
import { CheckoutScreen } from './screens/CheckoutScreen';
import { ModeHome } from './screens/ModeHome';
import { DocumentScreen } from './screens/DocumentScreen';
import { NotificationsScreen } from './screens/NotificationsScreen';
import { OrderScreen, OrdersScreen } from './screens/OrdersScreen';
import { LegalDocumentScreen, LegalScreen } from './screens/LegalScreens';
import { PrivacyScreen, UnsubscribeScreen } from './screens/PrivacyScreens';
import { ProductScreen } from './screens/ProductScreen';
import { ResetScreen } from './screens/ResetScreen';
import { SearchScreen } from './screens/SearchScreen';
import { ServiceSearchScreen } from './screens/ServiceSearchScreen';
import { StoreScreen } from './screens/StoreScreen';
import { NewTicketScreen, SupportScreen, TicketScreen } from './screens/SupportScreens';
import { VerifyScreen } from './screens/VerifyScreen';
import { WelcomeScreen } from './screens/WelcomeScreen';
import { WishlistScreen } from './screens/WishlistScreen';
import { loadRefreshToken, saveRefreshToken } from './secure-session';
import { actionForLink, initialState, reducer, unsubscribeTokenFrom } from './state';

export function App() {
  const [state, dispatch] = useReducer(
    reducer,
    deviceLocale([Intl.DateTimeFormat().resolvedOptions().locale]),
    initialState,
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const api = useMemo(
    () =>
      makeApi(
        () => stateRef.current.session?.tokens.accessToken,
        () => stateRef.current.locale,
      ),
    [],
  );

  // Restore a saved session once on start. A refresh token works only once, so nothing else refreshes concurrently.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const refresh = await loadRefreshToken();
      if (!refresh) return;
      try {
        const tokens = await api.refresh(refresh);
        await saveRefreshToken(tokens.refreshToken);
        const authed = makeApi(
          () => tokens.accessToken,
          () => stateRef.current.locale,
        );
        const user = await authed.me();
        if (!cancelled) dispatch({ type: 'signedIn', user, tokens });
      } catch (error) {
        // Only forget the saved session when the API rejects it; offline starts keep it for next time.
        if (error instanceof ApiClientError && error.status === 401) await saveRefreshToken(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  // A marketing unsubscribe link (…/unsubscribe?token=…) opens its screen, signed in or not.
  useEffect(() => {
    void Linking.getInitialURL()
      .then((url) => {
        const token = url ? unsubscribeTokenFrom(url) : null;
        if (token) dispatch({ type: 'openUnsubscribe', token });
      })
      .catch(() => undefined);
  }, []);

  // After sign-in, move the guest cart into the account cart (quantities add, capped at stock).
  const signedInUser = state.session?.user.id;
  useEffect(() => {
    const token = stateRef.current.cartToken;
    if (!signedInUser || !token) return;
    api
      .mergeCart(token)
      .then((cart) => dispatch({ type: 'cart', cartToken: null, count: cart.itemCount }))
      .catch(() => dispatch({ type: 'cart', cartToken: null, count: 0 }));
  }, [api, signedInUser]);

  // Saved product ids for the hearts on product cards.
  useEffect(() => {
    if (!signedInUser) return;
    api
      .wishlist()
      .then((w) => dispatch({ type: 'wishlist', productIds: w.items.map((i) => i.productId) }))
      .catch(() => undefined);
  }, [api, signedInUser]);

  // Push (ADR-0039): register silently after sign-in if the device already allows it, follow
  // token changes, and open a tapped notification's link. Permission is asked only from a button.
  const pushSource = useMemo(() => expoPushSource(), []);
  const pushToken = useRef<string | null>(null);
  const [pushPermission, setPushPermission] = useState<PushPermission | null>(null);
  const runPushSync = useCallback(
    async (ask: boolean) => {
      try {
        const r = await syncPush(api, pushSource, { ask });
        pushToken.current = r.token;
        setPushPermission(r.permission);
      } catch {
        // Offline or the API refused: try again on the next sign-in or token change.
      }
    },
    [api, pushSource],
  );
  useEffect(() => {
    if (!signedInUser) return;
    void runPushSync(false);
    const stopTokens = pushSource.onTokenChange(() => void runPushSync(false));
    return stopTokens;
  }, [signedInUser, pushSource, runPushSync]);
  useEffect(
    () =>
      pushSource.onOpen((link) => {
        const action = link ? actionForLink(link) : null;
        dispatch(action ?? { type: 'navigate', route: '/notifications' });
      }),
    [pushSource],
  );
  const enablePush = useCallback(() => runPushSync(true), [runPushSync]);

  const signOut = useCallback(async () => {
    await stopPush(api, pushToken.current);
    pushToken.current = null;
    const refresh = stateRef.current.session?.tokens.refreshToken;
    if (refresh) await api.logout(refresh).catch(() => undefined);
    await saveRefreshToken(null);
    dispatch({ type: 'signedOut' });
  }, [api]);

  const screen = (() => {
    switch (state.route) {
      case '/welcome':
        return <WelcomeScreen />;
      case '/auth':
        return <AuthScreen />;
      case '/auth/verify':
        return <VerifyScreen />;
      case '/auth/reset':
        return <ResetScreen />;
      case '/account':
        return <AccountScreen />;
      case '/shop/product':
        return <ProductScreen />;
      case '/shop/search':
        return <SearchScreen />;
      case '/services/search':
        return <ServiceSearchScreen />;
      case '/wishlist':
        return <WishlistScreen />;
      case '/cart':
        return <CartScreen />;
      case '/checkout':
        return <CheckoutScreen />;
      case '/orders':
        return <OrdersScreen />;
      case '/orders/detail':
        return <OrderScreen />;
      case '/services/book':
        return <BookScreen />;
      case '/appointments':
        return <AppointmentsScreen />;
      case '/appointments/detail':
        return <AppointmentScreen />;
      case '/support':
        return <SupportScreen />;
      case '/support/new':
        return <NewTicketScreen />;
      case '/support/detail':
        return <TicketScreen />;
      case '/documents/detail':
        return <DocumentScreen />;
      case '/notifications':
        return <NotificationsScreen />;
      case '/privacy':
        return <PrivacyScreen />;
      case '/legal':
        return <LegalScreen />;
      case '/legal/detail':
        return <LegalDocumentScreen />;
      case '/unsubscribe':
        return <UnsubscribeScreen />;
      case '/shop/store':
      case '/services/store':
        return <StoreScreen />;
      default:
        return <ModeHome />;
    }
  })();

  return (
    <AppContext.Provider
      value={{
        state,
        dispatch,
        api,
        signOut,
        push: { permission: pushPermission, enable: enablePush },
      }}
    >
      {screen}
      <StatusBar style="dark" />
    </AppContext.Provider>
  );
}
