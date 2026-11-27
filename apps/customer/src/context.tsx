import type { ApiClient } from '@jays/api-client';
import { type MessageKey, t } from '@jays/i18n';
import { createContext, type Dispatch, useCallback, useContext } from 'react';
import type { Action, AppState } from './state';

export interface AppContextValue {
  state: AppState;
  dispatch: Dispatch<Action>;
  api: ApiClient;
  signOut: () => Promise<void>;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp() {
  const value = useContext(AppContext);
  const locale = value?.state.locale ?? 'en';
  // Stable per locale, so effects that list `tr` as a dependency don't re-run on every render.
  const tr = useCallback(
    (key: MessageKey, params?: Record<string, string | number>) => t(locale, key, params),
    [locale],
  );
  if (!value) throw new Error('AppContext missing');
  const { state } = value;
  return { ...value, tr, rtl: state.locale === 'ar' };
}
