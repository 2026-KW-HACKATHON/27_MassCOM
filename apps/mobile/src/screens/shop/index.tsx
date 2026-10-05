import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Image, Pressable, RefreshControl, Text, View, useColorScheme, useWindowDimensions, type ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AccountCredential } from '@/auth/account-credential';
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
import { friendArt, mileageCoinArt, ticketArt } from '@/shop/shop-art';
import {
  buildFriendGrid, earnRulesText, formatMileage, rerollDisclosure, rerollButtonState, resumeOrStartPurchase, showcaseBonusLabel,
  type FriendGridCell, type PendingPurchase,
} from '@/shop/shop-rules';
import { shopDrawHeading, shopDrawIntro } from '@/shop/shop-copy';
import { useShop } from '@/shop/use-shop';

import { themePackName, cosmeticSequenceDisclosure } from './gacha-rules';
import { GachaMachine } from './gacha-machine';
import { FullScreenModal } from '@/gamification/full-screen-modal';
import { HistorySection } from './history-section';
import { useShopStyles } from './use-shop-styles';

export const SHOP_TITLE = '상점';
export const SHOP_SUBTITLE = '마일리지를 모아 가게 친구를 뽑아요';

type Notice = { tone: 'success' | 'error'; text: string };

export function ShopScreen({ apiUrl, credential, onSessionInvalid, gachaOnly = false, gachaVisible = true, onGachaClose }: {
  apiUrl: string;
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
  const experience = useExperience(apiUrl, credential, onSessionInvalid);
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
  const [ownedBefore, setOwnedBefore] = useState<readonly string[]>([]);
  const purchaseOwnership = useRef<readonly string[]>([]);
  const [reveal, setReveal] = useState<ShopRerollResult>();
  // chooseAvatar()는 요청이 날아가 있는 동안 모달이 닫혀도(onClose) 실패를 어디에 보여줄지 그 순간의 실제 모달
  // 상태로 판단해야 한다 — state를 그대로 읽으면 요청을 시작할 때의 render가 캡처한 낡은 값을 쓰게 된다
  // (cross-review 3번). friends/index.tsx의 myCodeRef와 같은 모양으로 ref를 최신 값으로 맞춰 둔다.
  const revealRef = useRef(reveal);
  useEffect(() => { revealRef.current = reveal; }, [reveal]);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string>();
  // 구매가 성공할 때마다, 그리고 화면을 당겨서 새로고침할 때마다 올려 펼쳐 둔 "사용 내역"이 첫 페이지부터
  // 다시 불러오게 한다(PR #312 리뷰 6번).
  const [historyRefreshToken, setHistoryRefreshToken] = useState(0);
  // #314가 도감의 같은 sky()에서 찾은 원인: 이 뷰는 짧은 "불러오는 중" 내용으로 먼저 마운트되고, 더 큰
  // "오류" 내용으로 바뀔 때는 다시 마운트되지 않는다(같은 모양의 JSX라 리액트가 인스턴스를 그대로 쓴다).
  // `contentOffset`은 첫 마운트에만 적용되니 재시도 버튼이 하단 탭 바 밑에 가려도 스크롤해 보여줄 길이
  // 없다 — 아래 sky()에서 로딩/오류 두 갈래에만 이 ref를 건네 내용 크기가 바뀔 때마다 다시 스크롤한다.
  const skyScrollView = useRef<ScrollView>(null);
  // #320 리뷰(도감에서 같은 수정): onContentSizeChange는 재시도 재렌더처럼 높이가 그대로여도 다시 불릴 수
  // 있어, 매번 스크롤하면 오류를 다시 읽으려고 위로 스크롤한 사용자를 끌어내린다. 이전 높이를 여기 쥐고
  // 실제로 늘었을 때만 스크롤한다.
  const skyContentHeight = useRef(0);
  // #320 리뷰: JSX 안 인라인 화살표로 쓰면 eslint-plugin-react-hooks의 refs 규칙이 "prop으로 바로 넘긴 함수
  // 리터럴 안의 ref 읽기"를 렌더 중 접근 가능성으로 보고 막는다 — useCallback으로 뺀다(도감과 같은 조치).
  const onSkyContentSizeChange = useCallback((_width: number, height: number) => {
    if (height <= skyContentHeight.current) return;
    skyContentHeight.current = height;
    // 이 자리에서 바로 scrollTo를 부르면 아무 효과가 없다 — 네이티브 쪽이 새 크기를 아직 반영하기 전,
    // 짧았던 예전 범위로 요청이 그대로 잘려 나간다. 한 프레임 미뤄 네이티브가 크기를 반영한 뒤에
    // 스크롤한다(#314 PR #320과 같은 방식).
    requestAnimationFrame(() => skyScrollView.current?.scrollTo({ y: height, animated: false }));
  }, []);

  // 새로고침이 서버의 최신 결과를 보여줬으면 그 전 구매 시도는 이미 끝난 일로 본다 — 다음 구매는 새 requestId로
  // 시작해, 그 사이 응답을 놓친 옛 시도를 재생(replay)하지 않는다(PR #312 리뷰 2번). 당겨서 새로고침·탭 포커스
  // 재진입 둘 다 같은 규칙이라 공유한다.
  const quietRefresh = useCallback(async () => {
    const refreshed = await shop.refreshQuietly();
    if (refreshed) setPending(undefined);
    return refreshed;
    // use-shop.ts의 shop은 매 렌더 새 객체지만 shop.refreshQuietly 자체는 useCallback으로 고정돼 있다(loader가
    // 바뀔 때만 바뀜) — shop 전체를 의존성에 넣으면 구매 중 상태가 바뀔 때마다 이 콜백이 재생성돼 아래
    // useFocusEffect가 다시 실행되며 쓸데없는 GET /shop을 또 보낸다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shop.refreshQuietly]);

  // 홈 탭과 같은 이유(use-shop-avatar-art.ts): 상점 탭도 다른 탭으로 옮겨도 마운트된 채로 남는다(언마운트 아님).
  // 방문으로 마일리지를 번 뒤 상점으로 돌아와도 다시 포커스를 받을 때까지는 처음 불러온 잔액이 그대로 보인다
  // (기기 QA). 탭이 다시 포커스를 받을 때마다 조용히 새로고침한다 — refreshQuietly()는 shop-loader.ts의 기존
  // latest-gate를 그대로 타므로, 그사이 확정된 구매·대표 설정을 뒤늦게 덮어쓰지 않는다.
  useFocusEffect(useCallback(() => { void quietRefresh(); }, [quietRefresh]));

  async function refresh() {
    setRefreshing(true);
    setHistoryRefreshToken((value) => value + 1);
    try {
      const refreshed = await quietRefresh();
      if (refreshed) setNotice(undefined);
    } finally {
      setRefreshing(false);
    }
  }

  async function buy(grade: ShopGradeView): Promise<boolean> {
    // avatarBusy 동안에도 새 뽑기를 막는다 — 안 그러면 닫힌 모달에서 아직 날아가고 있는 대표 설정 요청이
    // 실패했을 때 그 알림이 방금 연 새 뽑기 모달 뒤에 깔려 아무도 못 본다(PR #312 리뷰 라운드 4).
    if (busyGrade || avatarBusy) return false;
    if (refreshing) return false;
    const attempt = resumeOrStartPurchase(pending, grade.grade);
    if (attempt !== pending) purchaseOwnership.current = shop.snapshot?.items.filter((item) => item.owned).map((item) => item.id) ?? [];
    setOwnedBefore(purchaseOwnership.current);
    setReveal(undefined);
    setPending(attempt);
    setBusyGrade(grade.grade);
    setNotice(undefined);
    try {
      const result = await api.reroll({ grade: grade.grade, requestId: attempt.requestId, expectedRemaining: grade.remaining });
      setPending(undefined);
      shop.applyReroll(result);
      setReveal(result);
      void experience.refresh();
      setHistoryRefreshToken((value) => value + 1);
      return true;
    } catch (error) {
      if (error instanceof ShopApiError && error.code === 'SHOP_STATE_CHANGED') {
        // 요금은 빠지지 않았으니(design-298.md 리뷰 6번) 이 requestId는 더 쓸 일이 없다. 새 공개 문구를 실제로
        // 보여줄 때까지는 구매를 막는다(finally의 setBusyGrade는 이 await 뒤에야 실행된다) — 낡은 확률 위에
        // "새로 보여드려요" 안내만 얹으면 안 된다(PR #312 리뷰 4번).
        setPending(undefined);
        const refreshed = await shop.refreshQuietly();
        setNotice({
          tone: 'error',
          text: refreshed ? shopErrorMessage(error) : '상품 정보를 다시 불러오지 못했어요. 상점 다시 불러오기를 누른 뒤 다시 시도해 주세요.',
        });
      } else {
        setNotice({ tone: 'error', text: shopErrorMessage(error) });
      }
      return false;
    } finally {
      setBusyGrade(undefined);
    }
  }

  /**
   * `targetReveal`는 이 호출이 어느 뽑기 결과 모달에서 시작됐는지(그리드에서 바로 불렀으면 undefined)를 들고
   * 있다가, 응답이 왔을 때 그 모달이 **여전히** 떠 있을 때만 건드린다. 요청이 날아간 뒤 사용자가 모달을 닫거나
   * (cross-review 3번) 그사이 다른 뽑기로 전혀 다른 결과 모달이 열렸으면(2차 확인 리뷰) 이 응답으로 그 엉뚱한
   * 모달을 닫거나 그 안에 실패를 적지 않는다 — revealRef(최신 모달 참조)와 참조 비교로 판단한다.
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
  // extra는 뽑기 연출(GachaMachine)을 위한 자리: 다른 화면의 모달들(collection/index.tsx의 CollectibleReveal 등)과
  // 같게 SkyScrollView 다음, 여전히 SkyBackdrop 안에 둔다(PR #312 QA) — 둘을 따로 반환하면 RefreshControl 등
  // 머리글 배선을 통째로 또 써야 한다.
  // retryScroll은 로딩/오류 두 갈래에서만 true다 — skyScrollView를 매개변수로 건네면(ref를 함수에 전달) lint의
  // react-hooks/refs가 "렌더 중 ref를 읽을 수 있다"고 막는다. 대신 이 컴포넌트 스코프의 ref를 클로저로 직접
  // 읽어, 실제로 ref.current를 건드리는 곳은 onContentSizeChange·rAF 콜백(렌더 중이 아님) 뿐으로 유지한다.
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
    snapshot={snapshot} result={reveal} ownedBefore={ownedBefore} isAvatar={snapshot.avatar === reveal?.item.id}
    busy={Boolean(busyGrade) || avatarBusy} error={notice?.tone === 'error' ? notice.text : undefined}
    avatarBusy={avatarBusy} avatarError={avatarError}
    wishId={experience.snapshot?.profile.wishlist} onWish={(itemId) => { void experience.wish(itemId); }}
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
          {bonusLabel ? <Text style={styles.rulesText}>{bonusLabel}</Text> : null}
          <Text style={styles.rulesText}>{earnRulesText(snapshot.mileage.rules)}</Text>
          <View accessibilityLiveRegion="polite">
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
              busy={busyGrade === grade.grade}
              purchaseBusy={Boolean(busyGrade) || avatarBusy}
              onBuy={() => { setReveal(undefined); setNotice(undefined); setMachineOpen(true); }}
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

function GradeRow({ grade, balance, busy, purchaseBusy, onBuy, styles }: {
  grade: ShopGradeView; balance: number; busy: boolean; purchaseBusy: boolean; onBuy: () => void;
  styles: ReturnType<typeof useShopStyles>;
}) {
  const button = rerollButtonState(grade, balance);
  // 다른 등급을 구매하는 동안에도 전부 비활성화한다 — 이 등급만 멀쩡해 보이면 눌러도 조용히 무시돼
  // 눌리지 않는 것처럼 보인다(PR #312 리뷰 8번). BounceButton이 disabled를 accessibilityState로도 알린다.
  const disabled = button.disabled || purchaseBusy;
  return (
    <FloatingCard style={styles.card}>
      <View style={styles.gradeHeader}>
        <Image source={ticketArt[grade.grade]} style={styles.ticket} accessible={false} accessibilityIgnoresInvertColors />
        <View style={styles.gradeCopy}>
          <Text style={styles.gradeName}>{themePackName(grade.grade)} · {gradeLabel(grade.grade)} 캐릭터</Text>
          <Text style={styles.gradePrice}>{formatMileage(grade.price)} · 가진 친구 {grade.owned}/{grade.total}</Text>
        </View>
      </View>
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
        {cell.owned
          ? <Image source={friendArt[cell.id]} style={styles.cellArt} accessible={false} accessibilityIgnoresInvertColors />
          : <Text style={styles.cellSilhouette}>?</Text>}
      </View>
      <Text numberOfLines={1} style={[styles.cellName, !cell.owned && styles.cellNameUnowned]}>{cell.owned ? cell.name : '???'}</Text>
      {cell.isAvatar ? <View style={styles.avatarChip}><Text style={styles.avatarChipText}>대표</Text></View> : null}
    </Pressable>
  );
}

function gradeLabel(grade: MileageGrade): string {
  return grade === 'BRONZE' ? '브론즈' : grade === 'SILVER' ? '실버' : '골드';
}
