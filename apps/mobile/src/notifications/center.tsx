import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, Switch, Text, View, useColorScheme } from 'react-native';
import { useRouter } from 'expo-router';

import type { AccountCredential } from '@/auth/account-credential';
import { colorsForScheme } from '@/theme/palette';
import { NotificationApiClient, type NotificationItem, type NotificationPreferences } from './api';
import { getNativeFcmToken, getNotificationDeviceId } from './native';
import { notificationTarget, type NotificationTarget } from './navigation';

const descriptions = [
  { key: 'rewardAvailable', title: '받을 수 있는 방문 보상', detail: '방문 목표를 채운 뒤 보상을 받을 수 있을 때' },
  { key: 'couponExpiring', title: '쿠폰 만료', detail: '미사용 쿠폰이 24시간 안에 만료될 때' },
  { key: 'campaignExpiring', title: '점주 캠페인 만료', detail: '운영 중인 캠페인이 3일 안에 끝날 때' },
] as const;

export function NotificationCenter({ apiUrl, credential, onSessionInvalid, onMerchantTarget, onCustomerTarget }: { apiUrl: string; credential: AccountCredential; onSessionInvalid?: () => void | Promise<void>; onMerchantTarget?: () => void; onCustomerTarget?: (target: NotificationTarget) => void }) {
  const router = useRouter();
  const palette = colorsForScheme(useColorScheme());
  const client = useMemo(() => new NotificationApiClient(apiUrl, credential, onSessionInvalid), [apiUrl, credential, onSessionInvalid]);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [prefs, setPrefs] = useState<NotificationPreferences>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [deviceMessage, setDeviceMessage] = useState<string>();
  const load = useCallback(async (isCurrent: () => boolean = () => true, retry = false) => {
    if (retry) { setLoading(true); setError(undefined); }
    try {
      const [nextItems, nextPrefs] = await Promise.all([client.list(), client.preferences()]);
      if (isCurrent()) { setItems(nextItems); setPrefs(nextPrefs); setError(undefined); }
    } catch {
      if (isCurrent()) setError('알림을 불러오지 못했습니다. 다시 시도해 주세요.');
    } finally { if (isCurrent()) setLoading(false); }
  }, [client]);
  useEffect(() => {
    let current = true;
    void Promise.resolve().then(() => { if (current) return load(() => current); });
    return () => { current = false; };
  }, [load]);

  async function update(patch: Partial<NotificationPreferences>) {
    if (busy) return;
    setBusy(true); setError(undefined);
    try {
      const next = await client.updatePreferences(patch);
      setPrefs(next);
      if ('pushEnabled' in patch) {
        if (next.pushEnabled && credential.kind === 'bearer') {
          const [deviceId, token] = await Promise.all([getNotificationDeviceId(), getNativeFcmToken(true)]);
          if (deviceId && token) { await client.registerDevice(deviceId, token); setDeviceMessage('이 기기에서 푸시 알림을 받을 수 있습니다.'); }
          else setDeviceMessage('이 기기에서는 푸시를 켤 수 없습니다. 알림함은 계속 사용할 수 있습니다.');
        } else {
          const deviceId = await getNotificationDeviceId();
          if (deviceId) await client.unregisterDevice(deviceId);
          setDeviceMessage('이 기기 푸시가 꺼졌습니다.');
        }
      }
    } catch { setError('설정을 저장하거나 기기를 등록하지 못했습니다. 다시 시도해 주세요.'); }
    finally { setBusy(false); }
  }

  async function openNotification(item: NotificationItem) {
    const target = notificationTarget(item.targetPath);
    if (!target) { setError('열 수 없는 알림 링크입니다.'); return; }
    try {
      await client.markRead(item.id);
      setItems(previous => previous.map(entry => entry.id === item.id ? { ...entry, readAt: new Date().toISOString() } : entry));
    } catch { setError('읽음 상태를 저장하지 못했습니다. 다시 시도해 주세요.'); return; }
    if (target === '/merchant') {
      if (onMerchantTarget) onMerchantTarget();
      else await Linking.openURL('https://www.masscom.kr/merchant/').catch(() => setError('점주 운영 화면을 열지 못했습니다. 다시 시도해 주세요.'));
    } else if (onCustomerTarget) onCustomerTarget(target);
    else router.push(target as never);
  }

  return <ScrollView contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 48 }}>
    <Text style={{ color: palette.label, fontSize: 25, fontWeight: '700' }}>알림함</Text>
    <Text style={{ color: palette.secondaryLabel, lineHeight: 21 }}>방문 보상, 쿠폰 만료, 점주 운영 소식을 한곳에서 확인해요. 휴대폰 알림 권한이 없어도 이 알림함은 사용할 수 있습니다.</Text>
    {error ? <Pressable accessibilityRole="button" onPress={() => void load(() => true, true)}><Text style={{ color: palette.primary }}>{error} 다시 불러오기</Text></Pressable> : null}
    {loading ? <ActivityIndicator /> : prefs ? <View style={{ gap: 14 }}>
      <View style={{ padding: 16, borderRadius: 16, backgroundColor: palette.surface, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ color: palette.label, fontSize: 17, fontWeight: '700' }}>휴대폰 푸시 알림 받기</Text>
          <Switch accessibilityLabel="휴대폰 푸시 알림 받기" value={prefs.pushEnabled} disabled={busy || credential.kind !== 'bearer'} onValueChange={value => void update({ pushEnabled: value })} />
        </View>
        <Text style={{ color: palette.secondaryLabel }}>선택하면 Android 기기 권한을 요청하고 이 로그인 세션에 기기를 연결합니다.</Text>
        {credential.kind !== 'bearer' ? <Text style={{ color: palette.secondaryLabel }}>체험 계정은 푸시 대신 앱 안의 알림함을 사용합니다.</Text> : null}
        {deviceMessage ? <Text style={{ color: palette.secondaryLabel }}>{deviceMessage}</Text> : null}
      </View>
      <Text style={{ color: palette.secondaryLabel }}>아래 항목은 휴대폰 푸시 종류를 고릅니다. 앱 안 알림함에는 모두 남습니다.</Text>
      {descriptions.map(({ key, title, detail }) => <View key={key} style={{ padding: 16, borderRadius: 16, backgroundColor: palette.surface, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1 }}><Text style={{ color: palette.label, fontWeight: '600' }}>{title}</Text><Text style={{ color: palette.secondaryLabel }}>{detail}</Text></View>
        <Switch accessibilityLabel={title} value={prefs[key]} disabled={busy} onValueChange={value => void update({ [key]: value })} />
      </View>)}
    </View> : null}
    <Text style={{ color: palette.label, fontSize: 19, fontWeight: '700', marginTop: 8 }}>최근 알림</Text>
    {!loading && !error && items.length === 0 ? <Text style={{ color: palette.secondaryLabel }}>아직 알림이 없습니다.</Text> : !loading && !error ? items.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${item.readAt ? '' : '새 알림, '}${item.title}`} onPress={() => void openNotification(item)} style={{ padding: 16, borderRadius: 16, backgroundColor: palette.surface, gap: 5 }}>
      <Text style={{ color: palette.label, fontWeight: item.readAt ? '500' : '700' }}>{item.title}</Text>
      <Text style={{ color: palette.secondaryLabel }}>{item.body}</Text>
      <Text style={{ color: palette.secondaryLabel, fontSize: 12 }}>{new Date(item.createdAt).toLocaleString('ko-KR')}</Text>
    </Pressable>) : null}
  </ScrollView>;
}
