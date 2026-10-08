import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, RefreshControl, StyleSheet, Text, TextInput, View, useColorScheme, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AccountCredential } from '@/auth/account-credential';
import { publicDataDemoStoreName } from '@/merchant/public-data-demo-store';
import { useDiscovery } from '@/discovery/discovery-provider';
import { consentRecheckLabel, needsConsentRecheck } from '@/privacy/consent-flow';
import { useConsentRecheck } from '@/privacy/consent-recheck';
import { clothingArtForId } from '@/shop/wardrobe';
import { createRoomApiClient, roomErrorMessage, RoomApiError, type PublicRoom, type RoomSettings, type RoomStampKind, type RoomVisibility, type RoomVisitor } from '@/studio/room-api';
import { StudioScene } from '@/studio/studio-scene';
import { displayStudioItems } from '@/studio/studio-api';
import { colorsForScheme } from '@/theme/palette';
import { BackHeader } from '@/ui/back-header';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';
import { spaceToggles } from '@/ui/space-toggles';
import { StateScene } from '@/ui/state-scene';

const stampLabels: Record<RoomStampKind, string> = { COZY: '포근해요', COOL: '멋져요', RETURN: '다시 올게요' };
type Confirmation = { action: 'report'; roomId: string; stampId: string } | { action: 'block'; roomId: string };

export function RoomExploreScreen({ apiUrl, credential, onSessionInvalid, requestedRoomId }: {
  apiUrl: string; credential: AccountCredential; onSessionInvalid: () => Promise<void>; requestedRoomId?: string;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const recheckConsent = useConsentRecheck();
  const { setOptIn } = useDiscovery();
  const palette = colorsForScheme(useColorScheme());
  const { width } = useWindowDimensions();
  const sceneWidth = Math.min(Math.max(width - 64, 220), 460);
  const client = useMemo(() => createRoomApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const [settings, setSettings] = useState<RoomSettings>();
  const [room, setRoom] = useState<PublicRoom | null>();
  const [neighbors, setNeighbors] = useState<PublicRoom[]>([]);
  const [neighborError, setNeighborError] = useState(false);
  const [visitors, setVisitors] = useState<RoomVisitor[]>([]);
  const [visitorError, setVisitorError] = useState(false);
  const [scopeChoice, setScopeChoice] = useState<RoomVisibility>('PRIVATE');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const toggleAgreed = () => setAgreed((current) => !current);
  const chooseScope = (scope: RoomVisibility) => { setScopeChoice(scope); setAgreed(false); };
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [needsConsent, setNeedsConsent] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [guestbookMessage, setGuestbookMessage] = useState('');
  const active = useRef(false);
  const generation = useRef(0);
  const operation = useRef(false);
  const live = (request: number) => active.current && generation.current === request;

  const load = useCallback(async (refresh = false) => {
    const request = ++generation.current;
    if (refresh) setRefreshing(true); else setLoading(true);
    setError(undefined); setNeedsConsent(false);
    try {
      const [result, nearby, recent, linkedRoom] = await Promise.all([
        client.getSettings(), client.neighbors().then((rooms) => ({ rooms, failed: false })).catch(() => ({ rooms: [] as PublicRoom[], failed: true })),
        client.visitors().then((entries) => ({ entries, failed: false })).catch(() => ({ entries: [] as RoomVisitor[], failed: true })),
        requestedRoomId ? client.getRoom(requestedRoomId).then((room) => ({ room, error: null }))
          .catch((caught: unknown) => ({ room: null, error: roomErrorMessage(caught) }))
          : Promise.resolve({ room: null, error: null }),
      ]);
      if (active.current && generation.current === request) {
        setSettings(result); setScopeChoice(result.visibility); setNeighbors(nearby.rooms); setNeighborError(nearby.failed);
        setVisitors(recent.entries); setVisitorError(recent.failed);
        if (linkedRoom.room) setRoom(linkedRoom.room);
        if (linkedRoom.error) setError(linkedRoom.error);
      }
    } catch (caught) {
      if (active.current && generation.current === request) {
        setError(roomErrorMessage(caught)); setNeedsConsent(needsConsentRecheck(caught));
      }
    } finally {
      if (active.current && generation.current === request) { setLoading(false); setRefreshing(false); }
    }
  }, [client, requestedRoomId]);

  useFocusEffect(useCallback(() => {
    active.current = true; setRoom(undefined); setNotice(undefined); setConfirmation(undefined); setGuestbookMessage(''); void load();
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
      setRoom(next); setGuestbookMessage(''); setNotice(next ? undefined : '지금 둘러볼 공개 방이 없어요. 나중에 다시 찾아보세요.');
    });
  }

  function saveVisibility() {
    if (!settings || (scopeChoice !== 'PRIVATE' && !agreed)) return;
    const request = generation.current;
    void run(async () => {
      const next = await client.setVisibility(scopeChoice);
      if (!live(request)) return;
      setSettings(next); setAgreed(false);
      setNotice(next.visibility === 'PRIVATE' ? '내 방 공개를 중단했어요.' : next.visibility === 'FRIENDS' ? '친구에게 방을 공개했어요.' : '같은 가게 이웃에게 방을 공개했어요.');
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

  function addRoomFriend() {
    if (!room || room.mine || room.friendshipId || room.visibility !== 'NEIGHBORS') return;
    const request = generation.current;
    const roomId = room.roomId;
    void run(async () => {
      let added: Awaited<ReturnType<typeof client.addFriend>>;
      try { added = await client.addFriend(roomId); }
      catch (caught) {
        if (live(request) && caught instanceof RoomApiError && caught.code === 'FRIEND_NEIGHBOR_NOT_FOUND') setRoom(null);
        throw caught;
      }
      void setOptIn({ social: true });
      if (!live(request)) return;
      setRoom((current) => current?.roomId === roomId ? { ...current, friendshipId: added.friend.friendshipId } : current);
      setNeighbors((current) => current.map((entry) => entry.roomId === roomId ? { ...entry, friendshipId: added.friend.friendshipId } : entry));
      setNotice(added.created ? `${added.friend.nickname}님과 친구가 되었어요.` : `${added.friend.nickname}님과 이미 친구예요.`);
      try {
        const updated = await client.getRoom(roomId);
        if (live(request)) setRoom((current) => current?.roomId === roomId ? updated : current);
      } catch (caught) {
        if (!live(request)) return;
        if (caught instanceof RoomApiError && (caught.status === 403 || caught.status === 404)) {
          setRoom((current) => current?.roomId === roomId ? null : current);
          setNotice('친구로 추가했어요. 이 방의 공개 상태가 바뀌어 다시 열 수 없어요.');
        } else setNotice('친구로 추가했어요. 방 정보를 다시 불러오지 못했어요.');
      }
    });
  }

  function leaveStamp(kind: RoomStampKind) {
    if (!room) return;
    const request = generation.current;
    const roomId = room.roomId;
    const message = guestbookMessage;
    void run(async () => {
      const stamp = await client.stamp(roomId, kind, message);
      if (!live(request)) return;
      setRoom((current) => current?.roomId === roomId ? { ...current, stamps: [...current.stamps.filter((item) => item.id !== stamp.id), stamp] } : current);
      setGuestbookMessage((current) => current === message ? '' : current);
      setNotice(stamp.message ? '방명록과 칭찬 도장을 남겼어요.' : '칭찬 도장을 남겼어요.');
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
  const neighborGroups = new Map<string, { merchantId: string; merchantName: string; rooms: PublicRoom[] }>();
  for (const entry of neighbors) for (const merchant of entry.sharedMerchants) {
    const group = neighborGroups.get(merchant.merchantId) ?? { ...merchant, rooms: [] };
    group.rooms.push(entry);
    neighborGroups.set(merchant.merchantId, group);
  }
  const header = <BackHeader title="월계 방 탐험" />;
  return <SkyBackdrop><SkyScrollView header={header} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} progressViewOffset={insets.top} />}>
    <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.separator }]}>
      <Text accessibilityRole="header" style={[styles.heading, { color: palette.label }]}>내 방 공개</Text>
      <Text style={[styles.body, { color: palette.secondaryLabel }]}>공개할 사람을 선택하세요. 공개하면 방 꾸밈과 동행, 전시 코인과 닉네임을 선택한 범위에 보여줘요. 같은 가게 이웃은 방을 방문하고 친구 추가를 선택할 수 있어요.</Text>
      {loading && !settings ? <StateScene kind="loading" title="공개 설정 확인 중" /> : null}
      {settings ? <>
        <Text style={[styles.status, { color: settings.visible ? palette.success : palette.secondaryLabel }]}>현재 {settings.visibility === 'PRIVATE' ? '나만 보기' : settings.visibility === 'FRIENDS' ? '친구에게 공개' : '같은 가게 이웃에게 공개'}</Text>
        {(['PRIVATE', 'FRIENDS', 'NEIGHBORS'] as const).map((scope) => <Pressable key={scope} accessibilityRole="radio"
          accessibilityState={{ checked: scopeChoice === scope }} aria-checked={scopeChoice === scope} onPress={() => chooseScope(scope)}
          {...(Platform.OS === 'web' ? { onKeyDown: spaceToggles(() => chooseScope(scope)) } : {})} style={styles.checkRow}>
          <Text style={[styles.check, { color: palette.primary }]}>{scopeChoice === scope ? '◉' : '○'}</Text>
          <Text style={[styles.body, { color: palette.label, flex: 1 }]}>{scope === 'PRIVATE' ? '나만 보기' : scope === 'FRIENDS' ? '친구' : '같은 가게 이웃'}</Text>
        </Pressable>)}
        {scopeChoice === 'NEIGHBORS' ? <Text style={[styles.body, { color: palette.secondaryLabel }]}>같은 가게의 방문이 확인된 이웃도 내 방을 볼 수 있어요.</Text> : null}
        {scopeChoice !== 'PRIVATE' && scopeChoice !== settings.visibility ? <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: agreed }} aria-checked={agreed}
          accessibilityLabel="방 공개 범위 확인" onPress={toggleAgreed} {...(Platform.OS === 'web' ? { onKeyDown: spaceToggles(toggleAgreed) } : {})} style={styles.checkRow}>
          <Text style={[styles.check, { color: palette.primary }]}>{agreed ? '☑' : '□'}</Text>
          <Text style={[styles.body, { color: palette.label, flex: 1 }]}>위 공개 범위를 확인했어요</Text>
        </Pressable> : null}
        <Pressable accessibilityRole="button" disabled={busy || scopeChoice === settings.visibility || (scopeChoice !== 'PRIVATE' && !agreed)} onPress={saveVisibility}
          style={[styles.button, { backgroundColor: palette.primary }, busy || scopeChoice === settings.visibility || (scopeChoice !== 'PRIVATE' && !agreed) ? styles.disabled : null]}>
          <Text style={[styles.buttonText, { color: palette.onPrimary }]}>공개 범위 저장</Text>
        </Pressable>
        {settings.visible && settings.roomId ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => {
          setConfirmation(undefined);
          const request = generation.current;
          void run(async () => { const mine = await client.getRoom(settings.roomId!); if (live(request)) { setRoom(mine); setGuestbookMessage(''); setNotice(undefined); } });
        }} style={styles.link}><Text style={[styles.linkText, { color: palette.primary }]}>내 공개 방과 도장 보기 ›</Text></Pressable> : null}
      </> : null}
    </View>

    <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.separator }]}>
      <Text accessibilityRole="header" style={[styles.heading, { color: palette.label }]}>우리 방 방문자</Text>
      {visitorError ? <Pressable accessibilityRole="button" onPress={() => void load(true)}><Text style={[styles.linkText, { color: palette.primary }]}>방문자를 불러오지 못했어요 · 다시 시도</Text></Pressable>
        : visitors.length ? visitors.map((entry, index) => <View key={`${entry.nickname}:${index}`} style={styles.checkRow}>
          <Text style={[styles.body, { color: palette.label, flex: 1 }]}>{entry.nickname} · 방 방문 {entry.visits}회</Text>
          {entry.canReturn && entry.roomId ? <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/room-explore', params: { roomId: entry.roomId! } })}>
            <Text style={[styles.linkText, { color: palette.primary }]}>답방 ›</Text></Pressable> : null}
        </View>) : <Text style={[styles.body, { color: palette.secondaryLabel }]}>아직 방문한 이웃이 없어요.</Text>}
    </View>

    <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.separator }]}>
      <Text accessibilityRole="header" style={[styles.heading, { color: palette.label }]}>같은 가게 이웃</Text>
      {neighborError ? <Pressable accessibilityRole="button" onPress={() => void load(true)}><Text style={[styles.linkText, { color: palette.primary }]}>이웃 목록을 불러오지 못했어요 · 다시 시도</Text></Pressable>
        : neighborGroups.size ? [...neighborGroups.values()].map((group) => <View key={group.merchantId} style={{ gap: 6 }}>
          <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/merchants/[merchantId]', params: { merchantId: group.merchantId } })} style={styles.checkRow}>
            <View style={{ flex: 1 }}><Text style={[styles.status, { color: palette.label }]}>{publicDataDemoStoreName(group.merchantId, group.merchantName)}</Text>
              <Text style={[styles.body, { color: palette.secondaryLabel }]}>함께 방문한 공개 이웃 {group.rooms.length}명</Text></View>
            <Text style={[styles.linkText, { color: palette.primary }]}>가게 ›</Text>
          </Pressable>
          <View style={styles.stampChoices}>{group.rooms.map((entry) => <Pressable key={entry.roomId} accessibilityRole="button"
            onPress={() => { setRoom(entry); setGuestbookMessage(''); setConfirmation(undefined); }} style={[styles.stampChoice, { borderColor: palette.primaryContainer }]}>
            <Text style={[styles.stampText, { color: palette.label }]}>{entry.studio.nickname}의 방 ›</Text>
          </Pressable>)}</View>
        </View>) : <Text style={[styles.body, { color: palette.secondaryLabel }]}>공통으로 방문한 가게의 공개 방이 아직 없어요.</Text>}
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
      <View style={styles.sceneFrame}><StudioScene studio={room.studio.studio} items={displayStudioItems(room.studio)} avatar={room.studio.avatar}
        furnitureItems={room.studio.furnitureItems}
        clothing={clothingArtForId(room.studio.avatarClothingId)} apiUrl={apiUrl} width={sceneWidth} height={Math.round(sceneWidth * .92)}
        onItemPress={(item) => router.push({ pathname: '/merchants/[merchantId]', params: { merchantId: item.merchantId } })} /></View>
      <Text style={[styles.body, { color: palette.secondaryLabel }]}>진열한 수집품 {displayStudioItems(room.studio).length}개</Text>
      {room.sharedMerchants.map((merchant) => <Pressable key={merchant.merchantId} accessibilityRole="button"
        onPress={() => router.push({ pathname: '/merchants/[merchantId]', params: { merchantId: merchant.merchantId } })} style={styles.checkRow}>
        <Text style={[styles.linkText, { color: palette.primary }]}>{publicDataDemoStoreName(merchant.merchantId, merchant.merchantName)} · 가게와 획득 조건 보기 ›</Text>
      </Pressable>)}
      {!ownRoom && !room.friendshipId && room.visibility === 'NEIGHBORS' ? <View style={{ gap: 6 }}>
        <Text style={[styles.body, { color: palette.secondaryLabel }]}>친구가 아니어도 이웃 방을 방문할 수 있어요.</Text>
        <Pressable accessibilityRole="button" disabled={busy} onPress={addRoomFriend}
          style={[styles.button, { backgroundColor: palette.primary }, busy && styles.disabled]}>
          <Text style={[styles.buttonText, { color: palette.onPrimary }]}>{busy ? '처리 중…' : '친구 추가'}</Text>
        </Pressable>
      </View> : null}
      {!ownRoom && room.friendshipId ? <View style={styles.stampChoices}>
        <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/friends/[friendshipId]', params: { friendshipId: room.friendshipId! } })} style={styles.link}>
          <Text style={[styles.linkText, { color: palette.primary }]}>친구 프로필 ›</Text></Pressable>
        {room.sharedMerchants[0] ? <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/friends/[friendshipId]/meal-invite', params: { friendshipId: room.friendshipId!, merchantId: room.sharedMerchants[0]!.merchantId } })} style={styles.link}>
          <Text style={[styles.linkText, { color: palette.primary }]}>이 가게에서 만날 시간 제안 ›</Text></Pressable> : null}
      </View> : null}
      {!ownRoom ? <Pressable accessibilityRole="button" disabled={busy} onPress={visit} style={[styles.button, { backgroundColor: palette.primary }, busy && styles.disabled]}>
        <Text style={[styles.buttonText, { color: palette.onPrimary }]}>방 방문하기</Text>
      </Pressable> : null}
      <Text style={[styles.subheading, { color: palette.label }]}>칭찬 방명록</Text>
      {!ownRoom ? <View style={{ gap: 8 }}>
        <TextInput accessibilityLabel="방명록 글, 선택 사항" placeholder="좋았던 점을 한 줄로 남겨 주세요 (선택)"
          placeholderTextColor={palette.secondaryLabel} value={guestbookMessage} editable={!busy}
          onChangeText={(value) => setGuestbookMessage(Array.from(value).slice(0, 120).join(''))}
          style={[styles.guestbookInput, { color: palette.label, backgroundColor: palette.surface, borderColor: palette.separator }]} />
        <Text accessibilityLiveRegion="polite" style={[styles.body, { color: palette.secondaryLabel, textAlign: 'right' }]}>{Array.from(guestbookMessage).length}/120자 · 글 없이 칭찬만 남겨도 돼요.</Text>
        <View style={styles.stampChoices}>{(Object.keys(stampLabels) as RoomStampKind[]).map((kind) => <Pressable key={kind}
        accessibilityRole="button" disabled={busy} onPress={() => leaveStamp(kind)} style={[styles.stampChoice, { borderColor: palette.primaryContainer }]}>
        <Text style={[styles.stampText, { color: palette.label }]}>{stampLabels[kind]}</Text>
        </Pressable>)}</View>
      </View> : null}
      {room.stamps.length ? room.stamps.map((stamp) => <View key={stamp.id} style={[styles.stampRow, { borderTopColor: palette.separator }]}>
        <View style={{ flex: 1 }}><Text style={[styles.body, { color: palette.label }]}>{stamp.authorNickname} · {stampLabels[stamp.kind]}{stamp.mine ? ' · 내가 남김' : ''}</Text>
          {stamp.message ? <Text style={[styles.body, { color: palette.label }]}>{stamp.message}</Text> : null}</View>
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
  guestbookInput: { minHeight: 52, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, fontSize: 15 },
  confirmation: { width: '100%', borderRadius: 12, padding: 12, gap: 8 },
  confirmActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  confirmButton: { minHeight: 44, minWidth: 64, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
});
