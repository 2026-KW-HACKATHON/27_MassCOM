import { useRouter } from 'expo-router';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Pressable, RefreshControl, Text, View, useColorScheme, useWindowDimensions, type ScrollViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AccountCredential } from '@/auth/account-credential';
import { FriendsApiError, createFriendsApiClient, friendsErrorMessage, type Friend } from '@/friends/friends-api';
import { passportAsOfNote, visitedShopSummary } from '@/friends/friends-model';
import { useFriends } from '@/friends/use-friends';
import { Medallion, medallionSizes } from '@/gamification/medallion';
import { TierChip } from '@/gamification/medal-shelf';
import { medalCopy, shouldStackTrio, tierName } from '@/gamification/badge-rules';
import { useGamificationTheme } from '@/gamification/theme';
import { stampColumnCount, stampGlyph } from '@/screens/collection/collection-stamps';
import { stampTilt } from '@/motion/timing';
import { uiMetrics } from '@/theme/ui-metrics';
import { worldForScheme } from '@/theme/world';
import { BackHeader } from '@/ui/back-header';
import { FloatingCard } from '@/ui/floating-card';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';
import { Stagger } from '@/ui/stagger';
import { StateScene } from '@/ui/state-scene';
import { useUiStyles } from '@/ui/use-ui-styles';

import { useFriendsStyles } from './use-friends-styles';

// The block is kept per account, not per code: it holds for every code of mine, but not for someone who signs in with another
// account. Changing my code is what stops a friend who already knows the current one, so it is offered right after unfriending.
export const REMOVE_CONFIRM = '끊으면 서로의 여권이 사라지고, 이 친구는 이 계정으로 나를 다시 추가할 수 없어요.';
export const ROTATE_AFTER_REMOVE_TITLE = '내 친구 코드도 바꿀까요?';
export const ROTATE_AFTER_REMOVE_BODY = '코드를 바꾸면 끊은 친구가 다른 계정으로도 지금 코드를 쓸 수 없어요. 다른 친구는 그대로예요.';
const PAGE_PADDING = 14;
const SLOT_GAP = 10;

/**
 * A friend's passport, read only: medal tiers, badges n/9 and the names of the shops they have stamped. No dates, counts or
 * coupons exist in the friend answer, so none can be shown. It takes the friend from the same list the friends tab reads.
 */
export function FriendPassportScreen({
  apiUrl,
  credential,
  onSessionInvalid,
  friendshipId,
}: {
  apiUrl: string;
  credential: AccountCredential;
  onSessionInvalid: () => Promise<void>;
  friendshipId: string;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const styles = useFriendsStyles();
  const api = useMemo(
    () => createFriendsApiClient({ apiUrl, credential, onSessionInvalid }),
    [apiUrl, credential, onSessionInvalid],
  );
  const friends = useFriends(api);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const removingNow = useRef(false);

  const leave = () => (router.canGoBack() ? router.back() : router.replace('/friends'));
  const header = <BackHeader title="친구 여권" />;
  const frame = (body: ReactNode, control?: ScrollViewProps['refreshControl']) => (
    <SkyBackdrop>
      <SkyScrollView
        header={header}
        contentContainerStyle={[styles.content, { paddingBottom: 40 + insets.bottom }]}
        refreshControl={control}
      >
        {body}
      </SkyScrollView>
    </SkyBackdrop>
  );

  const { snapshot } = friends;
  if (!snapshot) {
    return frame(friends.status === 'error' ? (
      <StateScene
        kind="error"
        title="친구 여권을 불러오지 못했어요"
        body={friendsErrorMessage(friends.error)}
        action={{ label: '다시 불러오기', onPress: () => { void friends.retry(); }, disabled: friends.retrying }}
      />
    ) : (
      <StateScene kind="loading" title="친구 여권을 펼치는 중" />
    ));
  }

  const friend = snapshot.friends.find((item) => item.friendshipId === friendshipId);
  if (!friend) {
    return frame(
      <StateScene
        kind="empty"
        title="찾을 수 없는 친구예요"
        body="이미 끊어졌거나 목록에 없는 친구예요. 친구 목록으로 돌아가 주세요."
        action={{ label: '친구 목록으로', onPress: () => router.replace('/friends') }}
      />,
    );
  }

  async function remove() {
    if (removingNow.current) return;
    removingNow.current = true;
    setRemoving(true);
    setError(undefined);
    try {
      await api.removeFriend(friendshipId);
      offerNewCode();
    } catch (caught) {
      // A friendship that is already gone is what was asked for; the list refreshes when it is shown again.
      if (caught instanceof FriendsApiError && caught.code === 'FRIEND_NOT_FOUND') {
        offerNewCode();
        return;
      }
      setError(friendsErrorMessage(caught));
    } finally {
      removingNow.current = false;
      setRemoving(false);
    }
  }

  // Asked once the friendship is gone, whichever way it ended. Every way out of the prompt goes back to the list, exactly once.
  function offerNewCode() {
    let left = false;
    const finish = () => {
      if (left) return;
      left = true;
      leave();
    };
    Alert.alert(ROTATE_AFTER_REMOVE_TITLE, ROTATE_AFTER_REMOVE_BODY, [
      { text: '그대로 두기', style: 'cancel', onPress: finish },
      { text: '코드 바꾸기', onPress: () => void rotateThenLeave(finish) },
    ], { cancelable: true, onDismiss: finish });
  }

  async function rotateThenLeave(finish: () => void) {
    try {
      await api.rotateCode();
      finish();
    } catch (caught) {
      Alert.alert('코드를 바꾸지 못했어요', `${friendsErrorMessage(caught)} 친구 탭에서 다시 바꿀 수 있어요.`, [
        { text: '확인', onPress: finish },
      ], { cancelable: true, onDismiss: finish });
    }
  }

  function confirmRemove(target: Friend) {
    Alert.alert(`${target.nickname} 님과 친구를 끊을까요?`, REMOVE_CONFIRM, [
      { text: '취소', style: 'cancel' },
      { text: '친구 끊기', style: 'destructive', onPress: () => void remove() },
    ], { cancelable: true });
  }

  async function refresh() {
    setRefreshing(true);
    try {
      await friends.refreshQuietly();
    } finally {
      setRefreshing(false);
    }
  }

  return frame(
    <>
      <Stagger index={0}>
        <FloatingCard style={styles.passportHero}>
          <Text accessibilityRole="header" maxFontSizeMultiplier={1.6} style={styles.passportNickname}>{friend.nickname}</Text>
          <Text style={styles.passportRank}>친구 순위 {friend.rank}위 · 배지 {friend.badges.earned}/{friend.badges.total}</Text>
          <Text style={styles.note}>{passportAsOfNote(snapshot.me.asOf)}</Text>
        </FloatingCard>
      </Stagger>

      <Stagger index={1}>
        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>메달</Text>
          <View style={styles.sectionBody}><FriendMedals friend={friend} /></View>
        </View>
      </Stagger>

      <Stagger index={2}>
        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>도장판</Text>
          <Text style={styles.sectionNote}>{visitedShopSummary(friend.stamps.length)} · 방문 날짜와 횟수는 보이지 않아요.</Text>
          <View style={styles.sectionBody}><FriendStampPage names={friend.stamps.map((stamp) => stamp.merchantName)} /></View>
        </View>
      </Stagger>

      <View accessibilityLiveRegion="polite">
        {error ? <Text style={styles.errorMessage}>{error}</Text> : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityHint="서로의 여권이 사라지는 것을 확인하는 창을 엽니다."
        disabled={removing}
        onPress={() => confirmRemove(friend)}
        style={[styles.dangerButton, removing && styles.disabled]}
      >
        <Text style={styles.dangerButtonText}>{removing ? '끊는 중…' : '친구 끊기'}</Text>
      </Pressable>
    </>,
    <RefreshControl refreshing={refreshing} onRefresh={refresh} progressViewOffset={insets.top} />,
  );
}

/** The three medals with their tier in words; a medal not earned is a grey coin that says 미획득. Nothing here can be pressed. */
function FriendMedals({ friend }: { friend: Friend }) {
  const styles = useFriendsStyles();
  const { medal: colors, palette } = useGamificationTheme();
  const { width, fontScale } = useWindowDimensions();
  const stacked = shouldStackTrio(width, fontScale);
  return (
    <View style={[styles.medalRow, stacked && styles.medalRowStacked]}>
      {friend.medals.map((medal) => (
        <FloatingCard key={medal.key} style={styles.medalCard}>
          <View
            accessible
            accessibilityLabel={`${medalCopy(medal.key).name}, ${tierName(medal.tier)}`}
            style={[{ alignItems: 'center', gap: 8 }, stacked && { flexDirection: 'row', gap: 14 }]}
          >
            <Medallion
              kind={medal.key}
              tier={medal.tier}
              progress={null}
              size={stacked ? medallionSizes.row : medallionSizes.grid}
              colors={colors}
              arcColor={palette.primary}
              trackColor={palette.separator}
            />
            <View style={{ alignItems: stacked ? 'flex-start' : 'center', gap: 6 }}>
              <Text style={[styles.medalName, stacked && styles.medalNameStacked]}>{medalCopy(medal.key).name}</Text>
              <TierChip tier={medal.tier} />
            </View>
          </View>
        </FloatingCard>
      ))}
    </View>
  );
}

/** The cream passport page with one ink stamp per shop the friend has visited, named and undated. */
function FriendStampPage({ names }: { names: readonly string[] }) {
  const ui = useUiStyles();
  const styles = useFriendsStyles();
  const world = worldForScheme(useColorScheme());
  const { width, fontScale } = useWindowDimensions();
  const columns = stampColumnCount(width, fontScale);
  const slotWidth = (width - uiMetrics.pageInset * 2 - PAGE_PADDING * 2 - SLOT_GAP * (columns - 1)) / columns;
  if (names.length === 0) {
    return (
      <View style={styles.emptyPaper}>
        <Text style={styles.emptyPaperText}>아직 찍힌 도장이 없어요.</Text>
      </View>
    );
  }
  return (
    <View style={ui.stampPage}>
      {names.map((name, index) => (
        <View
          key={`${index}-${name}`}
          accessible
          accessibilityLabel={`${name} 도장 받음`}
          style={[styles.stampSlotStatic, { width: slotWidth }]}
        >
          {/* The tilt is computed here on the JS thread, like the passport's own stamps. */}
          <View accessible={false} style={[ui.stampRing, { backgroundColor: world.paper, transform: [{ rotate: `${stampTilt(name)}deg` }] }]}>
            <View style={ui.stampRingInner}>
              <Text maxFontSizeMultiplier={1.2} style={ui.stampMark}>{stampGlyph(name)}</Text>
            </View>
          </View>
          <Text numberOfLines={2} textBreakStrategy="simple" style={ui.stampName}>{name}</Text>
        </View>
      ))}
    </View>
  );
}
