/**
 * Push notifications on this device (ADR-0039, delivery in ADR-0031).
 *
 * The API sends push through Firebase Cloud Messaging (Spark, no cost). The app's part is:
 * ask for permission only when the person chooses to, register the device's FCM token after
 * sign-in, re-register when the token changes, and unregister on sign-out.
 *
 * Push stays off in a build until EXPO_PUBLIC_PUSH_ENABLED=true, because Android needs the
 * Firebase project's google-services.json (a founder setup step, docs/FOUNDER_SETUP_GUIDE.md).
 * iOS needs the Firebase iOS SDK to turn the APNs token into an FCM token, which is not in the
 * app yet, so iOS reports "unsupported" rather than registering a token the server cannot use.
 * Web push is not offered.
 */
export type PushPermission = 'granted' | 'denied' | 'undetermined' | 'unsupported';

export interface PushSource {
  readonly platform: 'ios' | 'android' | 'web';
  /** False when this build or platform cannot receive FCM push. */
  supported(): boolean;
  permission(): Promise<PushPermission>;
  requestPermission(): Promise<PushPermission>;
  /** The FCM registration token, or null when there is none yet. */
  token(): Promise<string | null>;
  /** Called with the new token when FCM rotates it. Returns an unsubscribe function. */
  onTokenChange(listener: (token: string) => void): () => void;
  /** Called with the notification's in-app link when the person taps it. */
  onOpen(listener: (link: string | null) => void): () => void;
}

export interface PushApi {
  registerPushDevice(body: {
    token: string;
    platform: 'ios' | 'android' | 'web';
  }): Promise<unknown>;
  unregisterPushDevice(token: string): Promise<unknown>;
}

export interface PushSync {
  permission: PushPermission;
  /** The token now registered for this account, if any. */
  token: string | null;
}

/**
 * Brings the device registration in line with the permission. Asks the operating system for
 * permission only when `ask` is true (the person pressed "Allow notifications"); otherwise a
 * device that already allows push is registered silently and nothing is shown.
 */
export async function syncPush(
  api: PushApi,
  source: PushSource,
  options: { ask: boolean },
): Promise<PushSync> {
  if (!source.supported()) return { permission: 'unsupported', token: null };
  let permission = await source.permission();
  if (permission === 'undetermined' && options.ask) permission = await source.requestPermission();
  if (permission !== 'granted') return { permission, token: null };
  const token = await source.token();
  if (!token) return { permission, token: null };
  await api.registerPushDevice({ token, platform: source.platform });
  return { permission, token };
}

/** Stops push to this device for the account that is signing out. Never blocks sign-out. */
export async function stopPush(api: PushApi, token: string | null): Promise<void> {
  if (!token) return;
  await api.unregisterPushDevice(token).catch(() => undefined);
}
