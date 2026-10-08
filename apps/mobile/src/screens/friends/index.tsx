import { getAppPackageId } from '@/config/app-identity';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Pressable, RefreshControl, Share, StyleSheet, Text, TextInput, View, useColorScheme, useWindowDimensions, type ScrollViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AccountCredential } from '@/auth/account-credential';
import { createScanGate } from '@/commerce/claim-code';
import { useDiscovery } from '@/discovery/discovery-provider';
import { ClaimQr } from '@/commerce/claim-qr';
import {
  formatFriendCode,
  friendCodeAccessibilityLabel,
  friendCodeProblemMessage,
  friendLink,
  friendLinkProblemMessage,
  friendShareMessage,
  parseScannedFriendCode,
  validateFriendCode,
} from '@/friends/code';
import { FriendsApiError, MAX_INTRO_LENGTH, createFriendsApiClient, friendsErrorMessage, replyNeedsRefresh } from '@/friends/friends-api';
import { buildRankingRows, checkNicknameDraft, rankingNote, rowAccessibilityLabel, type RankingRow } from '@/friends/friends-model';
import { createHeldFriendCode } from '@/friends/held-friend-code';
import { linkVariantFor } from '@/friends/link';
import { consumePendingFriendCode, consumePendingFriendProblem } from '@/friends/pending-friend-link';
import { useFriends } from '@/friends/use-friends';
import { useTabBarClearance } from '@/navigation/use-tab-bar-clearance';
import { createBadgeApiClient } from '@/gamification/badge-api';
import { explorerRank, medalCopy, tierName } from '@/gamification/badge-rules';
import { useBadgeBook } from '@/gamification/use-badge-book';
import { useExperience } from '@/experience/use-experience';
import { createSocialApiClient, createSocialRequestId, socialErrorMessage, type SocialFriend, type SocialSnapshot } from '@/social/social-api';
import { useSocial } from '@/social/use-social';
import { useSocialPush } from '@/social/push-runtime';
import { colorsForScheme } from '@/theme/palette';
import { worldForScheme } from '@/theme/world';
import { BounceButton } from '@/ui/bounce-button';
import { canUseCamera } from '@/ui/can-use-camera';
import { FloatingCard } from '@/ui/floating-card';
import { Mascot } from '@/ui/mascot';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';
import { Stagger } from '@/ui/stagger';
import { StateScene } from '@/ui/state-scene';

import { TierDots } from './tier-dots';
import { useFriendsStyles } from './use-friends-styles';

export const FRIENDS_TITLE = '친구';

const NOT_A_FRIEND_QR = '친구 코드 QR이 아니에요. 친구 화면의 QR을 다시 비춰 주세요.';
const OWN_CODE_NOTICE = '내 친구 코드예요.';
const ROTATE_CONFIRM = '새 코드를 만들면 예전 코드로는 더 이상 추가할 수 없어요. 지금 친구는 그대로예요.';

type Notice = { tone: 'success' | 'error'; text: string };

export function FriendsScreen({
  apiUrl,
  credential,
  onSessionInvalid,
  header,
  profileOnly = false,
}: {
  apiUrl: string;
  credential: AccountCredential;
  onSessionInvalid: () => Promise<void>;
  /** BackHeader (sky art included); drawn first inside the scroll content so it scrolls away with the page — the
   *  route builds it, same as account-settings, now that this screen is reached through a hidden tab, not the bar. */
  header: ReactNode;
  profileOnly?: boolean;
}) {
  const clearance = useTabBarClearance();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const scheme = useColorScheme();
  const palette = colorsForScheme(scheme);
  const world = worldForScheme(scheme);
  const styles = useFriendsStyles();
  const { width } = useWindowDimensions();
  const variant = linkVariantFor(getAppPackageId());
  const api = useMemo(
    () => createFriendsApiClient({ apiUrl, credential, onSessionInvalid }),
    [apiUrl, credential, onSessionInvalid],
  );
  const socialApi = useMemo(
    () => createSocialApiClient({ apiUrl, credential, onSessionInvalid }),
    [apiUrl, credential, onSessionInvalid],
  );
  const friends = useFriends(api);
  const social = useSocial(socialApi);
  const push = useSocialPush();
  const { setOptIn } = useDiscovery();
  const { snapshot, refreshQuietly, applyMe } = friends;
  const { refreshQuietly: refreshSocialQuietly } = social;
  const myCode = snapshot?.me.code;

  const [refreshing, setRefreshing] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [friendQuery, setFriendQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [addNotice, setAddNotice] = useState<Notice>();
  const [scanning, setScanning] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [nicknameBusy, setNicknameBusy] = useState(false);
  const [nicknameError, setNicknameError] = useState<string>();
  const [editingIntro, setEditingIntro] = useState(false);
  const [introDraft, setIntroDraft] = useState('');
  const [introBusy, setIntroBusy] = useState(false);
  const [introError, setIntroError] = useState<string>();
  const [rotating, setRotating] = useState(false);
  const [cardNotice, setCardNotice] = useState<Notice>();
  const [, requestCameraPermission] = useCameraPermissions();
  const scanGate = useRef(createScanGate()).current;
  // Taps can land twice before a state change renders, so each guarded action reads a ref, not React state.
  const addingNow = useRef(false);
  const rotatingNow = useRef(false);
  const nicknameBusyNow = useRef(false);
  const introBusyNow = useRef(false);
  // Read through a ref so the focus effect below is not rebuilt (and does not refetch) when my code first arrives.
  const myCodeRef = useRef<string | undefined>(undefined);
  useEffect(() => { myCodeRef.current = myCode; }, [myCode]);
  // A code that arrives by link waits here while my own snapshot loads (see held-friend-code.ts).
  const [heldCode] = useState(createHeldFriendCode);
  const statusRef = useRef(friends.status);
  const refreshFriendsAndSocial = useCallback(
    () => Promise.allSettled([refreshQuietly(), refreshSocialQuietly()]),
    [refreshQuietly, refreshSocialQuietly],
  );

  const addFriend = useCallback(async (code: string) => {
    if (addingNow.current) return;
    if (code === myCodeRef.current) {
      setAddNotice({ tone: 'error', text: friendsErrorMessage(new FriendsApiError(409, 'FRIEND_SELF')) });
      return;
    }
    addingNow.current = true;
    setAdding(true);
    setAddNotice(undefined);
    try {
      const result = await api.addFriend(code);
      // Adding a friend is the person's own opt-in to friends and mail (Issue #412): the Home buttons and the mail icon stay.
      void setOptIn({ social: true });
      setCodeInput('');
      setScanning(false);
      setAddNotice({
        tone: 'success',
        text: result.created ? `${result.friend.nickname} 님과 친구가 되었어요.` : `${result.friend.nickname} 님은 이미 친구예요.`,
      });
      await refreshFriendsAndSocial();
    } catch (error) {
      setAddNotice({ tone: 'error', text: friendsErrorMessage(error) });
    } finally {
      addingNow.current = false;
      setAdding(false);
    }
  }, [api, refreshFriendsAndSocial, setAddNotice, setCodeInput, setOptIn, setScanning]);

  // A code that arrived by QR or link is asked about first: adding shares my passport with its owner as well.
  // My own code is only said so: there is nothing to add. A link opens this tab before my code is loaded, so it goes through
  // receiveLinkCode, which waits for it (the server refuses adding myself anyway if the load fails).
  const confirmAdd = useCallback((code: string) => {
    if (code === myCodeRef.current) {
      setCodeInput('');
      setAddNotice({ tone: 'error', text: OWN_CODE_NOTICE });
      return;
    }
    setCodeInput(code);
    // A code that was only put here for the question does not stay in the box when the question is turned down.
    const clearCode = () => setCodeInput((current) => (current === code ? '' : current));
    Alert.alert(
      '이 코드로 친구를 추가할까요?',
      `${formatFriendCode(code)}\n추가하면 서로의 메달·배지 수·가본 가게 이름이 보여요. 방문 날짜는 보이지 않아요.`,
      [
        { text: '취소', style: 'cancel', onPress: clearCode },
        { text: '추가', onPress: () => void addFriend(code) },
      ],
      { cancelable: true, onDismiss: clearCode },
    );
  }, [addFriend, setCodeInput, setAddNotice]);

  const receiveLinkCode = useCallback((code: string) => {
    const ready = heldCode.arrive(code, statusRef.current);
    if (ready !== undefined) confirmAdd(ready);
  }, [confirmAdd, heldCode]);

  // Runs after the effect above that stores my code, so a released code is judged against it.
  useEffect(() => {
    statusRef.current = friends.status;
    const waiting = heldCode.settle(friends.status);
    if (waiting !== undefined) confirmAdd(waiting);
  }, [friends.status, heldCode, confirmAdd]);
  // A code still waiting when the tab is left is forgotten, so it cannot open a dialog over another screen.
  useFocusEffect(useCallback(() => () => heldCode.clear(), [heldCode]));

  const focusCount = useRef(0);
  useFocusEffect(useCallback(() => {
    focusCount.current += 1;
    // A friend link opened before sign-in waits in memory; the first time this tab is focused with an account it is asked about.
    const pending = consumePendingFriendCode();
    // A friend link that could not be used waits the same way and is said once, in one line.
    const problem = consumePendingFriendProblem();
    if (problem) setAddNotice({ tone: 'error', text: friendLinkProblemMessage(problem) });
    if (pending) receiveLinkCode(pending);
    else if (focusCount.current > 1) void refreshFriendsAndSocial();
    // An add result belongs to the visit it was made on; after a friend is removed elsewhere it would read as stale.
    return () => {
      setScanning(false);
      setAddNotice(undefined);
    };
  }, [receiveLinkCode, refreshFriendsAndSocial, setAddNotice, setScanning]));

  function submitTyped() {
    const checked = validateFriendCode(codeInput);
    if (!checked.ok) {
      setAddNotice({ tone: 'error', text: friendCodeProblemMessage(checked.reason) });
      return;
    }
    void addFriend(checked.code);
  }

  async function startScan() {
    const permission = await requestCameraPermission();
    if (!permission.granted) {
      setAddNotice({ tone: 'error', text: '카메라 권한이 없어 촬영할 수 없어요. 친구 코드를 아래 칸에 직접 입력해 주세요.' });
      return;
    }
    scanGate.reset();
    setAddNotice(undefined);
    setScanning(true);
  }

  function handleScanned(raw: string) {
    const scanned = parseScannedFriendCode(raw, variant);
    if (!scanned.ok) {
      // The camera reports the same wrong QR many times a second; keep the state identical.
      const text = scanned.reason === 'OTHER_APP' ? friendLinkProblemMessage('OTHER_APP') : NOT_A_FRIEND_QR;
      setAddNotice((current) => (current?.text === text ? current : { tone: 'error', text }));
      return;
    }
    if (!scanGate.accept(scanned.code)) return;
    setScanning(false);
    confirmAdd(scanned.code);
  }

  async function saveNickname() {
    if (nicknameBusyNow.current) return;
    const checked = checkNicknameDraft(draft);
    if (!checked.ok) {
      setNicknameError(checked.message);
      return;
    }
    nicknameBusyNow.current = true;
    setNicknameBusy(true);
    setNicknameError(undefined);
    try {
      applyMe({ nickname: await api.setNickname(checked.nickname) });
      setEditing(false);
    } catch (error) {
      setNicknameError(friendsErrorMessage(error));
      // The server may have saved a nickname this reply could not show: never leave the old one on screen.
      if (replyNeedsRefresh(error)) void refreshQuietly();
    } finally {
      nicknameBusyNow.current = false;
      setNicknameBusy(false);
    }
  }

  async function saveIntro() {
    if (introBusyNow.current) return;
    const intro = introDraft.trim();
    if (Array.from(intro).length > MAX_INTRO_LENGTH) {
      setIntroError('한 줄 소개는 30자 이하로 입력해 주세요.');
      return;
    }
    introBusyNow.current = true;
    setIntroBusy(true);
    setIntroError(undefined);
    try {
      applyMe({ intro: await api.setIntro(intro) });
      setEditingIntro(false);
    } catch (error) {
      setIntroError(friendsErrorMessage(error));
      if (replyNeedsRefresh(error)) void refreshQuietly();
    } finally {
      introBusyNow.current = false;
      setIntroBusy(false);
    }
  }

  async function rotateCode() {
    if (rotatingNow.current) return;
    rotatingNow.current = true;
    setRotating(true);
    setCardNotice(undefined);
    try {
      applyMe({ code: await api.rotateCode() });
      setCardNotice({ tone: 'success', text: '새 코드를 만들었어요. 예전 코드로는 더 이상 추가할 수 없어요.' });
    } catch (error) {
      setCardNotice({ tone: 'error', text: friendsErrorMessage(error) });
      // The server may have rotated to a code this reply could not show: never leave the old code (and its QR) on screen.
      if (replyNeedsRefresh(error)) void refreshQuietly();
    } finally {
      rotatingNow.current = false;
      setRotating(false);
    }
  }

  function confirmRotate() {
    Alert.alert('코드 바꾸기', ROTATE_CONFIRM, [
      { text: '취소', style: 'cancel' },
      { text: '새 코드 만들기', style: 'destructive', onPress: () => void rotateCode() },
    ], { cancelable: true });
  }

  async function shareCode(code: string) {
    setCardNotice(undefined);
    try {
      await Share.share({ message: friendShareMessage(code, variant) });
    } catch {
      setCardNotice({ tone: 'error', text: '공유창을 열지 못했어요. 코드를 직접 알려 주세요.' });
    }
  }

  async function refresh() {
    setRefreshing(true);
    try {
      await refreshFriendsAndSocial();
    } finally {
      setRefreshing(false);
    }
  }

  const sky = (body: ReactNode, refreshControl?: ScrollViewProps['refreshControl']) => (
    <SkyBackdrop>
      <SkyScrollView
        header={header}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: clearance }]}
        refreshControl={refreshControl}
      >
        {body}
      </SkyScrollView>
    </SkyBackdrop>
  );

  if (!snapshot) {
    return friends.status === 'error'
      ? sky(
        <StateScene
          kind="error"
          title="친구를 불러오지 못했어요"
          body={friendsErrorMessage(friends.error)}
          action={{ label: '다시 불러오기', onPress: () => { void friends.retry(); }, disabled: friends.retrying }}
        />,
      )
      : sky(<StateScene kind="loading" title="친구를 불러오는 중" />);
  }

  const { me } = snapshot;
  const rows = buildRankingRows(snapshot);
  const visibleRows = friendQuery.trim()
    ? rows.filter((row) => row.friendshipId && row.nickname.toLocaleLowerCase().includes(friendQuery.trim().toLocaleLowerCase()))
    : rows;
  const qrSize = Math.min(220, Math.max(160, width - 2 * 20 - 2 * 18 - 8));

  const profileCard = (
      <Stagger index={profileOnly ? 0 : 1}>
        <FloatingCard style={styles.card}>
          {profileOnly ? <View style={{ alignItems: 'center' }}><Mascot pose="sleep" size={180} /><Text accessibilityRole="header" style={styles.sectionTitle}>내 프로필</Text></View> : null}
          <Text style={styles.eyebrow}>{profileOnly ? '이름과 한 줄 소개' : '내 친구 코드'}</Text>
          {editing ? (
            <View style={{ gap: 8 }}>
              <Text style={styles.inputLabel}>별명</Text>
              <TextInput
                value={draft}
                onChangeText={(text) => { setDraft(text); setNicknameError(undefined); }}
                autoFocus
                autoCorrect={false}
                accessibilityLabel="별명"
                placeholder="별명 (12자까지)"
                placeholderTextColor={world.cardMuted}
                returnKeyType="done"
                onSubmitEditing={() => void saveNickname()}
                style={styles.input}
              />
              {nicknameError ? <Text accessibilityLiveRegion="polite" style={styles.errorMessage}>{nicknameError}</Text> : null}
              <View style={styles.actions}>
                <Pressable
                  accessibilityRole="button"
                  disabled={nicknameBusy}
                  onPress={() => void saveNickname()}
                  style={[styles.primaryButton, styles.action, nicknameBusy && styles.disabled]}
                >
                  <Text style={styles.primaryButtonText}>{nicknameBusy ? '저장 중…' : '저장'}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={nicknameBusy}
                  onPress={() => { setEditing(false); setNicknameError(undefined); }}
                  style={[styles.outlineButton, styles.action, nicknameBusy && styles.disabled]}
                >
                  <Text style={styles.outlineButtonText}>취소</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.nicknameRow}>
              <Text selectable maxFontSizeMultiplier={1.6} style={styles.nickname}>{me.nickname}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="별명 바꾸기"
                onPress={() => { setDraft(me.nickname); setNicknameError(undefined); setEditing(true); }}
                style={styles.outlineButton}
              >
                <Text style={styles.outlineButtonText}>바꾸기</Text>
              </Pressable>
            </View>
          )}

          {editingIntro ? (
            <View style={{ gap: 8 }}>
              <Text style={styles.inputLabel}>한 줄 소개</Text>
              <TextInput
                value={introDraft}
                onChangeText={(text) => { setIntroDraft(text); setIntroError(undefined); }}
                accessibilityLabel="한 줄 소개"
                placeholder="나를 소개해 주세요"
                placeholderTextColor={world.cardMuted}
                returnKeyType="done"
                onSubmitEditing={() => void saveIntro()}
                style={styles.input}
              />
              <Text style={styles.note}>{Array.from(introDraft).length}/{MAX_INTRO_LENGTH}</Text>
              {introError ? <Text accessibilityLiveRegion="polite" style={styles.errorMessage}>{introError}</Text> : null}
              <View style={styles.actions}>
                <Pressable accessibilityRole="button" disabled={introBusy} onPress={() => void saveIntro()} style={[styles.primaryButton, styles.action, introBusy && styles.disabled]}><Text style={styles.primaryButtonText}>{introBusy ? '저장 중…' : '저장'}</Text></Pressable>
                <Pressable accessibilityRole="button" disabled={introBusy} onPress={() => setEditingIntro(false)} style={[styles.outlineButton, styles.action, introBusy && styles.disabled]}><Text style={styles.outlineButtonText}>취소</Text></Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.nicknameRow}>
              <Text selectable style={styles.introText}>{me.intro || '한 줄 소개를 입력해 주세요.'}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="한 줄 소개 편집" onPress={() => { setIntroDraft(me.intro ?? ''); setIntroError(undefined); setEditingIntro(true); }} style={styles.outlineButton}><Text style={styles.outlineButtonText}>편집</Text></Pressable>
            </View>
          )}

          {!profileOnly ? <><View style={styles.codeBlock}>
            <Text
              selectable
              accessibilityLabel={friendCodeAccessibilityLabel(me.code)}
              adjustsFontSizeToFit
              numberOfLines={1}
              maxFontSizeMultiplier={1.3}
              style={styles.code}
            >
              {formatFriendCode(me.code)}
            </Text>
          </View>
          <View style={styles.qrBox}>
            <ClaimQr
              code={friendLink(me.code, variant)}
              size={qrSize}
              accessibilityLabel="내 친구 코드 QR. 친구가 촬영하면 나를 추가할 수 있어요"
            />
          </View>
          <Text style={styles.note}>이 코드를 받은 사람이 추가하면 서로의 여권이 보여요.</Text>
          {cardNotice ? (
            <Text accessibilityLiveRegion="polite" style={cardNotice.tone === 'success' ? styles.successMessage : styles.errorMessage}>{cardNotice.text}</Text>
          ) : null}
          <View style={styles.actions}>
            <View style={styles.action}><BounceButton label="코드 공유" onPress={() => void shareCode(me.code)} /></View>
            <View style={styles.action}><BounceButton label={rotating ? '바꾸는 중…' : '코드 바꾸기'} variant="secondary" disabled={rotating} onPress={confirmRotate} /></View>
          </View></> : null}
        </FloatingCard>
      </Stagger>
  );

  const friendList = (
      <Stagger index={0}>
        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>친구 순위</Text>
          <Text style={styles.sectionNote}>{rankingNote(me.asOf)}</Text>
          {social.snapshot ? <Text style={styles.sectionNote}>오늘 우정 보내기 {social.snapshot.friendshipGift.sendRemaining}/5 · 우정 보상 남은 한도 {social.snapshot.friendshipGift.rewardRemainingToday}</Text> : null}
          {snapshot.friends.length > 0 ? <TextInput value={friendQuery} onChangeText={setFriendQuery} accessibilityLabel="친구 검색" placeholder="친구 이름 찾기" placeholderTextColor={world.cardMuted} style={styles.input} /> : null}
          <View style={styles.sectionBody}>
            {snapshot.friends.length === 0 ? (
              <StateScene kind="empty" title="아직 친구가 없어요" body="친구 코드를 주고받으면 여기에 순위가 생겨요." />
            ) : visibleRows.length === 0 ? (
              <StateScene kind="empty" title="검색 결과가 없어요" body="다른 이름으로 찾아보세요." />
            ) : (
              visibleRows.map((row) => (
                <View key={row.key} style={{ gap: 8 }}>
                  <RankingRowCard
                  key={row.key}
                  row={row}
                  onPress={row.friendshipId
                    ? () => router.push({ pathname: '/friends/[friendshipId]', params: { friendshipId: row.friendshipId! } })
                    : undefined}
                />
                  {row.friendshipId ? (
                    <FriendSocialActions
                      friend={social.snapshot?.friends.find((item) => item.friendshipId === row.friendshipId)}
                      social={social.snapshot}
                      onRefresh={() => { void Promise.allSettled([social.refreshQuietly(), refreshQuietly()]); }}
                      socialApi={socialApi}
                    />
                  ) : null}
                </View>
              ))
            )}
          </View>
        </View>
      </Stagger>
  );

  if (profileOnly) return sky(<>
    {profileCard}
    <ProfilePassport apiUrl={apiUrl} credential={credential} onSessionInvalid={onSessionInvalid} friendCount={snapshot.friends.length} />
    <FloatingCard style={styles.card}>
      <BounceButton label="마이룸 꾸미기" onPress={() => router.push('/studio')} />
      <BounceButton label="친구 보기" variant="secondary" onPress={() => router.push('/friends')} />
    </FloatingCard>
  </>);

  return sky(
    <>
      {friendList}
      {profileCard}

      <Stagger index={1}>
        <FloatingCard style={styles.card}>
          <Text accessibilityRole="header" style={styles.eyebrow}>친구 추가</Text>
          {canUseCamera && scanning ? (
            <View style={styles.camera}>
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={({ data }) => handleScanned(data)}
              />
            </View>
          ) : null}
          <Text style={styles.inputLabel}>친구 코드</Text>
          <TextInput
            value={codeInput}
            onChangeText={(text) => { setCodeInput(text.toUpperCase()); setAddNotice(undefined); }}
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect={false}
            spellCheck={false}
            importantForAutofill="no"
            maxLength={24}
            accessibilityLabel="친구 코드"
            placeholder="8자리 코드"
            placeholderTextColor={world.cardMuted}
            returnKeyType="done"
            onSubmitEditing={submitTyped}
            style={[styles.input, styles.codeInput]}
          />
          {addNotice ? (
            <Text accessibilityLiveRegion="polite" style={addNotice.tone === 'success' ? styles.successMessage : styles.errorMessage}>{addNotice.text}</Text>
          ) : null}
          <View style={styles.actions}>
            <View style={styles.action}><BounceButton label={adding ? '추가하는 중…' : '추가'} disabled={adding} onPress={submitTyped} /></View>
            {canUseCamera ? (
              <View style={styles.action}>
                <BounceButton
                  label={scanning ? '촬영 닫기' : 'QR 촬영'}
                  variant="secondary"
                  disabled={adding}
                  onPress={scanning ? () => setScanning(false) : () => void startScan()}
                />
              </View>
            ) : null}
          </View>
        </FloatingCard>
      </Stagger>

      <Stagger index={2}>
        <FloatingCard style={styles.card}>
          <Text accessibilityRole="header" style={styles.eyebrow}>우편 알림</Text>
          <Text style={styles.note}>{push.state.message}</Text>
          <View style={styles.actions}>
            <View style={styles.action}>
              <BounceButton
                label={push.state.status === 'registered' ? '알림 켜짐' : '우편 알림 켜기'}
                variant="secondary"
                disabled={!push.state.canAskPermission && push.state.status !== 'error'}
                onPress={() => { void push.requestPermissionAndBind(); }}
              />
            </View>
          </View>
        </FloatingCard>
      </Stagger>

    </>,
    <RefreshControl refreshing={refreshing} onRefresh={refresh} progressViewOffset={insets.top} colors={[palette.primary]} />,
  );
}

function FriendSocialActions({
  friend,
  social,
  socialApi,
  onRefresh,
}: {
  friend?: SocialFriend;
  social?: SocialSnapshot;
  socialApi: ReturnType<typeof createSocialApiClient>;
  onRefresh: () => void;
}) {
  const router = useRouter();
  const styles = useFriendsStyles();
  const [busy, setBusy] = useState<'send' | 'receive'>();
  const [notice, setNotice] = useState<string>();
  if (!friend) return null;
  const target = friend;

  async function sendGift() {
    if (busy) return;
    setBusy('send');
    setNotice(undefined);
    try {
      const result = await socialApi.sendFriendshipGift({ friendshipId: target.friendshipId, requestId: createSocialRequestId('friendship-send') });
      setNotice(result.senderReward > 0 ? `우정을 보냈어요. 마일리지 ${result.senderReward}을 받았어요.` : '우정을 보냈어요. 오늘 우정 보상 한도는 모두 채웠어요.');
      onRefresh();
    } catch (caught) {
      setNotice(socialErrorMessage(caught));
    } finally {
      setBusy(undefined);
    }
  }

  async function receiveGift() {
    if (busy || !target.gift.pendingGiftId) return;
    setBusy('receive');
    setNotice(undefined);
    try {
      const result = await socialApi.receiveFriendshipGift({ giftId: target.gift.pendingGiftId, requestId: createSocialRequestId('friendship-receive') });
      setNotice(result.receiverReward > 0 ? `우정을 받았어요. 마일리지 ${result.receiverReward}을 받았어요.` : '우정을 받았어요. 오늘 우정 보상 한도는 모두 채웠어요.');
      onRefresh();
    } catch (caught) {
      setNotice(socialErrorMessage(caught));
    } finally {
      setBusy(undefined);
    }
  }

  const sendDisabled = !target.gift.canSend || (social?.friendshipGift.sendRemaining ?? 0) <= 0 || busy !== undefined;
  const receiveDisabled = !target.gift.canReceive || !target.gift.pendingGiftId || busy !== undefined;
  const pendingCopy = friendshipPendingCopy(target.gift.pendingDirection);

  return (
    <FloatingCard style={styles.card}>
      <View style={{ gap: 8 }}>
        {pendingCopy ? <Text style={styles.note}>{pendingCopy}</Text> : null}
        <View style={styles.actions}>
          <View style={styles.action}>
            <BounceButton label={busy === 'send' ? '보내는 중…' : '우정 보내기'} disabled={sendDisabled} onPress={() => { void sendGift(); }} />
          </View>
          <View style={styles.action}>
            <BounceButton label={busy === 'receive' ? '받는 중…' : '우정 받기'} variant="secondary" disabled={receiveDisabled} onPress={() => { void receiveGift(); }} />
          </View>
        </View>
        <View style={styles.actions}>
          <View style={styles.action}>
            <BounceButton label="쪽지" variant="secondary" onPress={() => router.push({ pathname: '/friends/[friendshipId]/message', params: { friendshipId: target.friendshipId } })} />
          </View>
          <View style={styles.action}>
            <BounceButton label="같이 밥 먹기" variant="secondary" onPress={() => router.push({ pathname: '/friends/[friendshipId]/meal-invite', params: { friendshipId: target.friendshipId } })} />
          </View>
        </View>
        {notice ? <Text accessibilityLiveRegion="polite" style={notice.includes('못') || notice.includes('만료') ? styles.errorMessage : styles.successMessage}>{notice}</Text> : null}
      </View>
    </FloatingCard>
  );
}

function friendshipPendingCopy(direction: SocialFriend['gift']['pendingDirection']): string | undefined {
  switch (direction) {
    case 'SENT':
      return '친구가 아직 받지 않았어요.';
    case 'RECEIVED':
      return '받을 우정이 있어요.';
    case null:
      return undefined;
  }
}

function RankingRowCard({ row, onPress }: { row: RankingRow; onPress?: () => void }) {
  const styles = useFriendsStyles();
  const content = (
    <>
      <View accessible={false} style={styles.rankBadge}>
        <Text maxFontSizeMultiplier={1.4} style={styles.rankBadgeText}>{row.rank}</Text>
      </View>
      <View style={styles.rowCopy}>
        <View style={styles.rowNameLine}>
          <Text maxFontSizeMultiplier={1.6} style={styles.rowName}>{row.nickname}</Text>
          {row.isMe ? <View style={styles.meChip}><Text style={styles.meChipText}>나</Text></View> : null}
        </View>
        <TierDots medals={row.medals} />
        <Text style={styles.rowMeta}>배지 {row.badges.earned}/{row.badges.total}</Text>
      </View>
      {onPress ? <Text accessible={false} style={styles.chevron}>›</Text> : null}
    </>
  );
  if (onPress) {
    return (
      <FloatingCard
        onPress={onPress}
        accessibilityLabel={rowAccessibilityLabel(row)}
        accessibilityHint="친구 여권 보기"
        style={styles.rankRow}
      >
        {content}
      </FloatingCard>
    );
  }
  return (
    <FloatingCard style={[styles.rankRow, styles.rankRowMe]}>
      <View accessible accessibilityLabel={rowAccessibilityLabel(row)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
        {content}
      </View>
    </FloatingCard>
  );
}

function ProfilePassport({ apiUrl, credential, onSessionInvalid, friendCount }: {
  apiUrl: string;
  credential: AccountCredential;
  onSessionInvalid: () => Promise<void>;
  friendCount: number;
}) {
  const router = useRouter();
  const styles = useFriendsStyles();
  const api = useMemo(() => createBadgeApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const badges = useBadgeBook(api);
  const experience = useExperience(apiUrl, credential, onSessionInvalid);
  return <FloatingCard style={styles.card}>
    <Text accessibilityRole="header" style={styles.sectionTitle}>탐험 여권</Text>
    {badges.status === 'loading' ? <StateScene kind="loading" title="탐험 기록을 불러오는 중" /> : null}
    {badges.status === 'error' ? <StateScene kind="error" title="탐험 기록을 불러오지 못했어요" action={{ label: '다시 불러오기', onPress: () => { void badges.retry(); }, disabled: badges.retrying }} /> : null}
    {badges.book ? <>
      <Text style={styles.passportRank}>{explorerRank(badges.book.earnedTiers).title} · 배지 {badges.book.earnedTiers}/9 · 친구 {friendCount}명</Text>
      {experience.snapshot ? <Text style={styles.note}>대표 배지 {experience.snapshot.catalog.badges.find((badge) => badge.id === experience.snapshot?.profile.badgeId)?.name ?? '미설정'} · 대표 코인 {experience.snapshot.profile.coinEntitlementId ? '전시 중' : '미설정'}</Text> : null}
      {experience.error ? <Text accessibilityLiveRegion="polite" style={styles.errorMessage}>{experience.error}</Text> : null}
      {badges.book.medals.map((medal) => <View key={medal.kind} style={styles.rankRow}>
        <View style={styles.rowCopy}>
          <Text style={styles.rowName}>{medalCopy(medal.kind).name} · {tierName(medal.tier)}</Text>
          <Text style={styles.rowMeta}>{medalCopy(medal.kind).measure(medal.value)}{medal.tier < 3 ? ` / 다음 단계 ${medal.thresholds[Math.min(medal.tier, 2)]}` : ''}</Text>
        </View>
      </View>)}
      <BounceButton label="도감과 방문 기록 보기" variant="secondary" onPress={() => router.push('/collection')} />
    </> : null}
  </FloatingCard>;
}
