import { StatusBar } from 'expo-status-bar';
import { ApiClientError } from '@jays/api-client';
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { makeApi } from './api';
import { AppContext } from './context';
import { deviceLocale } from './locale';
import { AccountScreen } from './screens/AccountScreen';
import { AuthScreen } from './screens/AuthScreen';
import { ModeHome } from './screens/ModeHome';
import { ResetScreen } from './screens/ResetScreen';
import { VerifyScreen } from './screens/VerifyScreen';
import { WelcomeScreen } from './screens/WelcomeScreen';
import { loadRefreshToken, saveRefreshToken } from './secure-session';
import { initialState, reducer } from './state';

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

  const signOut = useCallback(async () => {
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
      default:
        return <ModeHome />;
    }
  })();

  return (
    <AppContext.Provider value={{ state, dispatch, api, signOut }}>
      {screen}
      <StatusBar style="dark" />
    </AppContext.Provider>
  );
}
