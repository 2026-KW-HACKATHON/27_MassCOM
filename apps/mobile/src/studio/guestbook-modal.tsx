import { randomUUID } from 'expo-crypto';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet,
  Text, TextInput, View, useColorScheme, useWindowDimensions, type ViewToken } from 'react-native';
import type { AccountCredential } from '@/auth/account-credential';
import { useDiscovery } from '@/discovery/discovery-provider';
import { AvatarPortrait } from '@/illustration/avatar-portrait';
import { useMotionEnabled } from '@/motion/use-motion';
import { clothingArtForId } from '@/shop/wardrobe';
import { colorsForScheme } from '@/theme/palette';
import { appendGuestbookPage, notifyGuestbookChanged, visibleUnreadGuestbookIds } from './guestbook-state';
import { createRoomApiClient, normalizeGuestbookMessage, roomErrorMessage, RoomApiError, type GuestbookAuthor, type GuestbookEntry, type GuestbookPage } from './room-api';

type Props = { apiUrl: string; credential: AccountCredential; onSessionInvalid: () => Promise<void>;
  visible: boolean; roomId?: string; own?: boolean; onClose: () => void };
type Client = ReturnType<typeof createRoomApiClient>;

/** Re-mount on a credential or room change so neither text nor author details cross accounts. */
export function GuestbookModal({ apiUrl, credential, onSessionInvalid, visible, roomId, own = false, onClose }: Props) {
  const client = useMemo(() => createRoomApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const [scope, setScope] = useState({ client, roomId, own, key: 0 });
  const sameScope = scope.client === client && scope.roomId === roomId && scope.own === own;
  if (!sameScope) {
    setScope({ client, roomId, own, key: scope.key + 1 });
  }
  const [focused, setFocused] = useState(true);
  useFocusEffect(useCallback(() => { setFocused(true); return () => { setFocused(false); }; }, []));
  return visible && focused && sameScope ? <GuestbookDialog key={scope.key} client={client} roomId={roomId} own={own} onClose={onClose} /> : null;
}

function GuestbookDialog({ client, roomId, own, onClose }: { client: Client; roomId?: string; own: boolean; onClose: () => void }) {
  const palette = colorsForScheme(useColorScheme());
  const motion = useMotionEnabled();
  const { height } = useWindowDimensions();
  const { setOptIn, refresh: refreshDiscovery } = useDiscovery();
  const [page, setPage] = useState<GuestbookPage>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [readError, setReadError] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [message, setMessage] = useState('');
  const [author, setAuthor] = useState<{ entryId: string; profile?: GuestbookAuthor; error?: string }>();
  const [showInformation, setShowInformation] = useState(false);
  const [confirmation, setConfirmation] = useState<{ entry: GuestbookEntry; kind: 'remove' | 'report' }>();
  const active = useRef(true);
  const pageRequest = useRef(0);
  const authorRequest = useRef(0);
  const operation = useRef(false);
  const pendingPost = useRef<{ requestId: string; message: string } | undefined>(undefined);
  const acknowledged = useRef(new Set<string>());
  const pendingReads = useRef(new Set<string>());
  const visibleIds = useRef<string[]>([]);
  const readVisible = useRef<() => void>(() => {});
  const currentEntries = useRef<GuestbookEntry[]>([]);
  const viewingList = useRef(true);
  currentEntries.current = page?.entries ?? [];
  viewingList.current = !author;

  const load = useCallback(async (cursor?: string) => {
    const request = ++pageRequest.current;
    if (cursor) setLoadingMore(true); else setLoading(true);
    setError(undefined);
    try {
      const next = own ? await client.ownGuestbook(cursor) : await client.guestbook(roomId!, cursor);
      if (!active.current || request !== pageRequest.current) return;
      // Successful acknowledgements need not disappear during a concurrent page fetch.
      next.entries = next.entries.map((entry) => acknowledged.current.has(entry.id) ? { ...entry, unread: false } : entry);
      setPage((current) => cursor && current ? appendGuestbookPage(current, next) : next);
    } catch (caught) {
      if (active.current && request === pageRequest.current) {
        if (caught instanceof RoomApiError && [403, 404].includes(caught.status)) setPage(undefined);
        setError(roomErrorMessage(caught));
      }
    }
    finally { if (active.current && request === pageRequest.current) { setLoading(false); setLoadingMore(false); } }
  }, [client, own, roomId]);

  useEffect(() => {
    active.current = true;
    void load();
    return () => { active.current = false; pageRequest.current += 1; authorRequest.current += 1; };
  }, [load]);

  readVisible.current = () => {
    if (!own || !active.current || !viewingList.current) return;
    const ids = visibleUnreadGuestbookIds(currentEntries.current, visibleIds.current)
      .filter((id) => !pendingReads.current.has(id) && !acknowledged.current.has(id));
    if (!ids.length) return;
    ids.forEach((id) => pendingReads.current.add(id));
    void client.readGuestbook(ids).then(({ unreadCount }) => {
      if (!active.current) return;
      ids.forEach((id) => acknowledged.current.add(id));
      setReadError(false);
      setPage((current) => current ? { ...current, unreadCount,
        entries: current.entries.map((entry) => ids.includes(entry.id) ? { ...entry, unread: false } : entry) } : current);
      notifyGuestbookChanged();
    }).catch(() => { if (active.current) setReadError(true); })
      .finally(() => { ids.forEach((id) => pendingReads.current.delete(id)); });
  };
  const onVisible = useRef(({ viewableItems }: { viewableItems: ViewToken<GuestbookEntry>[] }) => {
    visibleIds.current = viewableItems.filter((item) => item.isViewable).map((item) => item.item.id);
    readVisible.current();
  }).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50, minimumViewTime: 300 }).current;

  async function write() {
    if (operation.current || own || !roomId) return;
    let normalized: string;
    try { normalized = normalizeGuestbookMessage(message); }
    catch (caught) { setError(roomErrorMessage(caught)); return; }
    const attempt = pendingPost.current?.message === normalized ? pendingPost.current : { requestId: randomUUID(), message: normalized };
    pendingPost.current = attempt;
    operation.current = true; setBusy(true); setError(undefined); setNotice(undefined);
    try {
      const result = await client.writeGuestbook(roomId, attempt.requestId, attempt.message);
      if (!active.current) return;
      pendingPost.current = undefined; setMessage('');
      setNotice(result.creditedMileage ? `글을 남겼어요 · ${result.creditedMileage}P 받았어요` : '글을 남겼어요 · 이번 글은 추가 마일리지가 없어요');
      notifyGuestbookChanged();
      // Discovery handles refresh errors independently of this committed post.
      refreshDiscovery();
      await load();
    } catch (caught) { if (active.current) setError(roomErrorMessage(caught)); }
    finally { operation.current = false; if (active.current) setBusy(false); }
  }

  async function openAuthor(entryId: string) {
    const request = ++authorRequest.current;
    setAuthor({ entryId }); setShowInformation(false); setConfirmation(undefined);
    try {
      const profile = await client.guestbookAuthor(entryId);
      if (active.current && request === authorRequest.current) setAuthor({ entryId, profile });
    } catch (caught) {
      if (active.current && request === authorRequest.current) setAuthor({ entryId, error: roomErrorMessage(caught) });
    }
  }
  function backToList() { authorRequest.current += 1; setAuthor(undefined); setShowInformation(false); }
  async function addFriend() {
    if (!author?.profile || operation.current || author.profile.mine || author.profile.friendshipId) return;
    const entryId = author.entryId;
    operation.current = true; setBusy(true);
    try {
      const added = await client.addGuestbookFriend(entryId);
      if (!active.current) return;
      void setOptIn({ social: true });
      setAuthor((current) => current?.entryId === entryId && current.profile ? {
        ...current, error: undefined, profile: { ...current.profile, friendshipId: added.friend.friendshipId },
      } : current);
      refreshDiscovery();
    } catch (caught) { if (active.current) setAuthor((current) => current?.entryId === entryId ? { ...current, error: roomErrorMessage(caught) } : current); }
    finally { operation.current = false; if (active.current) setBusy(false); }
  }
  async function confirmAction() {
    if (!confirmation || operation.current) return;
    const target = confirmation;
    operation.current = true; setBusy(true); setError(undefined);
    try {
      if (target.kind === 'remove') await client.removeGuestbook(target.entry.id);
      else await client.reportGuestbook(target.entry.id);
      if (!active.current) return;
      setConfirmation(undefined);
      setNotice(target.kind === 'remove' ? '글을 삭제했어요.' : '신고를 접수했어요.');
      if (target.kind === 'remove') { notifyGuestbookChanged(); await load(); }
    } catch (caught) { if (active.current) setError(roomErrorMessage(caught)); }
    finally { operation.current = false; if (active.current) setBusy(false); }
  }

  const text = { color: palette.label };
  const muted = { color: palette.secondaryLabel };
  const primaryText = { color: palette.primary, fontWeight: '700' as const };
  const profile = author?.profile;
  return <Modal visible transparent animationType={motion ? 'fade' : 'none'} onRequestClose={author ? backToList : onClose}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.overlay}>
      <View accessibilityViewIsModal onAccessibilityEscape={author ? backToList : onClose}
        style={[styles.dialog, { backgroundColor: palette.surface, maxHeight: height * .88 }]}>
        <View style={styles.header}>
          {author ? <Pressable accessibilityRole="button" accessibilityLabel="방명록으로 돌아가기" onPress={backToList} style={styles.smallButton}><Text style={primaryText}>‹ 목록</Text></Pressable> : null}
          <Text accessibilityRole="header" style={[styles.title, text, { flex: 1 }]}>{author ? '프로필' : '방명록'}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="방명록 닫기" onPress={onClose} style={styles.smallButton}><Text style={primaryText}>닫기</Text></Pressable>
        </View>
        {author ? <ScrollView contentContainerStyle={styles.profile} keyboardShouldPersistTaps="handled">
          {!profile && !author.error ? <ActivityIndicator accessibilityLabel="프로필 불러오는 중" color={palette.primary} /> : null}
          {profile ? <>
            <AvatarPortrait avatar={profile.avatar} clothing={clothingArtForId(profile.avatarClothingId)} size={88} animated={false} />
            <Text style={[styles.title, text]}>{profile.nickname}</Text>
            {profile.intro ? <Text style={[styles.body, text]}>{profile.intro}</Text> : null}
            <View style={styles.actions}>
              {profile.mine ? <Text style={[styles.body, muted]}>내 프로필</Text> : <Pressable accessibilityRole="button" disabled={busy || Boolean(profile.friendshipId)} onPress={() => void addFriend()}
                accessibilityState={{ disabled: busy || Boolean(profile.friendshipId) }} style={[styles.action, { backgroundColor: palette.primaryContainer }]}>
                <Text style={{ color: palette.onPrimaryContainer, fontWeight: '700' }}>{profile.friendshipId ? '이미 친구예요' : busy ? '추가 중…' : '친구 추가하기'}</Text>
              </Pressable>}
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: showInformation }} onPress={() => setShowInformation((value) => !value)} style={styles.action}>
                <Text style={primaryText}>{showInformation ? '정보 접기' : '정보 보기'}</Text>
              </Pressable>
            </View>
            {showInformation ? <View style={[styles.information, { borderColor: palette.separator }]}>
              <Text style={[styles.body, text]}>달성한 배지 {profile.earnedBadges}/{profile.totalBadges}</Text>
              {profile.medals.map((medal) => <Text key={medal.key} style={[styles.body, text]}>
                {{ explorer: '탐험', regular: '단골', steady: '꾸준함' }[medal.key]} · {medal.tier}/3단계
              </Text>)}
              <Text style={[styles.body, text]}>모은 방문 스탬프 {profile.stampCount}개</Text>
            </View> : null}
          </> : null}
          {author.error ? <><Text accessibilityRole="alert" style={[styles.body, { color: palette.error }]}>{author.error}</Text>
            {!profile ? <Pressable accessibilityRole="button" onPress={() => void openAuthor(author.entryId)} style={styles.action}><Text style={primaryText}>다시 불러오기</Text></Pressable> : null}</> : null}
        </ScrollView> : <>
          {loading && !page ? <ActivityIndicator accessibilityLabel="방명록 불러오는 중" color={palette.primary} style={styles.loader} /> : null}
          <FlatList data={page?.entries ?? []} keyExtractor={(entry) => entry.id} style={styles.list}
            keyboardShouldPersistTaps="handled" onViewableItemsChanged={onVisible} viewabilityConfig={viewabilityConfig}
            refreshing={loading && Boolean(page)} onRefresh={() => void load()}
            ListEmptyComponent={!loading && page ? <Text style={[styles.empty, muted]}>아직 남긴 글이 없어요.</Text> : null}
            ListFooterComponent={page?.nextCursor ? <Pressable accessibilityRole="button" disabled={loadingMore || loading} onPress={() => void load(page.nextCursor!)} style={styles.action}>
              <Text style={primaryText}>{loadingMore ? '불러오는 중…' : '이전 글 더 보기'}</Text></Pressable> : null}
            renderItem={({ item }) => <View style={[styles.entry, { borderBottomColor: palette.separator }]}>
              <Pressable accessibilityRole="button" accessibilityLabel={`${item.authorNickname} 프로필 보기`} onPress={() => void openAuthor(item.id)} style={styles.author}>
                <AvatarPortrait avatar={item.authorAvatar} clothing={clothingArtForId(item.authorAvatarClothingId)} size={48} animated={false} />
                <View style={{ flex: 1 }}><Text style={[styles.name, text]}>{item.authorNickname}{item.mine ? ' · 나' : ''}</Text>
                  <Text style={[styles.date, muted]}>{new Date(item.createdAt).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })}{item.unread ? ' · 새 글' : ''}</Text></View>
              </Pressable>
              <Text selectable style={[styles.body, text]}>{item.message}</Text>
              <View style={styles.entryActions}>
                {own || item.mine ? <Pressable accessibilityRole="button" disabled={busy} accessibilityLabel={`${item.authorNickname}의 글 삭제`} onPress={() => setConfirmation({ entry: item, kind: 'remove' })} style={styles.smallButton}><Text style={primaryText}>삭제</Text></Pressable> : null}
                {!item.mine ? <Pressable accessibilityRole="button" disabled={busy} accessibilityLabel={`${item.authorNickname}의 글 신고`} onPress={() => setConfirmation({ entry: item, kind: 'report' })} style={styles.smallButton}><Text style={muted}>신고</Text></Pressable> : null}
              </View>
            </View>} />
          {readError ? <Pressable accessibilityRole="button" onPress={() => readVisible.current()} style={styles.action}><Text style={{ color: palette.error }}>읽음 표시를 저장하지 못했어요 · 다시 시도</Text></Pressable> : null}
          {error ? <View><Text accessibilityRole="alert" style={[styles.body, { color: palette.error }]}>{error}</Text>
            {!page ? <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.action}><Text style={primaryText}>다시 불러오기</Text></Pressable> : null}</View> : null}
          {notice ? <Text accessibilityLiveRegion="polite" style={[styles.body, { color: palette.success }]}>{notice}</Text> : null}
          {confirmation ? <View style={[styles.confirmation, { backgroundColor: palette.errorContainer }]}>
            <Text style={[styles.body, { color: palette.onErrorContainer }]}>{confirmation.kind === 'remove' ? '이 글을 삭제할까요?' : '이 글을 신고할까요?'}</Text>
            <View style={styles.actions}><Pressable accessibilityRole="button" disabled={busy} onPress={() => setConfirmation(undefined)} style={styles.action}><Text style={text}>취소</Text></Pressable>
              <Pressable accessibilityRole="button" disabled={busy} onPress={() => void confirmAction()} style={styles.action}><Text style={{ color: palette.error }}>{confirmation.kind === 'remove' ? '삭제 확인' : '신고 확인'}</Text></Pressable></View>
          </View> : null}
          {!own ? <View style={[styles.composer, { borderTopColor: palette.separator }]}>
            <TextInput accessibilityLabel="방명록 글" placeholder="이 방에 글을 남겨 주세요" placeholderTextColor={palette.secondaryLabel}
              value={message} editable={!busy} multiline onChangeText={(value) => setMessage(Array.from(value).slice(0, 300).join(''))}
              style={[styles.input, { color: palette.label, backgroundColor: palette.background, borderColor: palette.separator }]} />
            <View style={styles.actions}><Text style={[styles.date, muted]}>{Array.from(message).length}/300자</Text>
              <Pressable accessibilityRole="button" disabled={busy || !message.trim()} onPress={() => void write()}
                style={[styles.action, { backgroundColor: palette.primary, opacity: busy || !message.trim() ? .5 : 1 }]}>
                <Text style={{ color: palette.onPrimary, fontWeight: '700' }}>{busy ? '처리 중…' : '글 남기기'}</Text>
              </Pressable></View>
            <Text style={[styles.date, muted]}>같은 방 첫 글은 하루 5P · 방명록 보상은 하루 최대 25P</Text>
          </View> : null}
        </>}
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

export function GuestbookUnreadDot() {
  return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.unreadDot} />;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#102C3AB8', justifyContent: 'center', padding: 18 },
  dialog: { width: '100%', maxWidth: 460, alignSelf: 'center', borderRadius: 24, padding: 16, gap: 8, flexShrink: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 }, title: { fontSize: 20, fontWeight: '800', flexShrink: 1 },
  smallButton: { minWidth: 48, minHeight: 48, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
  body: { fontSize: 14, lineHeight: 21 }, list: { minHeight: 96, flexGrow: 0, flexShrink: 1 },
  loader: { padding: 24 }, empty: { paddingVertical: 26, textAlign: 'center' },
  entry: { borderBottomWidth: 1, paddingVertical: 8, gap: 6 }, author: { minHeight: 48, flexDirection: 'row', gap: 10, alignItems: 'center' },
  name: { fontSize: 15, fontWeight: '700' }, date: { fontSize: 12, lineHeight: 18 },
  entryActions: { flexDirection: 'row', justifyContent: 'flex-end' }, actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  action: { minHeight: 48, minWidth: 80, paddingHorizontal: 14, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  composer: { paddingTop: 12, borderTopWidth: 1, gap: 6 }, input: { borderWidth: 1, borderRadius: 14, minHeight: 72, maxHeight: 116, padding: 12, textAlignVertical: 'top', fontSize: 15 },
  confirmation: { borderRadius: 14, padding: 12, gap: 8 }, profile: { alignItems: 'center', gap: 12, paddingBottom: 16 },
  information: { alignSelf: 'stretch', borderWidth: 1, borderRadius: 14, padding: 14, gap: 8 },
  unreadDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#FF303F', shadowColor: '#FF303F', shadowOpacity: .8, shadowRadius: 5, elevation: 4 },
});
