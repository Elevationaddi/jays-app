import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * The refresh token is kept in the iOS Keychain / Android Keystore via expo-secure-store
 * (docs/09-security-testing.md). On web previews there is no secure store, so it stays in memory
 * only and the user signs in again after a reload.
 */
const KEY = 'jays.refreshToken';
let memory: string | null = null;

export async function saveRefreshToken(token: string | null): Promise<void> {
  if (Platform.OS === 'web') {
    memory = token;
    return;
  }
  if (token)
    await SecureStore.setItemAsync(KEY, token, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  else await SecureStore.deleteItemAsync(KEY);
}

export async function loadRefreshToken(): Promise<string | null> {
  if (Platform.OS === 'web') return memory;
  return SecureStore.getItemAsync(KEY);
}
