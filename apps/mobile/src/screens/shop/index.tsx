import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Image, Pressable, RefreshControl, Text, View, useColorScheme, useWindowDimensions, type ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AccountCredential } from '@/auth/account-credential';
import { getAppPackageId } from '@/config/app-identity';
import { CharacterArt } from '@/illustration/character-art';
import { PackArt } from '@/illustration/artwork';
import { ThemePackBoard } from '@/experience/theme-pack-board';
import { useExperience } from '@/experience/use-experience';
import { useTabBarClearance } from '@/navigation/use-tab-bar-clearance';
import { colorsForScheme } from '@/theme/palette';
import { AppHeader } from '@/ui/app-header';
import { BounceButton } from '@/ui/bounce-button';
import { FloatingCard } from '@/ui/floating-card';
import { heroMascotSize } from '@/ui/large-text';
import { Mascot } from '@/ui/mascot';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';
import { Stagger } from '@/ui/stagger';
import { StateScene } from '@/ui/state-scene';

import { ShopApiError, createShopApiClient, shopErrorMessage, type MileageGrade, type ShopGradeView, type ShopRerollResult } from '@/shop/shop-api';
import { mileageCoinArt } from '@/shop/shop-art';
import {
  buildFriendGrid, earnRulesText, formatMileage, rerollDisclosure, rerollButtonState, resumeOrStartPurchase, showcaseBonusLabel,
  type FriendGridCell, type PendingPurchase,
} from '@/shop/shop-rules';
import { shopDrawHeading, shopDrawIntro } from '@/shop/shop-copy';
import { clearPendingPurchase, pendingPurchaseScope, readPendingPurchase, writePendingPurchase, type PendingPurchaseScope } from '@/shop/pending-purchase-storage';
import { enterShopPurchaseScope, leaveShopPurchaseScope, subscribeShopPurchaseScope } from '@/shop/purchase-coordinator';
import { recoverPendingPurchase } from '@/shop/pending-purchase-recovery';
import { useShop } from '@/shop/use-shop';

import { themePackName, cosmeticSequenceDisclosure } from './gacha-rules';
import { GachaMachine } from './gacha-machine';
import { FullScreenModal } from '@/gamification/full-screen-modal';
import { HistorySection } from './history-section';
import { useShopStyles } from './use-shop-styles';

export const SHOP_TITLE = '상점';
export const SHOP_SUBTITLE = '마일리지를 모아 가게 친구를 뽑아요';

type Notice = { tone: 'success' | 'error'; text: string };

export function ShopScreen({ apiUrl, accountId, credential, onSessionInvalid, gachaOnly = false, gachaVisible = true, onGachaClose }: {
  apiUrl: string;
  accountId: string;
  credential: AccountCredential;
  onSessionInvalid: () => Promise<void>;
  gachaOnly?: boolean;
  gachaVisible?: boolean;
  onGachaClose?: () => void;
}) {
  const clearance = useTabBarClearance();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const palette = colorsForScheme(scheme);
  const styles = useShopStyles();
  const { fontScale } = useWindowDimensions();

  const api = useMemo(() => createShopApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const shop = useShop(api);
  const pendingScope = useMemo<PendingPurchaseScope>(
    () => pendingPurchaseScope({ accountId, apiUrl, appVariant: getAppPackageId() ?? 'app' }),
    [accountId, apiUrl],
  );
  const pendingScopeKey = useMemo(() => `${pendingScope.appVariant}:${pendingScope.apiUrl}:${pendingScope.accountId}`, [pendingScope]);
  const shopRef = useRef(shop);
  useEffect(() => { shopRef.current = shop; }, [shop]);
  const apiRef = useRef(api);
  useEffect(() => { apiRef.current = api; }, [api]);
  const experience = useExperience(apiUrl, credential, onSessionInvalid);
  const refreshExperience = experience.refresh;
  // 방문 진입을 다시 열 때 최신 적립분을 읽되, 응답을 놓친 구매의 requestId/소유 스냅샷은 유지한다.
  const refreshGachaSnapshot = shop.refreshQuietly;
  useEffect(() => {
    if (gachaOnly && gachaVisible) void refreshGachaSnapshot();
  }, [gachaOnly, gachaVisible, refreshGachaSnapshot]);
  const [refreshing, setRefreshing] = useState(false);
  const [pending, setPending] = useState<PendingPurchase>();
  const [busyGrade, setBusyGrade] = useState<MileageGrade>();
  const [notice, setNotice] = useState<Notice>();
  const [machineOpen, setMachineOpen] = useState(gachaOnly);
  const [selectedGrade, setSelectedGrade] = useState<MileageGrade>('BRONZE');
  const [ownedBefore, setOwnedBefore] = useState<readonly string[]>([]);
  const purchaseOwnership = useRef<readonly string[]>([]);
  const [reveal, setReveal] = useState<ShopRerollResult>();
  // chooseAvatar() 응답은 요청이 시작된 결과 모달이 여전히 열려 있을 때만 그 모달에 반영한다.
  const revealRef = useRef(reveal);
  useEffect(() => { revealRef.current = reveal; }, [reveal]);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string>();
  // 구매 성공과 새로고침 뒤에는 펼쳐 둔 사용 내역을 첫 페이지부터 다시 불러온다.
  const [historyRefreshToken, setHistoryRefreshToken] = useState(0);
  const recoveryStarted = useRef(false);
  // 로딩에서 오류로 내용이 커져도 같은 ScrollView가 유지되므로, retry 화면에서 새 높이를 보고 스크롤을 보정한다.
  const skyScrollView = useRef<ScrollView>(null);
  // 높이가 실제로 늘었을 때만 스크롤해, 오류를 다시 읽으려는 사용자를 끌어내리지 않는다.
  const skyContentHeight = useRef(0);
  const onSkyContentSizeChange = useCallback((_width: number, height: number) => {
    if (height <= skyContentHeight.current) return;
    skyContentHeight.current = height;
    // 네이티브가 새 content size를 반영한 다음 스크롤하도록 한 프레임 늦춘다.
    requestAnimationFrame(() => skyScrollView.current?.scrollTo({ y: height, animated: false }));
  }, []);

  // GET /shop 성공만으로 unresolved POST pending을 지우지 않는다. pending은 replay 성공/상태 변경 확정 뒤에만 정리한다.
  const quietRefresh = useCallback(async () => refreshGachaSnapshot(), [refreshGachaSnapshot]);

  // 상점 탭은 마운트된 채로 남으므로 포커스를 다시 받을 때 최신 잔액을 조용히 읽는다.
  useFocusEffect(useCallback(() => { void quietRefresh(); }, [quietRefresh]));

  const snapshotReady = Boolean(shop.snapshot);
  const [recoveryWake, setRecoveryWake] = useState(0);
  const recoveryGeneration = useRef(0);
  const requestRecovery = useCallback(() => { recoveryStarted.current = false; setRecoveryWake((value) => value + 1); }, []);
  useEffect(() => {
    recoveryStarted.current = false;
    recoveryGeneration.current += 1;
  }, [pendingScopeKey]);

  useEffect(() => {
    if (!snapshotReady || recoveryStarted.current || revealRef.current) return;
    const lease = enterShopPurchaseScope(pendingScope);
    if (!lease) {
      return subscribeShopPurchaseScope(pendingScope, () => {
        recoveryStarted.current = false;
        setRecoveryWake((value) => value + 1);
      });
    }
    recoveryStarted.current = true;
    const generation = recoveryGeneration.current + 1;
    recoveryGeneration.current = generation;
    let mounted = true;
    void recoverPendingPurchase({
      scope: pendingScope,
      readPending: readPendingPurchase,
      clearPending: clearPendingPurchase,
      reroll: (input) => apiRef.current.reroll(input),
      isCurrent: () => mounted && recoveryGeneration.current === generation && pendingScopeKey === `${pendingScope.appVariant}:${pendingScope.apiUrl}:${pendingScope.accountId}`,
      onStart: (stored) => {
        setSelectedGrade(stored.grade);
        setMachineOpen(true);
        setPending({ grade: stored.grade, requestId: stored.requestId });
        setBusyGrade(stored.grade);
        setNotice(undefined);
      },
      onSuccess: (result) => {
        setPending(undefined);
        shopRef.current.applyReroll(result);
        setReveal(result);
        setHistoryRefreshToken((value) => value + 1);
        void refreshExperience();
      },
      onError: (error) => { setNotice({ tone: 'error', text: shopErrorMessage(error) }); },
      onFinish: () => { setBusyGrade(undefined); },
    }).finally(() => { leaveShopPurchaseScope(lease); });
    return () => { mounted = false; recoveryGeneration.current += 1; };
  }, [pendingScope, pendingScopeKey, recoveryWake, snapshotReady, refreshExperience]);


  async function refresh() {
    setRefreshing(true);
    setHistoryRefreshToken((value) => value + 1);
    try {
      const refreshed = await quietRefresh();
      if (refreshed) { setNotice(undefined); requestRecovery(); }
    } finally {
      setRefreshing(false);
    }
  }

  async function buy(grade: ShopGradeView): Promise<boolean> {
    // avatarBusy 동안에도 새 뽑기를 막는다 — 안 그러면 닫힌 모달에서 아직 날아가고 있는 대표 설정 요청이
    // 실패했을 때 그 알림이 방금 연 새 뽑기 모달 뒤에 깔려 아무도 못 본다(PR #312 리뷰 라운드 4).
    if (busyGrade || avatarBusy || experience.saving) return false;
    if (refreshing) return false;
    const generation = recoveryGeneration.current;
    const isCurrent = () => recoveryGeneration.current === generation && apiRef.current === api;
    const lease = enterShopPurchaseScope(pendingScope);
    if (!lease) {
      setNotice({ tone: 'error', text: '이전 구매 확인 중이에요. 결과를 받은 뒤 다시 시도해 주세요.' });
      return false;
    }
    try {
      const storedAttempt = await readPendingPurchase(pendingScope);
      if (!isCurrent()) return false;
      const attempt = storedAttempt ?? resumeOrStartPurchase(pending, grade.grade);
      if (!storedAttempt && attempt !== pending) purchaseOwnership.current = shop.snapshot?.items.filter((item) => item.owned).map((item) => item.id) ?? [];
      if (storedAttempt) setSelectedGrade(storedAttempt.grade);
      setOwnedBefore(purchaseOwnership.current);
      setReveal(undefined);
      setPending(attempt);
      setBusyGrade(attempt.grade);
      setNotice(undefined);
      if (!storedAttempt) await writePendingPurchase(pendingScope, { grade: attempt.grade, requestId: attempt.requestId, expectedRemaining: grade.remaining });
      if (!isCurrent()) return false;
      const expectedRemaining = storedAttempt?.expectedRemaining ?? grade.remaining;
      const result = await api.reroll({ grade: attempt.grade, requestId: attempt.requestId, expectedRemaining });
      if (!isCurrent()) return false;
      await clearPendingPurchase(pendingScope).catch(() => undefined);
      if (!isCurrent()) return false;
      setPending(undefined);
      shop.applyReroll(result);
      setReveal(result);
      void refreshExperience();
      setHistoryRefreshToken((value) => value + 1);
      return true;
    } catch (error) {
      if (!isCurrent()) return false;
      if (error instanceof ShopApiError && error.code === 'SHOP_STATE_CHANGED') {
        // 요금은 빠지지 않았으므로 이 requestId는 버리고, 새 공개 문구를 실제로 불러온 뒤에만 다시 구매하게 한다.
        setPending(undefined);
        await clearPendingPurchase(pendingScope).catch(() => undefined);
        if (!isCurrent()) return false;
        const refreshed = await shop.refreshQuietly();
        if (!isCurrent()) return false;
        setNotice({
          tone: 'error',
          text: refreshed ? shopErrorMessage(error) : '상품 정보를 다시 불러오지 못했어요. 상점 다시 불러오기를 누른 뒤 다시 시도해 주세요.',
        });
      } else {
        setNotice({ tone: 'error', text: shopErrorMessage(error) });
      }
      return false;
    } finally {
      if (isCurrent()) setBusyGrade(undefined);
      leaveShopPurchaseScope(lease);
    }
  }

  /**
   * `targetReveal`는 이 호출이 어느 뽑기 결과 모달에서 시작됐는지(그리드에서 바로 불렀으면 undefined)를 들고
   * 있다가, 응답이 왔을 때 그 모달이 **여전히** 떠 있을 때만 건드린다. 요청 뒤 모달이 닫히거나 다른 결과
   * 모달이 열렸으면, 이 응답으로 엉뚱한 모달을 닫거나 그 안에 실패를 적지 않는다.
   */
  async function chooseAvatar(itemId: string | null, targetReveal?: ShopRerollResult) {
    if (avatarBusy) return;
    setAvatarBusy(true);
    setNotice(undefined);
    setAvatarError(undefined);
    try {
      const { avatar } = await api.setAvatar(itemId);
      shop.applyAvatar(avatar);
      if (targetReveal && revealRef.current === targetReveal) {
        setReveal(undefined);
        setMachineOpen(false);
        onGachaClose?.();
      }
    } catch (error) {
      if (targetReveal && revealRef.current === targetReveal) setAvatarError(shopErrorMessage(error));
      else setNotice({ tone: 'error', text: shopErrorMessage(error) });
    } finally {
      setAvatarBusy(false);
    }
  }

  function confirmAvatar(cell: FriendGridCell) {
    if (!cell.owned || avatarBusy) return;
    if (cell.isAvatar) {
      Alert.alert('동행 해제', `${cell.name} 동행 설정을 해제할까요? 기본 마스코트와 함께해요.`, [
        { text: '취소', style: 'cancel' },
        { text: '해제', onPress: () => void chooseAvatar(null) },
      ]);
      return;
    }
    Alert.alert('동행으로 설정', `${cell.name}과 함께할까요? 홈·놀이·내 공간에 등장해요.`, [
      { text: '취소', style: 'cancel' },
      { text: '설정', onPress: () => void chooseAvatar(cell.id) },
    ]);
  }

  const header = (
    <AppHeader title={SHOP_TITLE} subtitle={SHOP_SUBTITLE}>
      <View style={styles.hero}>
        <Mascot interactive pose="gift" size={heroMascotSize(fontScale, 112)} />
      </View>
    </AppHeader>
  );
  // extra는 뽑기 연출 모달 자리다. retryScroll은 로딩/오류 화면에서만 ref와 content-size 보정을 연결한다.
  const sky = (body: ReactNode, extra?: ReactNode, retryScroll?: boolean) => (
    <SkyBackdrop>
      <SkyScrollView
        ref={retryScroll ? skyScrollView : undefined}
        header={header}
        contentContainerStyle={[styles.content, { paddingBottom: clearance }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} progressViewOffset={insets.top} colors={[palette.primary]} />}
        onContentSizeChange={retryScroll ? onSkyContentSizeChange : undefined}
      >
        {body}
      </SkyScrollView>
      {extra}
    </SkyBackdrop>
  );

  if (!shop.snapshot && gachaOnly) {
    if (!gachaVisible) return null;
    return <FullScreenModal visible animationType="fade" onRequestClose={onGachaClose ?? (() => {})}>
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: palette.background }}>
        <StateScene kind={shop.status === 'error' ? 'error' : 'loading'} title={shop.status === 'error' ? '상점을 불러오지 못했어요' : '상점을 불러오는 중'}
          action={shop.status === 'error' ? { label: '다시 불러오기', onPress: () => { void shop.retry(); } } : undefined} />
        <BounceButton label="닫기" onPress={onGachaClose ?? (() => {})} />
      </View>
    </FullScreenModal>;
  }

  if (!shop.snapshot) {
    return shop.status === 'error'
      ? sky(<StateScene kind="error" title="상점을 불러오지 못했어요" body={shopErrorMessage(shop.error)} action={{ label: '다시 불러오기', onPress: () => { void shop.retry(); }, disabled: shop.retrying }} />, undefined, true)
      : sky(<StateScene kind="loading" title="상점을 불러오는 중" />, undefined, true);
  }

  const { snapshot } = shop;
  const grid = buildFriendGrid(snapshot.items, snapshot.avatar);
  const machine = (gachaOnly ? gachaVisible : machineOpen) ? <GachaMachine
    snapshot={snapshot} profile={experience.snapshot?.profile} bonusSaving={experience.saving} bonusError={experience.error}
    onEquipBonus={reveal?.bonus ? () => { if (reveal.bonus) void experience.save({ cosmetics: { [reveal.bonus.slot]: reveal.bonus.id } }); } : undefined}
    result={reveal} selectedGrade={selectedGrade} ownedBefore={ownedBefore} isAvatar={snapshot.avatar === reveal?.item.id}
    busy={Boolean(busyGrade) || avatarBusy || experience.saving} error={notice?.tone === 'error' ? notice.text : undefined}
    avatarBusy={avatarBusy} avatarError={avatarError}
    wishId={experience.snapshot?.profile.wishlist} onWish={(itemId) => { void experience.wish(itemId); }}
    onRecoverPending={pending ? requestRecovery : undefined}
    refreshing={refreshing} onRefresh={() => { void refresh(); }}
    onDraw={buy}
    onSetAvatar={() => { if (reveal) void chooseAvatar(reveal.item.id, reveal); }}
    onOpenStudio={() => {
      const avatarItemId = reveal?.item.id;
      setMachineOpen(false); setReveal(undefined); onGachaClose?.();
      router.push({ pathname: '/studio', params: avatarItemId ? { avatar: avatarItemId } : {} });
    }}
    onClose={() => { setMachineOpen(false); setReveal(undefined); setAvatarError(undefined); onGachaClose?.(); }}
  /> : null;
  if (gachaOnly) return machine;

  const bonusLabel = showcaseBonusLabel(snapshot.mileage.showcaseBonus);

  return sky(
    <>
      <Stagger index={0}>
        <FloatingCard style={styles.card}>
          <View style={styles.mileageRow}>
            <Image source={mileageCoinArt} style={styles.coin} accessible={false} accessibilityIgnoresInvertColors />
            <Text accessibilityLabel={`마일리지 ${snapshot.mileage.balance}포인트`} style={styles.balance}>{formatMileage(snapshot.mileage.balance)}</Text>
          </View>
          {pending ? <BounceButton label="이전 구매 결과 다시 확인" disabled={Boolean(busyGrade) || avatarBusy || experience.saving || refreshing} onPress={requestRecovery} /> : null}
          {bonusLabel ? <Text style={styles.rulesText}>{bonusLabel}</Text> : null}
          <Text style={styles.rulesText}>{earnRulesText(snapshot.mileage.rules)}</Text>
          <View accessibilityLiveRegion="polite">
            {experience.error ? <Text style={styles.errorMessage}>{experience.error}</Text> : null}
            {notice ? <Text style={notice.tone === 'success' ? styles.successMessage : styles.errorMessage}>{notice.text}</Text> : null}
          </View>
        </FloatingCard>
      </Stagger>

      <Stagger index={1}>
        <HistorySection api={api} refreshToken={historyRefreshToken} />
      </Stagger>

      <Stagger index={2}>
        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>{shopDrawHeading}</Text>
          <Text style={styles.sectionNote}>{shopDrawIntro}</Text>
          {snapshot.grades.map((grade) => (
            <GradeRow
              key={grade.grade}
              grade={grade}
              balance={snapshot.mileage.balance}
              friends={snapshot.items.filter((item) => item.grade === grade.grade && !item.owned)}
              busy={busyGrade === grade.grade}
              purchaseBusy={Boolean(busyGrade) || avatarBusy || experience.saving}
              onBuy={() => { setSelectedGrade(grade.grade); setReveal(undefined); setNotice(undefined); setMachineOpen(true); }}
              styles={styles}
            />
          ))}
        </View>
      </Stagger>

      {experience.snapshot ? <ThemePackBoard snapshot={experience.snapshot} /> : null}

      <Stagger index={3}>
        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>가게 친구</Text>
          <View style={styles.grid}>
            {grid.map((cell) => <FriendCell key={cell.id} cell={cell} onPress={() => confirmAvatar(cell)} styles={styles} />)}
          </View>
        </View>
      </Stagger>
    </>,
    machine,
  );
}

function GradeRow({ grade, balance, friends, busy, purchaseBusy, onBuy, styles }: {
  grade: ShopGradeView; balance: number; busy: boolean; purchaseBusy: boolean; onBuy: () => void;
  friends: readonly { id: string; name: string }[];
  styles: ReturnType<typeof useShopStyles>;
}) {
  const button = rerollButtonState(grade, balance);
  // 다른 등급을 구매하는 동안에도 전부 비활성화해 눌러도 조용히 무시되는 상태를 피한다.
  const disabled = button.disabled || purchaseBusy;
  return (
    <FloatingCard style={styles.card}>
      <View style={styles.gradeHeader}>
        <PackArt grade={grade.grade} size={100} />
        <View style={styles.gradeCopy}>
          <Text style={styles.gradeName}>{themePackName(grade.grade)} · {gradeLabel(grade.grade)} 캐릭터</Text>
          <Text style={styles.gradePrice}>{formatMileage(grade.price)} · 가진 친구 {grade.owned}/{grade.total}</Text>
        </View>
      </View>
      {friends.length ? <View style={styles.grid}>{friends.map((friend) => <View key={friend.id} style={styles.cell}>
        <CharacterArt avatar={friend.id} frame="calm" size={72} /><Text style={styles.cellName}>{friend.name}</Text>
      </View>)}</View> : null}
      <Text style={styles.disclosure}>{rerollDisclosure(grade)}</Text>
      <Text style={styles.disclosure}>{cosmeticSequenceDisclosure}</Text>
      {button.reason ? <Text style={styles.disabledReason}>{button.reason}</Text> : null}
      <BounceButton
        label={busy ? '뽑는 중…' : '뽑기'}
        disabled={disabled}
        onPress={onBuy}
      />
    </FloatingCard>
  );
}

function FriendCell({ cell, onPress, styles }: {
  cell: FriendGridCell; onPress: () => void; styles: ReturnType<typeof useShopStyles>;
}) {
  const label = cell.owned
    ? `${cell.name}${cell.isAvatar ? ', 대표 캐릭터' : ', 가지고 있어요'}`
    : `${cell.name}, 아직 가지지 않았어요`;
  return (
    <Pressable
      accessibilityRole={cell.owned ? 'button' : undefined}
      accessibilityLabel={label}
      accessibilityHint={cell.owned ? (cell.isAvatar ? '대표 설정을 해제합니다' : '대표 캐릭터로 설정합니다') : undefined}
      disabled={!cell.owned}
      onPress={onPress}
      style={styles.cell}
    >
      <View style={[styles.cellRing, cell.isAvatar && styles.cellRingAvatar]}>
        <CharacterArt avatar={cell.id} frame="calm" size={64} />
      </View>
      <Text numberOfLines={1} style={[styles.cellName, !cell.owned && styles.cellNameUnowned]}>{cell.name}</Text>
      {!cell.owned ? <Text style={styles.cellNameUnowned}>미보유</Text> : null}
      {cell.isAvatar ? <View style={styles.avatarChip}><Text style={styles.avatarChipText}>대표</Text></View> : null}
    </Pressable>
  );
}

function gradeLabel(grade: MileageGrade): string {
  switch (grade) {
    case 'BRONZE':
      return '브론즈';
    case 'SILVER':
      return '실버';
    case 'GOLD':
      return '골드';
  }
}
