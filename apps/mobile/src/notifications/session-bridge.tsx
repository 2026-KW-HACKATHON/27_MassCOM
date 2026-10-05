import { useEffect } from 'react';
import { Linking, Platform } from 'react-native';

import { useAuthSession } from '@/auth/auth-provider';
import { publicApiConfig } from '@/config/public-api-runtime';
import { getAppPackageId } from '@/config/app-identity';
import { NotificationApiClient } from './api';
import { getNativeFcmToken, getNotificationDeviceId } from './native';
import { notificationTarget } from './navigation';
import { queueMerchantNotificationRole, queueNotificationTarget } from './pending-target';

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
    void import('expo-notifications').then(async Notifications => {
      if (!active) return;
      Notifications.setNotificationHandler({ handleNotification: async () => ({
        shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false,
      }) });
      tokenSubscription = Notifications.addPushTokenListener(token => {
        if (typeof token.data === 'string') void register(token.data).catch(() => undefined);
      });
      async function openNotification(data: Record<string, unknown> | undefined) {
        if (!data) return;
        const notificationId = data.notificationId;
        if (typeof notificationId !== 'string' || !active) return;
        const items = await client.list();
        const item = items.find(candidate => candidate.id === notificationId);
        const target = notificationTarget(item?.targetPath);
        if (!target || !active) return;
        await client.markRead(notificationId);
        if (!active) return;
        if (target === '/merchant') {
          if (getAppPackageId() === 'kr.masscom.wolgye.demo') queueMerchantNotificationRole(currentAccountId);
          else await Linking.openURL('https://www.masscom.kr/merchant/');
        }
        else queueNotificationTarget(currentAccountId, target);
      }
      responseSubscription = Notifications.addNotificationResponseReceivedListener(response => {
        void openNotification(response.notification.request.content.data).catch(() => undefined);
      });
      const last = await Notifications.getLastNotificationResponseAsync();
      if (last && active) {
        await Notifications.clearLastNotificationResponseAsync();
        void openNotification(last.notification.request.content.data).catch(() => undefined);
      }
    }).catch(() => undefined);
    return () => { active = false; tokenSubscription?.remove(); responseSubscription?.remove(); };
  }, [accountId, apiUrl, sessionToken]);
  return null;
}
