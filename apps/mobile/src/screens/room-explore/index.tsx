import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View, useColorScheme, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AccountCredential } from '@/auth/account-credential';
import { consentRecheckLabel, needsConsentRecheck } from '@/privacy/consent-flow';
import { useConsentRecheck } from '@/privacy/consent-recheck';
import { clothingArtForId } from '@/shop/wardrobe';
import { createRoomApiClient, roomErrorMessage, type PublicRoom, type RoomSettings, type RoomStampKind } from '@/studio/room-api';
import { StudioScene } from '@/studio/studio-scene';
import { colorsForScheme } from '@/theme/palette';
import { BackHeader } from '@/ui/back-header';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';
import { StateScene } from '@/ui/state-scene';

const stampLabels: Record<RoomStampKind, string> = { COZY: '포근해요', COOL: '멋져요', RETURN: '다시 올게요' };
type Confirmation = { action: 'report'; roomId: string; stampId: string } | { action: 'block'; roomId: string };

export function RoomExploreScreen({ apiUrl, credential, onSessionInvalid }: {
  apiUrl: string; credential: AccountCredential; onSessionInvalid: () => Promise<void>;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const recheckConsent = useConsentRecheck();
  const palette = colorsForScheme(useColorScheme());
  const { width } = useWindowDimensions();
  const sceneWidth = Math.min(Math.max(width - 64, 220), 460);
  const client = useMemo(() => createRoomApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const [settings, setSettings] = useState<RoomSettings>();
  const [room, setRoom] = useState<PublicRoom | null>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [needsConsent, setNeedsConsent] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const active = useRef(false);
  const generation = useRef(0);
  const operation = useRef(false);
  const live = (request: number) => active.current && generation.current === request;

  const load = useCallback(async (refresh = false) => {
    const request = ++generation.current;
    if (refresh) setRefreshing(true); else setLoading(true);
    setError(undefined); setNeedsConsent(false);
    try {
      const result = await client.getSettings();
      if (active.current && generation.current === request) setSettings(result);
    } catch (caught) {
      if (active.current && generation.current === request) {
        setError(roomErrorMessage(caught)); setNeedsConsent(needsConsentRecheck(caught));
      }
    } finally {
      if (active.current && generation.current === request) { setLoading(false); setRefreshing(false); }
    }
  }, [client]);

  useFocusEffect(useCallback(() => {
    active.current = true; setRoom(undefined); setNotice(undefined); setConfirmation(undefined); void load();
    return () => { active.current = false; generation.current += 1; operation.current = false; setConfirmation(undefined); };
  }, [load]));

  async function run(task: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError(undefined); setNeedsConsent(false);
    try { await task(); }
    catch (caught) {
      if (active.current) { setError(roomErrorMessage(caught)); setNeedsConsent(needsConsentRecheck(caught)); }
    } finally { operation.current = false; if (active.current) setBusy(false); }
  }

  function findAnother() {
    setConfirmation(undefined);
    const request = generation.current;
    void run(async () => {
      const next = await client.randomRoom(room?.roomId);
      if (!live(request)) return;
      setRoom(next); setNotice(next ? undefined : '지금 둘러볼 공개 방이 없어요. 나중에 다시 찾아보세요.');
    });
  }

  function toggleVisibility() {
    if (!settings || (!settings.visible && !agreed)) return;
    const request = generation.current;
    void run(async () => {
      const next = await client.setVisibility(!settings.visible);
      if (!live(request)) return;
      setSettings(next); setAgreed(false);
      setNotice(next.visible ? '내 방이 랜덤 탐험에 공개됐어요.' : '내 방 공개를 중단했어요.');
      if (!next.visible && room?.roomId === settings.roomId) { setRoom(undefined); setConfirmation(undefined); }
    });
  }

  function visit() {
    if (!room) return;
    const request = generation.current;
    const roomId = room.roomId;
    void run(async () => {
      const result = await client.visit(roomId);
      if (!live(request)) return;
      setNotice(result.creditedMileage ? `방문 완료 · ${result.creditedMileage}P 받았어요. 오늘 둘러본 방 ${result.visitsToday}곳` : `방문 완료 · 이번 방문은 추가 마일리지가 없어요. 오늘 둘러본 방 ${result.visitsToday}곳`);
    });
  }

  function leaveStamp(kind: RoomStampKind) {
    if (!room) return;
    const request = generation.current;
    const roomId = room.roomId;
    void run(async () => {
      const stamp = await client.stamp(roomId, kind);
      if (!live(request)) return;
      setRoom((current) => current?.roomId === roomId ? { ...current, stamps: [...current.stamps.filter((item) => item.id !== stamp.id), stamp] } : current);
      setNotice('칭찬 도장을 남겼어요.');
    });
  }

  function removeStamp(stampId: string) {
    const request = generation.current;
    void run(async () => {
      await client.removeStamp(stampId);
      if (!live(request)) return;
      setRoom((current) => current ? { ...current, stamps: current.stamps.filter((stamp) => stamp.id !== stampId) } : current);
      setNotice('도장을 숨겼어요.');
    });
  }

  function reportStamp(stampId: string) {
    if (room) setConfirmation({ action: 'report', roomId: room.roomId, stampId });
  }

  function blockRoom() {
    if (room) setConfirmation({ action: 'block', roomId: room.roomId });
  }

  function confirmAction() {
    const target = confirmation;
    setConfirmation(undefined);
    if (!target || !room || target.roomId !== room.roomId || !active.current || busy) return;
    if (target.action === 'report' && !room.stamps.some((stamp) => stamp.id === target.stampId && !stamp.mine)) return;
    const request = generation.current;
    void run(async () => {
      if (target.action === 'report') {
        await client.reportStamp(target.stampId);
        if (live(request)) setNotice('신고를 접수했어요.');
      } else {
        await client.blockRoom(target.roomId);
        if (live(request)) { setRoom(undefined); setNotice('이 방을 차단했어요.'); }
      }
    });
  }

  const ownRoom = room?.mine ?? false;
  const header = <BackHeader title="월계 방 탐험" />;
  return <SkyBackdrop><SkyScrollView header={header} contentContainerStyle={styles.content}
    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} progressViewOffset={insets.top} />}>
    <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.separator }]}>
      <Text accessibilityRole="header" style={[styles.heading, { color: palette.label }]}>내 방 공개</Text>
      <Text style={[styles.body, { color: palette.secondaryLabel }]}>기본은 비공개예요. 공개하면 저장한 방 꾸밈과 동행, 진열한 수집품, 닉네임이 다른 사용자에게 보입니다. 언제든 공개를 끌 수 있어요.</Text>
      {loading && !settings ? <StateScene kind="loading" title="공개 설정 확인 중" /> : null}
      {settings ? <>
        <Text style={[styles.status, { color: settings.visible ? palette.success : palette.secondaryLabel }]}>{settings.visible ? '현재 공개 중' : '현재 비공개'}</Text>
        {!settings.visible ? <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: agreed }}
          accessibilityLabel="방 공개 범위 확인" onPress={() => setAgreed((current) => !current)} style={styles.checkRow}>
          <Text style={[styles.check, { color: palette.primary }]}>{agreed ? '☑' : '□'}</Text>
          <Text style={[styles.body, { color: palette.label, flex: 1 }]}>위 공개 범위를 확인했어요</Text>
        </Pressable> : null}
        <Pressable accessibilityRole="button" disabled={busy || (!settings.visible && !agreed)} onPress={toggleVisibility}
          style={[styles.button, { backgroundColor: palette.primary }, busy || (!settings.visible && !agreed) ? styles.disabled : null]}>
          <Text style={[styles.buttonText, { color: palette.onPrimary }]}>{settings.visible ? '공개 중단' : '내 방 공개하기'}</Text>
        </Pressable>
        {settings.visible && settings.roomId ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => {
          setConfirmation(undefined);
          const request = generation.current;
          void run(async () => { const mine = await client.getRoom(settings.roomId!); if (live(request)) { setRoom(mine); setNotice(undefined); } });
        }} style={styles.link}><Text style={[styles.linkText, { color: palette.primary }]}>내 공개 방과 도장 보기 ›</Text></Pressable> : null}
      </> : null}
    </View>

    <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.separator }]}>
      <Text accessibilityRole="header" style={[styles.heading, { color: palette.label }]}>이웃 방 둘러보기</Text>
      <Text style={[styles.body, { color: palette.secondaryLabel }]}>다른 공개 방을 랜덤으로 찾아요. 실제 방문 이력이 있으면 하루 첫 5곳에서 각 2P까지 받을 수 있어요.</Text>
      <Pressable accessibilityRole="button" disabled={busy || loading} onPress={findAnother} style={[styles.button, { backgroundColor: palette.primary }, busy && styles.disabled]}>
        <Text style={[styles.buttonText, { color: palette.onPrimary }]}>{busy ? '처리 중…' : room ? '다른 방 찾아가기' : '랜덤 방 찾아가기'}</Text>
      </Pressable>
    </View>

    {error ? <View style={[styles.card, { backgroundColor: palette.errorContainer, borderColor: palette.error }]}>
      <Text accessibilityRole="alert" style={[styles.body, { color: palette.onErrorContainer }]}>{error}</Text>
      <Pressable accessibilityRole="button" onPress={needsConsent ? recheckConsent : () => void load()} style={styles.link}>
        <Text style={[styles.linkText, { color: palette.onErrorContainer }]}>{needsConsent ? consentRecheckLabel : '다시 시도'}</Text>
      </Pressable>
    </View> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={[styles.body, { color: palette.label }]}>{notice}</Text> : null}
    {room ? <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.separator }]}>
      <Text accessibilityRole="header" style={[styles.heading, { color: palette.label }]}>{room.studio.nickname}의 방</Text>
      <View style={styles.sceneFrame}><StudioScene studio={room.studio.studio} items={room.studio.items} avatar={room.studio.avatar}
        clothing={clothingArtForId(room.studio.avatarClothingId)} apiUrl={apiUrl} width={sceneWidth} height={Math.round(sceneWidth * .92)}
        onItemPress={(item) => router.push({ pathname: '/merchants/[merchantId]', params: { merchantId: item.merchantId } })} /></View>
      <Text style={[styles.body, { color: palette.secondaryLabel }]}>진열한 수집품 {room.studio.items.length}개</Text>
      {!ownRoom ? <Pressable accessibilityRole="button" disabled={busy} onPress={visit} style={[styles.button, { backgroundColor: palette.primary }, busy && styles.disabled]}>
        <Text style={[styles.buttonText, { color: palette.onPrimary }]}>방 방문하기</Text>
      </Pressable> : null}
      <Text style={[styles.subheading, { color: palette.label }]}>칭찬 방명록</Text>
      {!ownRoom ? <View style={styles.stampChoices}>{(Object.keys(stampLabels) as RoomStampKind[]).map((kind) => <Pressable key={kind}
        accessibilityRole="button" disabled={busy} onPress={() => leaveStamp(kind)} style={[styles.stampChoice, { borderColor: palette.primaryContainer }]}>
        <Text style={[styles.stampText, { color: palette.label }]}>{stampLabels[kind]}</Text>
      </Pressable>)}</View> : null}
      {room.stamps.length ? room.stamps.map((stamp) => <View key={stamp.id} style={[styles.stampRow, { borderTopColor: palette.separator }]}>
        <Text style={[styles.body, { color: palette.label, flex: 1 }]}>{stampLabels[stamp.kind]}{stamp.mine ? ' · 내가 남김' : ''}</Text>
        {stamp.mine || ownRoom ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => removeStamp(stamp.id)}><Text style={[styles.linkText, { color: palette.primary }]}>{ownRoom && !stamp.mine ? '숨기기' : '삭제'}</Text></Pressable> : null}
        {!stamp.mine && !ownRoom ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => reportStamp(stamp.id)}><Text style={[styles.linkText, { color: palette.primary }]}>신고</Text></Pressable> : null}
        {confirmation?.action === 'report' && confirmation.stampId === stamp.id && confirmation.roomId === room.roomId ? <View style={[styles.confirmation, { backgroundColor: palette.errorContainer }]}>
          <Text style={[styles.body, { color: palette.onErrorContainer }]}>이 도장을 신고할까요?</Text>
          <View style={styles.confirmActions}><Pressable accessibilityRole="button" onPress={() => setConfirmation(undefined)} style={styles.confirmButton}><Text style={[styles.linkText, { color: palette.label }]}>취소</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={busy} onPress={confirmAction} style={styles.confirmButton}><Text style={[styles.linkText, { color: palette.error }]}>신고 확인</Text></Pressable></View>
        </View> : null}
      </View>) : <Text style={[styles.body, { color: palette.secondaryLabel }]}>아직 남긴 도장이 없어요.</Text>}
      {!ownRoom ? <Pressable accessibilityRole="button" disabled={busy} onPress={blockRoom} style={styles.link}>
        <Text style={[styles.linkText, { color: palette.error }]}>이 방 차단</Text>
      </Pressable> : null}
      {confirmation?.action === 'block' && confirmation.roomId === room.roomId ? <View style={[styles.confirmation, { backgroundColor: palette.errorContainer }]}>
        <Text style={[styles.body, { color: palette.onErrorContainer }]}>이 방을 더 이상 탐험 목록에서 보지 않을까요?</Text>
        <View style={styles.confirmActions}><Pressable accessibilityRole="button" onPress={() => setConfirmation(undefined)} style={styles.confirmButton}><Text style={[styles.linkText, { color: palette.label }]}>취소</Text></Pressable>
          <Pressable accessibilityRole="button" disabled={busy} onPress={confirmAction} style={styles.confirmButton}><Text style={[styles.linkText, { color: palette.error }]}>차단 확인</Text></Pressable></View>
      </View> : null}
    </View> : null}
  </SkyScrollView></SkyBackdrop>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 14, paddingBottom: 48, gap: 14 },
  card: { borderWidth: 1, borderRadius: 20, padding: 16, gap: 12 },
  heading: { fontSize: 20, fontWeight: '800' }, body: { fontSize: 14, lineHeight: 21 },
  subheading: { fontSize: 16, fontWeight: '800', marginTop: 4 },
  status: { fontSize: 14, fontWeight: '700' },
  checkRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 }, check: { fontSize: 27 },
  button: { minHeight: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  buttonText: { fontWeight: '800', fontSize: 15 }, disabled: { opacity: .5 },
  link: { minHeight: 44, justifyContent: 'center', alignItems: 'center' }, linkText: { fontSize: 14, fontWeight: '800' },
  sceneFrame: { alignItems: 'center', overflow: 'hidden', borderRadius: 14 },
  stampChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stampChoice: { minHeight: 44, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, justifyContent: 'center' },
  stampText: { fontSize: 13, fontWeight: '700' },
  stampRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', minHeight: 48, gap: 12, borderTopWidth: 1 },
  confirmation: { width: '100%', borderRadius: 12, padding: 12, gap: 8 },
  confirmActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  confirmButton: { minHeight: 44, minWidth: 64, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
});
