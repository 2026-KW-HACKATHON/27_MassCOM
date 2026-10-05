import { createContext, createElement, type PropsWithChildren, use, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import type { AccountCredential } from '@/auth/account-credential';
import { getAppPackageId } from '@/config/app-identity';

import { createSocialApiClient, type AppVariant } from './social-api';
import { canOpenMailForBinding, pushBindingMatchesInput } from './push-runtime-rules';
import { registerPushBindingWithServer, unregisterStoredPushBinding, unregisterStoredPushCleanup } from './push-runtime-coordinator';
import { preparePushBindingRegistration, preparePushBindingRevocation, preparePushCleanupRetries, queuedPushBindingStore, readBinding, retirePushCleanupIntent } from './push-runtime-storage';

type ExpoNotificationsModule = {
  AndroidImportance?: { DEFAULT?: unknown };
  setNotificationChannelAsync?: (id: string, channel: Record<string, unknown>) => Promise<unknown>;
  getPermissionsAsync: () => Promise<{ status?: string; granted?: boolean; canAskAgain?: boolean }>;
  requestPermissionsAsync: () => Promise<{ status?: string; granted?: boolean; canAskAgain?: boolean }>;
  getExpoPushTokenAsync: (options: { projectId?: string; devicePushToken?: unknown }) => Promise<{ data: string }>;
  clearLastNotificationResponseAsync?: () => Promise<unknown>;
  addPushTokenListener?: (listener: (token: unknown) => void) => { remove(): void };
  addNotificationResponseReceivedListener?: (listener: (response: unknown) => void) => { remove(): void };
  getLastNotificationResponseAsync?: () => Promise<unknown>;
  setNotificationHandler?: (handler: Record<string, unknown>) => void;
};

export type SocialPushBindingParams = {
  apiUrl?: string;
  accountId?: string;
  credential?: AccountCredential;
  appVariant?: AppVariant;
  projectId?: string;
  onSessionInvalid?: () => Promise<void>;
  onOpenMail?: (mailId: string) => void;
};

export type SocialPushBindingState = {
  status: 'web-unavailable' | 'signed-out' | 'idle' | 'permission-denied' | 'registered' | 'error';
  canAskPermission: boolean;
  message: string;
};

const mailIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const defaultState: SocialPushBindingState = {
  status: Platform.OS === 'web' ? 'web-unavailable' : 'signed-out',
  canAskPermission: false,
  message: Platform.OS === 'web' ? '웹에서는 앱 푸시를 쓸 수 없어요.' : '로그인하면 알림을 등록할 수 있어요.',
};

type SocialPushContextValue = ReturnType<typeof useSocialPushBinding>;

let socialPushRevocationGeneration = 0;

const SocialPushContext = createContext<SocialPushContextValue | undefined>(undefined);

export function beginSocialPushBindingRevocation(): void {
  socialPushRevocationGeneration += 1;
}

export function SocialPushProvider({ children, ...params }: PropsWithChildren<SocialPushBindingParams>) {
  const value = useSocialPushBinding(params);
  return createElement(SocialPushContext, { value }, children);
}

export function useSocialPush(): SocialPushContextValue {
  return use(SocialPushContext) ?? {
    state: defaultState,
    requestPermissionAndBind: async () => undefined,
  };
}

export function useSocialPushBinding(params: SocialPushBindingParams) {
  const generation = useRef(0);
  const handledResponseKeys = useRef(new Set<string>());
  const paramsRef = useRef(params);
  const [state, setState] = useState<SocialPushBindingState>(defaultState);

  useEffect(() => {
    paramsRef.current = params;
  });

  const appVariant = params.appVariant ?? appVariantForPackage(getAppPackageId());
  const active = Boolean(params.apiUrl && params.accountId && params.credential);
  const api = useMemo(() => params.apiUrl && params.credential
    ? createSocialApiClient({ apiUrl: params.apiUrl, credential: params.credential, onSessionInvalid: params.onSessionInvalid })
    : null, [params.apiUrl, params.credential, params.onSessionInvalid]);

  useEffect(() => {
    generation.current += 1;
    const ticket = generation.current;
    const revocationTicket = socialPushRevocationGeneration;
    let disposed = false;
    let tokenSubscription: { remove(): void } | undefined;
    let responseSubscription: { remove(): void } | undefined;
    async function bindIfAlreadyGranted() {
      if (Platform.OS === 'web') {
        setState({ status: 'web-unavailable', canAskPermission: false, message: '웹에서는 앱 푸시를 쓸 수 없어요.' });
        return;
      }
      if (!active || !api || !params.apiUrl || !params.accountId) {
        setState({ status: 'signed-out', canAskPermission: false, message: '로그인하면 알림을 등록할 수 있어요.' });
        return;
      }
      const Notifications = await loadNotifications();
      if (!Notifications || disposed || generation.current !== ticket) {
        if (!Notifications) setState({ status: 'error', canAskPermission: false, message: '알림 모듈이 아직 준비되지 않았어요.' });
        return;
      }
      installForegroundHandler(Notifications);
      const lastResponse = await Notifications.getLastNotificationResponseAsync?.();
      if (lastResponse && !disposed && generation.current === ticket && socialPushRevocationGeneration === revocationTicket) {
        const opened = await handleNotificationResponse(lastResponse, ticket, revocationTicket);
        if (opened) await Notifications.clearLastNotificationResponseAsync?.();
      }
      responseSubscription = Notifications.addNotificationResponseReceivedListener?.((response) => {
        if (generation.current !== ticket || socialPushRevocationGeneration !== revocationTicket) return;
        void handleNotificationResponse(response, ticket, revocationTicket);
      });
      tokenSubscription = Notifications.addPushTokenListener?.((token) => {
        if (generation.current !== ticket || socialPushRevocationGeneration !== revocationTicket) return;
        void registerNativeToken(token, ticket, revocationTicket);
      });
      const permission = await Notifications.getPermissionsAsync();
      if (disposed || generation.current !== ticket) return;
      if (!permissionGranted(permission)) {
        setState({
          status: 'permission-denied',
          canAskPermission: permission.canAskAgain !== false,
          message: permission.canAskAgain === false ? '기기 설정에서 알림을 켜야 해요.' : '버튼을 눌러 알림을 켤 수 있어요.',
        });
        return;
      }
      await registerCurrentExpoToken(Notifications, ticket, revocationTicket);
    }

    async function handleNotificationResponse(response: unknown, ticket: number, revocationTicket: number): Promise<boolean> {
      if (generation.current !== ticket || socialPushRevocationGeneration !== revocationTicket) return false;
      const latest = paramsRef.current;
      const currentVariant = latest.appVariant ?? appVariantForPackage(getAppPackageId());
      if (!canOpenMailForBinding(await readBinding(), { apiUrl: latest.apiUrl, accountId: latest.accountId, appVariant: currentVariant })) return false;
      const mailId = mailIdFromResponse(response);
      if (!mailId) return false;
      const responseKey = notificationResponseKey(response, mailId);
      if (handledResponseKeys.current.has(responseKey)) return false;
      handledResponseKeys.current.add(responseKey);
      paramsRef.current.onOpenMail?.(mailId);
      return true;
    }

    async function registerNativeToken(nativeToken: unknown, ticket: number, revocationTicket: number) {
      const latest = paramsRef.current;
      if (!latest.apiUrl || !latest.accountId || !latest.credential || generation.current !== ticket || socialPushRevocationGeneration !== revocationTicket) return;
      const Notifications = await loadNotifications();
      if (!Notifications || generation.current !== ticket || socialPushRevocationGeneration !== revocationTicket) return;
      await registerCurrentExpoToken(Notifications, ticket, revocationTicket, nativeToken);
    }

    async function registerCurrentExpoToken(Notifications: ExpoNotificationsModule, ticket: number, revocationTicket: number, devicePushToken?: unknown) {
      const latest = paramsRef.current;
      if (!latest.apiUrl || !latest.accountId || !latest.credential || generation.current !== ticket || socialPushRevocationGeneration !== revocationTicket) return;
      try {
        await ensureAndroidChannel(Notifications);
        const token = (await Notifications.getExpoPushTokenAsync({ projectId: latest.projectId, devicePushToken })).data;
        if (!token || generation.current !== ticket || socialPushRevocationGeneration !== revocationTicket) return;
        const prepared = await preparePushBindingRegistration({ apiUrl: latest.apiUrl, accountId: latest.accountId, token, appVariant: latest.appVariant ?? appVariantForPackage(getAppPackageId()) });
        if (!prepared) {
          setState({ status: 'error', canAskPermission: true, message: '이전 계정의 알림 해제가 끝난 뒤 다시 시도해 주세요.' });
          return;
        }
        const client = createSocialApiClient({ apiUrl: latest.apiUrl, credential: latest.credential, onSessionInvalid: latest.onSessionInvalid });
        await registerPushBindingWithServer({
          candidate: prepared.registering,
          previous: prepared.previous,
          registering: prepared.registering,
          client,
          store: queuedPushBindingStore,
          stillCurrent: () => generation.current === ticket && socialPushRevocationGeneration === revocationTicket,
        });
        if (generation.current === ticket && socialPushRevocationGeneration === revocationTicket) setState({ status: 'registered', canAskPermission: false, message: '이 기기에서 우편 알림을 받을 수 있어요.' });
      } catch {
        if (generation.current === ticket && socialPushRevocationGeneration === revocationTicket) setState({ status: 'error', canAskPermission: true, message: '알림 등록을 마치지 못했어요. 다시 시도해 주세요.' });
      }
    }

    void bindIfAlreadyGranted();
    return () => {
      disposed = true;
      generation.current += 1;
      tokenSubscription?.remove();
      responseSubscription?.remove();
    };
  }, [active, api, appVariant, params.accountId, params.apiUrl, params.projectId]);

  async function requestPermissionAndBind(): Promise<void> {
    const ticket = generation.current;
    const revocationTicket = socialPushRevocationGeneration;
    if (Platform.OS === 'web') {
      setState({ status: 'web-unavailable', canAskPermission: false, message: '웹에서는 앱 푸시를 쓸 수 없어요.' });
      return;
    }
    if (!params.apiUrl || !params.accountId || !params.credential) {
      setState({ status: 'signed-out', canAskPermission: false, message: '로그인하면 알림을 등록할 수 있어요.' });
      return;
    }
    const Notifications = await loadNotifications();
    if (!Notifications) {
      setState({ status: 'error', canAskPermission: false, message: '알림 모듈이 아직 준비되지 않았어요.' });
      return;
    }
    try {
      await ensureAndroidChannel(Notifications);
      const permission = await Notifications.requestPermissionsAsync();
      if (!permissionGranted(permission)) {
        setState({
          status: 'permission-denied',
          canAskPermission: permission.canAskAgain !== false,
          message: permission.canAskAgain === false ? '기기 설정에서 알림을 켜야 해요.' : '알림 권한이 꺼져 있어요.',
        });
        return;
      }
      const token = (await Notifications.getExpoPushTokenAsync({ projectId: params.projectId })).data;
      if (generation.current !== ticket || socialPushRevocationGeneration !== revocationTicket || !token) return;
      const prepared = await preparePushBindingRegistration({ apiUrl: params.apiUrl, accountId: params.accountId, token, appVariant });
      if (!prepared) {
        setState({ status: 'error', canAskPermission: true, message: '이전 계정의 알림 해제가 끝난 뒤 다시 시도해 주세요.' });
        return;
      }
      const client = createSocialApiClient({ apiUrl: params.apiUrl, credential: params.credential, onSessionInvalid: params.onSessionInvalid });
      await registerPushBindingWithServer({
        candidate: prepared.registering,
        previous: prepared.previous,
        registering: prepared.registering,
        client,
        store: queuedPushBindingStore,
        stillCurrent: () => generation.current === ticket && socialPushRevocationGeneration === revocationTicket,
      });
      if (generation.current === ticket && socialPushRevocationGeneration === revocationTicket) setState({ status: 'registered', canAskPermission: false, message: '이 기기에서 우편 알림을 받을 수 있어요.' });
    } catch {
      if (generation.current === ticket && socialPushRevocationGeneration === revocationTicket) setState({ status: 'error', canAskPermission: true, message: '알림 등록을 마치지 못했어요. 다시 시도해 주세요.' });
    }
  }

  return { state, requestPermissionAndBind };
}

export async function revokeSocialPushBindings(input: {
  apiUrl?: string;
  accountId?: string;
  credential?: AccountCredential;
  appVariant?: AppVariant;
}): Promise<void> {
  beginSocialPushBindingRevocation();
  const client = input.apiUrl && input.credential ? createSocialApiClient({ apiUrl: input.apiUrl, credential: input.credential }) : undefined;
  const revoking = await preparePushBindingRevocation({ ...input, matches: pushBindingMatchesInput });
  if (revoking) {
    await unregisterStoredPushBinding({
      binding: revoking,
      client,
      store: queuedPushBindingStore,
    });
  }
  const cleanupRetries = await preparePushCleanupRetries(input);
  for (const cleanup of cleanupRetries) {
    await unregisterStoredPushCleanup({ binding: cleanup, client, retireIfCurrent: retirePushCleanupIntent });
  }
}

export function appVariantForPackage(packageId: string | null | undefined): AppVariant {
  return packageId === 'kr.masscom.wolgye.demo' ? 'SHOWCASE_APP' : 'ANDROID';
}

async function loadNotifications(): Promise<ExpoNotificationsModule | null> {
  if (Platform.OS === 'web') return null;
  const injected = (globalThis as typeof globalThis & { __masscomSocialPushNotifications?: ExpoNotificationsModule }).__masscomSocialPushNotifications;
  if (injected) return injected;
  try {
    return await import('expo-notifications') as unknown as ExpoNotificationsModule;
  } catch {
    return null;
  }
}

function installForegroundHandler(Notifications: ExpoNotificationsModule): void {
  Notifications.setNotificationHandler?.({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

async function ensureAndroidChannel(Notifications: ExpoNotificationsModule): Promise<void> {
  if (Platform.OS !== 'android' || !Notifications.setNotificationChannelAsync) return;
  await Notifications.setNotificationChannelAsync('mail', {
    name: '우편',
    importance: Notifications.AndroidImportance?.DEFAULT ?? 3,
  });
}

function permissionGranted(permission: { status?: string; granted?: boolean }): boolean {
  return permission.granted === true || permission.status === 'granted';
}

function notificationResponseKey(response: unknown, mailId: string): string {
  if (!isRecord(response)) return mailId;
  const notification = isRecord(response.notification) ? response.notification : undefined;
  const request = notification && isRecord(notification.request) ? notification.request : undefined;
  return typeof request?.identifier === 'string' && request.identifier.length > 0 ? request.identifier : mailId;
}

function mailIdFromResponse(response: unknown): string | null {
  if (!isRecord(response)) return null;
  const notification = isRecord(response.notification) ? response.notification : undefined;
  const request = notification && isRecord(notification.request) ? notification.request : undefined;
  const content = request && isRecord(request.content) ? request.content : undefined;
  const data = content && isRecord(content.data) ? content.data : undefined;
  return typeof data?.mailId === 'string' && mailIdPattern.test(data.mailId) ? data.mailId : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
