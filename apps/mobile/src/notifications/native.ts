import { Platform } from 'react-native';
import { getItemAsync, setItemAsync } from 'expo-secure-store';
import { randomUUID } from 'expo-crypto';
import { NotificationApiClient } from './api';

const deviceIdKey = 'masscom.notifications.device-id.v1';

export async function getNotificationDeviceId(): Promise<string | undefined> {
  if (Platform.OS !== 'android') return undefined;
  const existing = await getItemAsync(deviceIdKey);
  if (existing) return existing;
  const created = randomUUID();
  await setItemAsync(deviceIdKey, created);
  return created;
}

export async function getNativeFcmToken(requestPermission: boolean): Promise<string | undefined> {
  if (Platform.OS !== 'android') return undefined;
  const Device = await import('expo-device');
  if (!Device.isDevice) return undefined;
  const Notifications = await import('expo-notifications');
  await Notifications.setNotificationChannelAsync('masscom-updates', {
    name: '보상·쿠폰·점주 운영', importance: Notifications.AndroidImportance.DEFAULT,
  });
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && requestPermission) permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) return undefined;
  const token = await Notifications.getDevicePushTokenAsync();
  return typeof token.data === 'string' ? token.data : undefined;
}

export async function unregisterCurrentNotificationDevice(apiUrl: string, credential: { kind: 'bearer'; sessionToken: string }): Promise<void> {
  const deviceId = await getNotificationDeviceId();
  if (deviceId) await new NotificationApiClient(apiUrl, credential).unregisterDevice(deviceId);
}
