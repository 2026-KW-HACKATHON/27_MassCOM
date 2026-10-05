import { useEffect } from 'react';
import { Linking, Platform } from 'react-native';

import { useAuthSession } from '@/auth/auth-provider';
import { publicApiConfig } from '@/config/public-api-runtime';
import { getAppPackageId } from '@/config/app-identity';
import { NotificationApiClient } from './api';
import { getNativeFcmToken, getNotificationDeviceId } from './native';
import { notificationTarget } from './navigation';
import { queueMerchantNotificationRole, queueNotificationTarget } from './pending-target';
import { clearLastNotificationResponseIfCurrent, notificationResponseIdentity } from './response-identity';

type ExpoNotificationsModule = {
  setNotificationHandler(handler: Record<string, unknown>): void;
  addPushTokenListener(listener: (token: { data?: unknown }) => void): { remove(): void };
  addNotificationResponseReceivedListener(listener: (response: { notification: { request: { content: { data?: Record<string, unknown> } } } }) => void): { remove(): void };
  getLastNotificationResponse?: () => { notification: { request: { content: { data?: Record<string, unknown> } } } } | null;
  clearLastNotificationResponse?: () => void;
};

async function loadNotifications(): Promise<ExpoNotificationsModule> {
  const shared = (globalThis as typeof globalThis & { __masscomSocialPushNotifications?: ExpoNotificationsModule }).__masscomSocialPushNotifications;
  if (shared) return shared;
  return import('expo-notifications') as unknown as Promise<ExpoNotificationsModule>;
}

export function NotificationSessionBridge() {
  const auth = useAuthSession();
  const sessionToken = auth.credential?.kind === 'bearer' ? auth.credential.sessionToken : undefined;
  const accountId = auth.accountId;
  const apiUrl = publicApiConfig.available ? publicApiConfig.apiUrl : undefined;

  useEffect(() => {
    if (!sessionToken || !accountId || !apiUrl || Platform.OS !== 'android') return;
    const currentAccountId = accountId;
    let active = true;
    const client = new NotificationApiClient(apiUrl, { kind: 'bearer', sessionToken });
    async function register(token?: string) {
      if (!active) return;
      const prefs = await client.preferences();
      if (!prefs.pushEnabled || !active) return;
      const deviceId = await getNotificationDeviceId();
      const currentToken = token ?? await getNativeFcmToken(false);
      if (active && deviceId && currentToken) await client.registerDevice(deviceId, currentToken);
    }
    void register().catch(() => undefined); // Foreground/restart retries a transient registration failure.
    let tokenSubscription: { remove(): void } | undefined;
    let responseSubscription: { remove(): void } | undefined;
    void loadNotifications().then(async Notifications => {
      if (!active) return;
      Notifications.setNotificationHandler({ handleNotification: async () => ({
        shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false,
      }) });
      tokenSubscription = Notifications.addPushTokenListener(token => {
        if (typeof token.data === 'string') void register(token.data).catch(() => undefined);
      });
      async function openNotification(data: Record<string, unknown> | undefined): Promise<boolean> {
        if (!data) return false;
        const notificationId = data.notificationId;
        if (typeof notificationId !== 'string' || !active) return false;
        const items = await client.list();
        const item = items.find(candidate => candidate.id === notificationId);
        const target = notificationTarget(item?.targetPath);
        if (!target || !active) return false;
        await client.markRead(notificationId);
        if (!active) return false;
        if (target === '/merchant') {
          if (getAppPackageId() === 'kr.masscom.wolgye.demo') queueMerchantNotificationRole(currentAccountId);
          else await Linking.openURL('https://www.masscom.kr/merchant/');
        }
        else queueNotificationTarget(currentAccountId, target);
        return true;
      }
      responseSubscription = Notifications.addNotificationResponseReceivedListener(response => {
        void openNotification(response.notification.request.content.data).catch(() => undefined);
      });
      const last = typeof Notifications.getLastNotificationResponse === 'function' ? Notifications.getLastNotificationResponse() : null;
      const lastIdentity = notificationResponseIdentity(last, 'notification');
      if (last && lastIdentity && active) {
        const handled = await openNotification(last.notification.request.content.data).catch(() => false);
        if (handled && active) clearLastNotificationResponseIfCurrent(Notifications, lastIdentity);
      }
    }).catch(() => undefined);
    return () => { active = false; tokenSubscription?.remove(); responseSubscription?.remove(); };
  }, [accountId, apiUrl, sessionToken]);
  return null;
}
