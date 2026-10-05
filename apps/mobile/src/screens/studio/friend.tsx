import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View, useColorScheme, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AccountCredential } from '@/auth/account-credential';
import { createExperienceApiClient, type DisplayExperienceProfile } from '@/experience/experience-api';
import { consentRequiredMessage, consentRecheckLabel, needsConsentRecheck } from '@/privacy/consent-flow';
import { useConsentRecheck } from '@/privacy/consent-recheck';
import { createStudioApiClient, type FriendStudioSnapshot, type StudioApiError } from '@/studio/studio-api';
import { StudioScene } from '@/studio/studio-scene';
import { colorsForScheme } from '@/theme/palette';
import { BackHeader } from '@/ui/back-header';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';
import { StateScene } from '@/ui/state-scene';

export function FriendStudioScreen({ apiUrl, credential, onSessionInvalid, friendshipId }: {
  apiUrl: string; credential: AccountCredential; onSessionInvalid: () => Promise<void>; friendshipId: string;
}) {
  const router = useRouter();
  const recheckConsent = useConsentRecheck();
  const insets = useSafeAreaInsets();
  const palette = colorsForScheme(useColorScheme());
  const { width } = useWindowDimensions();
  const sceneWidth = Math.min(Math.max(width - 28, 280), 460);
  const client = useMemo(() => createStudioApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const experienceClient = useMemo(() => createExperienceApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const [snapshot, setSnapshot] = useState<FriendStudioSnapshot>();
  const [friendExperience, setFriendExperience] = useState<DisplayExperienceProfile>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const [errorNeedsConsent, setErrorNeedsConsent] = useState(false);
  const [goalSaving, setGoalSaving] = useState<string>();
  const [goalNotice, setGoalNotice] = useState<string>();
  const active = useRef(false);
  const generation = useRef(0);
  const load = useCallback(async (refresh = false) => {
    const request = ++generation.current;
    if (refresh) setRefreshing(true); else setLoading(true);
    setError(undefined);
    setErrorNeedsConsent(false);
    try {
      const [result, display] = await Promise.all([
        client.getFriend(friendshipId),
        experienceClient.getFriend(friendshipId).catch(() => undefined),
      ]);
      if (active.current && generation.current === request) { setSnapshot(result); setFriendExperience(display); }
    } catch (caught) {
      if (active.current && generation.current === request) {
        const apiError = caught as StudioApiError;
        setSnapshot(undefined); setFriendExperience(undefined);
        const consentRequired = needsConsentRecheck(caught);
        setErrorNeedsConsent(consentRequired);
        setError(consentRequired ? consentRequiredMessage : apiError.status === 404 || apiError.status === 403 ? '친구 관계가 끝났거나 볼 수 없는 공간이에요.' : '친구 공간을 불러오지 못했어요.');
      }
    } finally {
      if (active.current && generation.current === request) { setLoading(false); setRefreshing(false); }
    }
  }, [client, experienceClient, friendshipId]);
  useFocusEffect(useCallback(() => {
    active.current = true; setGoalSaving(undefined); void load();
    return () => { active.current = false; generation.current += 1; };
  }, [load]));
  const saveVisitGoal = async (merchantId: string, merchantName: string) => {
    if (goalSaving) return;
    setGoalSaving(merchantId); setGoalNotice(undefined);
    try {
      const mine = await client.getMine();
      await client.save({ ...mine.studio, goal: { kind: 'discover', merchantId } });
      if (active.current) setGoalNotice(`${merchantName} 방문을 다음 목표로 저장했어요.`);
    } catch {
      if (active.current) setGoalNotice('방문 목표를 저장하지 못했어요. 다시 시도해 주세요.');
    } finally { if (active.current) setGoalSaving(undefined); }
  };
  const header = <BackHeader title="친구 공간" />;
  return <SkyBackdrop><SkyScrollView header={header} contentContainerStyle={styles.content}
    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} progressViewOffset={insets.top} />}>
    {loading && !snapshot ? <StateScene kind="loading" title="친구 공간을 여는 중" /> : null}
    {!snapshot && !loading ? <StateScene kind="error" title="친구 공간을 볼 수 없어요" body={error}
      action={{ label: errorNeedsConsent ? consentRecheckLabel : '다시 시도', onPress: errorNeedsConsent ? recheckConsent : () => void load() }} /> : null}
    {snapshot ? <>
      <Text accessibilityRole="header" style={[styles.title, { color: palette.label }]} numberOfLines={2}>{snapshot.nickname}의 공간</Text>
      <View style={styles.sceneFrame}>
        <StudioScene studio={snapshot.studio} items={snapshot.items} avatar={snapshot.avatar} apiUrl={apiUrl}
          experienceProfile={friendExperience} badgeName={friendExperience?.badgeName ?? undefined}
          width={sceneWidth} height={Math.round(sceneWidth * 0.92)}
          onItemPress={(item) => router.push({ pathname: '/merchants/[merchantId]', params: { merchantId: item.merchantId } })} />
      </View>
      <Text style={[styles.count, { color: palette.secondaryLabel }]}>진열된 수집품 {snapshot.items.length}개</Text>
      {goalNotice ? <Text accessibilityRole="alert" style={[styles.count, { color: palette.primary }]}>{goalNotice}</Text> : null}
      {snapshot.items.map((item, index) => <Pressable key={`${item.merchantId}:${index}`} accessibilityRole="button"
        onPress={() => router.push({ pathname: '/merchants/[merchantId]', params: { merchantId: item.merchantId } })}
        style={styles.row}>
        <View style={styles.rowText}><Text numberOfLines={1} style={styles.name}>{item.displayName}</Text>
          <Text numberOfLines={1} style={styles.merchant}>{item.merchantName}</Text></View>
        <Text style={styles.arrow}>›</Text>
      </Pressable>)}
      {snapshot.items.filter((item, index, items) => items.findIndex((candidate) => candidate.merchantId === item.merchantId) === index).map((item) => <Pressable key={`goal:${item.merchantId}`} accessibilityRole="button"
        disabled={Boolean(goalSaving)} onPress={() => void saveVisitGoal(item.merchantId, item.merchantName)} style={styles.goal}>
        <Text style={styles.goalText}>{goalSaving === item.merchantId ? '저장 중…' : `${item.merchantName} 방문 목표로 저장`}</Text>
      </Pressable>)}
      {!snapshot.items.length ? <Text style={[styles.empty, { color: palette.secondaryLabel }]}>아직 진열한 수집품이 없어요.</Text> : null}
      {snapshot.studio.goal?.merchantId ? <Pressable accessibilityRole="button" style={styles.goal}
        onPress={() => router.push({ pathname: '/merchants/[merchantId]', params: { merchantId: snapshot.studio.goal!.merchantId! } })}>
        <Text style={styles.goalText}>친구의 다음 가게 보기</Text>
      </Pressable> : null}
    </> : null}
  </SkyScrollView></SkyBackdrop>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 14, paddingBottom: 40, gap: 12 },
  title: { color: '#192331', fontSize: 21, fontWeight: '800' },
  sceneFrame: { alignItems: 'center', borderRadius: 6, overflow: 'hidden' },
  count: { color: '#58677D', fontSize: 13, textAlign: 'center' },
  row: { backgroundColor: '#FFFFFF', borderColor: '#DBE3EC', borderWidth: 1, borderRadius: 6, minHeight: 54, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14 },
  rowText: { flex: 1 }, name: { color: '#192331', fontSize: 14, fontWeight: '800' }, merchant: { color: '#58677D', fontSize: 12, marginTop: 3 },
  arrow: { color: '#2456D6', fontSize: 24 }, empty: { color: '#58677D', fontSize: 14, textAlign: 'center' },
  goal: { backgroundColor: '#EAF1FF', minHeight: 48, justifyContent: 'center', alignItems: 'center', borderRadius: 6 },
  goalText: { color: '#2456D6', fontWeight: '800', fontSize: 14 },
});
