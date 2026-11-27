import type { ApiClient } from '@jays/api-client';
import { type MessageKey, t } from '@jays/i18n';
import { createContext, type Dispatch, useContext } from 'react';
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
  if (!value) throw new Error('AppContext missing');
  const { state } = value;
  const tr = (key: MessageKey, params?: Record<string, string | number>) =>
    t(state.locale, key, params);
  return { ...value, tr, rtl: state.locale === 'ar' };
}
