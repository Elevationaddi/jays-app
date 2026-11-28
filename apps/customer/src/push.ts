import { Platform } from 'react-native';
import type { PushPermission, PushSource } from './push-sync';

export { stopPush, syncPush, type PushPermission, type PushSource } from './push-sync';

const enabled = () => process.env['EXPO_PUBLIC_PUSH_ENABLED'] === 'true';

type ExpoNotifications = typeof import('expo-notifications');
let loaded: Promise<ExpoNotifications> | null = null;
const notifications = () => (loaded ??= import('expo-notifications'));

const fromStatus = (status: string, canAskAgain = true): PushPermission =>
  status === 'granted'
    ? 'granted'
    : status === 'denied' || !canAskAgain
      ? 'denied'
      : 'undetermined';

/** The device's own push source, through expo-notifications (open source, no service fee). */
export function expoPushSource(): PushSource {
  const platform = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web';
  return {
    platform,
    supported: () => enabled() && platform === 'android',
    async permission() {
      const p = await (await notifications()).getPermissionsAsync();
      return fromStatus(p.status, p.canAskAgain);
    },
    async requestPermission() {
      const p = await (await notifications()).requestPermissionsAsync();
      return fromStatus(p.status, p.canAskAgain);
    },
    async token() {
      const t = await (await notifications()).getDevicePushTokenAsync();
      return typeof t.data === 'string' && t.data ? t.data : null;
    },
    onTokenChange(listener) {
      let sub: { remove(): void } | null = null;
      let stopped = false;
      void notifications().then((n) => {
        if (stopped) return;
        sub = n.addPushTokenListener((t) => {
          if (typeof t.data === 'string' && t.data) listener(t.data);
        });
      });
      return () => {
        stopped = true;
        sub?.remove();
      };
    },
    onOpen(listener) {
      let sub: { remove(): void } | null = null;
      let stopped = false;
      void notifications().then((n) => {
        if (stopped) return;
        sub = n.addNotificationResponseReceivedListener((r) => {
          const link = r.notification.request.content.data?.['link'];
          listener(typeof link === 'string' ? link : null);
        });
      });
      return () => {
        stopped = true;
        sub?.remove();
      };
    },
  };
}
