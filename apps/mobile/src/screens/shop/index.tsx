import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Image, Pressable, RefreshControl, Text, View, useColorScheme, type ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AccountCredential } from '@/auth/account-credential';
import { getAppPackageId } from '@/config/app-identity';
import { CharacterArt } from '@/illustration/character-art';
import { PackArt } from '@/illustration/artwork';
import { ThemePackBoard } from '@/experience/theme-pack-board';
import { useExperience } from '@/experience/use-experience';
import { useTabBarClearance } from '@/navigation/use-tab-bar-clearance';
import { consentRecheckLabel, consentRequiredMessage } from '@/privacy/consent-flow';
import { useConsentRecheck } from '@/privacy/consent-recheck';
import { StudioApiError, createStudioApiClient, type FurnitureSnapshot } from '@/studio/studio-api';
import { FurnitureArt } from '@/studio/furniture-layer';
import { clearFurniturePending, furniturePendingKey, readFurniturePending, writeFurniturePending, type FurniturePending } from '@/shop/furniture-pending';
import { colorsForScheme } from '@/theme/palette';
import { AppHeader } from '@/ui/app-header';
import { BounceButton } from '@/ui/bounce-button';
import { FloatingCard } from '@/ui/floating-card';
import { Fold } from '@/ui/fold';
import { Mascot } from '@/ui/mascot';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';
import { Stagger } from '@/ui/stagger';
import { StateScene } from '@/ui/state-scene';

import { ShopApiError, createShopApiClient, shopErrorMessage, type MileageGrade, type ShopGradeView, type ShopRerollResult } from '@/shop/shop-api';
import { createGradeDrawApi, type GradeDrawPool, type GradeDrawResult, type GradeDrawShop } from '@/shop/grade-draw-api';
import { clearPendingGradeDraw, readPendingGradeDraw, writePendingGradeDraw, type PendingGradeDraw } from '@/shop/grade-draw-pending';
import { mileageCoinArt } from '@/shop/shop-art';
import {
  buildFriendGrid, createRequestId, earnRulesText, formatMileage, resumeOrStartPurchase, showcaseBonusLabel,
  type FriendGridCell, type PendingPurchase,
} from '@/shop/shop-rules';
import { shopDrawHeading, shopDrawIntro } from '@/shop/shop-copy';
import { clearPendingPurchase, pendingPurchaseScope, readPendingPurchase, writePendingPurchase, type PendingPurchaseScope } from '@/shop/pending-purchase-storage';
import { enterShopPurchaseScope, leaveShopPurchaseScope, subscribeShopPurchaseScope } from '@/shop/purchase-coordinator';
import { recoverPendingPurchase } from '@/shop/pending-purchase-recovery';
import { useShop } from '@/shop/use-shop';

import { GachaMachine } from './gacha-machine';
import { GradeDrawMachine } from './grade-draw-machine';
import { FullScreenModal } from '@/gamification/full-screen-modal';
import { HistorySection } from './history-section';
import { useShopStyles } from './use-shop-styles';

export const SHOP_TITLE = '상점';
export const SHOP_SUBTITLE = '마일리지·가구·꾸미기·리롤권을 등급별로 뽑아요';

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
  const recheckConsent = useConsentRecheck();
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const palette = colorsForScheme(scheme);
  const styles = useShopStyles();

  const api = useMemo(() => createShopApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const furnitureApi = useMemo(() => createStudioApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const [furniture, setFurniture] = useState<FurnitureSnapshot>();
  const [furnitureError, setFurnitureError] = useState(false);
  const [furniturePending, setFurniturePending] = useState<FurniturePending>();
  const [furnitureChoice, setFurnitureChoice] = useState<FurnitureSnapshot['catalog'][number]>();
  const [furnitureBusy, setFurnitureBusy] = useState(false);
  const [furnitureMessage, setFurnitureMessage] = useState<string>();
  const furnitureFlight = useRef(false);
  const furnitureKey = useMemo(() => furniturePendingKey(accountId, apiUrl, getAppPackageId() ?? 'app'), [accountId, apiUrl]);
  const drawApi = useMemo(() => createGradeDrawApi({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const shop = useShop(api);
  const refreshFurniture = useCallback(async () => {
    try { setFurniture(await furnitureApi.getFurniture()); setFurnitureError(false); }
    catch { setFurnitureError(true); }
  }, [furnitureApi]);
  useFocusEffect(useCallback(() => {
    void refreshFurniture();
    void readFurniturePending(furnitureKey).then((saved) => { if (saved) setFurniturePending(saved); })
      .catch(() => setFurnitureMessage('이전 가구 구매 요청을 확인하지 못했어요. 계정 기록을 확인해 주세요.'));
  }, [refreshFurniture, furnitureKey]));

  async function buyFurniture(saved?: FurniturePending) {
    if (furnitureFlight.current || (!saved && (!furnitureChoice?.sellable || furnitureChoice.priceMileage === null))) return;
    furnitureFlight.current = true; setFurnitureBusy(true); setFurnitureMessage(undefined);
    try {
      const attempt = saved ?? { itemId: furnitureChoice!.id, requestId: createRequestId() };
      if (!saved) await writeFurniturePending(furnitureKey, attempt);
      setFurniturePending(attempt);
      const result = await furnitureApi.purchaseFurniture(attempt.itemId, attempt.requestId);
      shop.applyBalance(result.balance);
      drawRequestGeneration.current += 1;
      setStoredDrawShop((previous) => previous?.key === drawScopeKey
        ? { ...previous, value: { ...previous.value, balance: result.balance } } : previous);
      void refreshDrawShop();
      await clearFurniturePending(furnitureKey);
      setFurniturePending(undefined); setFurnitureChoice(undefined);
      setFurnitureMessage('가구를 보관함에 넣었어요. 마이룸에서 배치할 수 있어요.');
      setFurniture((previous) => previous && { ...previous, inventory: [result.inventoryItem,
        ...previous.inventory.filter((item) => item.id !== result.inventoryItem.id)] });
      void refreshFurniture();
    } catch (error) {
      if (error instanceof StudioApiError && error.code.startsWith('FURNITURE_')) {
        await clearFurniturePending(furnitureKey).catch(() => undefined);
        setFurniturePending(undefined); void refreshFurniture();
      }
      setFurnitureMessage(error instanceof StudioApiError
        ? error.code === 'FURNITURE_INSUFFICIENT_MILEAGE' ? '마일리지가 부족해요.'
          : error.code === 'FURNITURE_UNAVAILABLE' ? '현재 구매할 수 없는 상품이에요.'
            : error.code === 'FURNITURE_REQUEST_CONFLICT' ? '이 요청의 구매 상품이 달라요. 보관함을 다시 확인해 주세요.'
              : '가구 구매를 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요.'
        : '연결을 확인해 주세요. 결과가 확실하지 않으면 같은 요청으로 다시 확인할 수 있어요.');
    }
    finally { furnitureFlight.current = false; setFurnitureBusy(false); }
  }
  const drawScopeKey = `${apiUrl}:${accountId}:${getAppPackageId() ?? 'app'}`;
  const [storedDrawShop, setStoredDrawShop] = useState<{ key: string; value: GradeDrawShop }>();
  const [storedDrawError, setStoredDrawError] = useState<{ key: string; value: string }>();
  const drawShop = storedDrawShop?.key === drawScopeKey ? storedDrawShop.value : undefined;
  const drawError = storedDrawError?.key === drawScopeKey ? storedDrawError.value : undefined;
  const drawLoading = !drawShop && !drawError;
  const drawApiRef = useRef(drawApi);
  const drawRequestGeneration = useRef(0);
  useEffect(() => { drawApiRef.current = drawApi; }, [drawApi]);
  const refreshDrawShop = useCallback(async () => {
    const generation = ++drawRequestGeneration.current;
    try {
      const next = await drawApi.getShop();
      if (drawApiRef.current !== drawApi || drawRequestGeneration.current !== generation) return false;
      setStoredDrawShop({ key: drawScopeKey, value: next }); setStoredDrawError(undefined); return true;
    } catch (error) {
      if (drawApiRef.current !== drawApi || drawRequestGeneration.current !== generation) return false;
      setStoredDrawError({ key: drawScopeKey, value: shopErrorMessage(error) }); return false;
    }
  }, [drawApi, drawScopeKey]);
  useEffect(() => {
    const timer = setTimeout(() => { void refreshDrawShop(); }, 0);
    return () => clearTimeout(timer);
  }, [refreshDrawShop]);
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
  const [storedDrawPending, setStoredDrawPending] = useState<{ key: string; value: PendingGradeDraw }>();
  const [storedGradeResult, setStoredGradeResult] = useState<{ key: string; value: GradeDrawResult }>();
  const drawPending = storedDrawPending?.key === drawScopeKey ? storedDrawPending.value : undefined;
  const gradeResult = storedGradeResult?.key === drawScopeKey ? storedGradeResult.value : undefined;
  const setDrawPending = useCallback((value: PendingGradeDraw | undefined) => setStoredDrawPending(value ? { key: drawScopeKey, value } : undefined), [drawScopeKey]);
  const setGradeResult = useCallback((value: GradeDrawResult | undefined) => setStoredGradeResult(value ? { key: drawScopeKey, value } : undefined), [drawScopeKey]);
  const gradeResultRef = useRef(gradeResult);
  useEffect(() => { gradeResultRef.current = gradeResult; }, [gradeResult]);
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
  useFocusEffect(useCallback(() => { void quietRefresh(); void refreshDrawShop(); }, [quietRefresh, refreshDrawShop]));

  const snapshotReady = Boolean(shop.snapshot);
  const [recoveryWake, setRecoveryWake] = useState(0);
  const recoveryGeneration = useRef(0);
  const requestRecovery = useCallback(() => { recoveryStarted.current = false; setRecoveryWake((value) => value + 1); }, []);
  useEffect(() => {
    recoveryStarted.current = false;
    recoveryGeneration.current += 1;
  }, [pendingScopeKey]);

  useEffect(() => {
    if (!snapshotReady || recoveryStarted.current || revealRef.current || gradeResultRef.current) return;
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
    const isCurrent = () => mounted && recoveryGeneration.current === generation && pendingScopeKey === `${pendingScope.appVariant}:${pendingScope.apiUrl}:${pendingScope.accountId}`;
    void recoverPendingPurchase({
      scope: pendingScope,
      readPending: readPendingPurchase,
      clearPending: clearPendingPurchase,
      reroll: (input) => apiRef.current.reroll(input),
      isCurrent,
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
    }).then(async (status) => {
      // 이전 앱의 /shop/rerolls 요청을 먼저 복구한다. 같은 계정에 미확인 청구가 있으면 새 뽑기를 시작하지 않는다.
      if (status !== 'empty' || !isCurrent()) return;
      const stored = await readPendingGradeDraw(pendingScope);
      if (!stored || !isCurrent()) return;
      setDrawPending(stored); setSelectedGrade(stored.grade); setMachineOpen(true); setBusyGrade(stored.grade); setNotice(undefined);
      try {
        const result = await drawApiRef.current.draw(stored);
        if (!isCurrent()) return;
        await clearPendingGradeDraw(pendingScope).catch(() => undefined);
        if (!isCurrent()) return;
        setDrawPending(undefined); setGradeResult(result); setHistoryRefreshToken((value) => value + 1);
        void refreshDrawShop(); void shopRef.current.refreshQuietly(); void refreshExperience();
      } catch (error) {
        if (!isCurrent()) return;
        if (error instanceof ShopApiError && ['DRAW_STATE_CHANGED', 'DRAW_INSUFFICIENT_MILEAGE', 'DRAW_COIN_UNAVAILABLE'].includes(error.code)) {
          await clearPendingGradeDraw(pendingScope).catch(() => undefined);
          if (!isCurrent()) return;
          setDrawPending(undefined); void refreshDrawShop();
        }
        setNotice({ tone: 'error', text: shopErrorMessage(error) });
      } finally { if (isCurrent()) setBusyGrade(undefined); }
    }).catch((error) => { if (isCurrent()) setNotice({ tone: 'error', text: error instanceof Error ? error.message : shopErrorMessage(error) }); })
      .finally(() => { leaveShopPurchaseScope(lease); });
    return () => { mounted = false; recoveryGeneration.current += 1; };
  }, [pendingScope, pendingScopeKey, recoveryWake, snapshotReady, refreshExperience, refreshDrawShop, setDrawPending, setGradeResult]);


  async function refresh() {
    setRefreshing(true);
    setHistoryRefreshToken((value) => value + 1);
    try {
      const refreshed = await quietRefresh();
      await refreshDrawShop();
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

  async function buyGrade(pool: GradeDrawPool): Promise<boolean> {
    if (busyGrade || avatarBusy || experience.saving || refreshing || drawLoading) return false;
    const generation = recoveryGeneration.current;
    const isCurrent = () => recoveryGeneration.current === generation && drawApiRef.current === drawApi;
    const lease = enterShopPurchaseScope(pendingScope);
    if (!lease) { setNotice({ tone: 'error', text: '이전 구매 확인 중이에요. 결과를 받은 뒤 다시 시도해 주세요.' }); return false; }
    try {
      // 구버전 미확인 요청까지 확인해야 한 계정에서 두 번 차감되는 동시 구매를 막을 수 있다.
      if (await readPendingPurchase(pendingScope)) { requestRecovery(); return false; }
      const stored = await readPendingGradeDraw(pendingScope);
      if (!isCurrent()) return false;
      const attempt = stored ?? { grade: pool.grade, requestId: createRequestId(), expectedPoolVersion: pool.version };
      setDrawPending(attempt); setSelectedGrade(attempt.grade); setGradeResult(undefined); setBusyGrade(attempt.grade); setNotice(undefined);
      if (!stored) await writePendingGradeDraw(pendingScope, attempt);
      if (!isCurrent()) return false;
      const result = await drawApi.draw(attempt);
      if (!isCurrent()) return false;
      await clearPendingGradeDraw(pendingScope).catch(() => undefined);
      if (!isCurrent()) return false;
      setDrawPending(undefined); setGradeResult(result); setHistoryRefreshToken((value) => value + 1);
      void refreshDrawShop(); void shop.refreshQuietly(); void refreshExperience();
      return true;
    } catch (error) {
      if (!isCurrent()) return false;
      if (error instanceof ShopApiError && ['DRAW_STATE_CHANGED', 'DRAW_INSUFFICIENT_MILEAGE', 'DRAW_COIN_UNAVAILABLE'].includes(error.code)) {
        // 서버가 차감 전에 거절한 경우에만 새 요청을 만들 수 있다. 응답 유실/타임아웃은 같은 UUID로 복구한다.
        await clearPendingGradeDraw(pendingScope).catch(() => undefined);
        if (!isCurrent()) return false;
        setDrawPending(undefined);
        void refreshDrawShop();
      }
      setNotice({ tone: 'error', text: shopErrorMessage(error) });
      return false;
    } finally { if (isCurrent()) setBusyGrade(undefined); leaveShopPurchaseScope(lease); }
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

  const header = <AppHeader title={SHOP_TITLE} subtitle={SHOP_SUBTITLE} compact />;
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
  const selectedPool = drawShop?.pools.find((pool) => pool.grade === selectedGrade) ?? drawShop?.pools[0];
  const legacyMachine = Boolean(pending || reveal);
  const machine = !(gachaOnly ? gachaVisible : machineOpen) ? null : legacyMachine ? <GachaMachine
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
  /> : selectedPool ? <GradeDrawMachine
    pool={selectedPool} balance={drawShop?.balance ?? snapshot.mileage.balance} result={gradeResult}
    busy={Boolean(busyGrade) || avatarBusy || experience.saving} error={notice?.tone === 'error' ? notice.text : drawError}
    refreshing={refreshing} equipmentBusy={avatarBusy || experience.saving} equipmentError={avatarError ?? experience.error}
    avatarId={snapshot.avatar} equippedThemeId={gradeResult?.reward.kind === 'THEME' ? experience.snapshot?.profile.cosmetics[gradeResult.reward.slot] : undefined}
    onDraw={() => buyGrade(selectedPool)} onRecover={drawPending ? requestRecovery : undefined} onRecheckConsent={recheckConsent}
    onEquip={() => {
      const reward = gradeResult?.reward;
      if (reward?.kind === 'CHARACTER') void chooseAvatar(reward.id);
      if (reward?.kind === 'THEME') void experience.save({ cosmetics: { [reward.slot]: reward.id } });
    }}
    onOpenCollection={() => { setMachineOpen(false); setGradeResult(undefined); onGachaClose?.(); router.push('/coin-collection'); }}
    onClose={() => { setMachineOpen(false); setGradeResult(undefined); setAvatarError(undefined); onGachaClose?.(); }}
    onRefresh={() => { void refresh(); }}
  /> : <FullScreenModal visible animationType="fade" onRequestClose={onGachaClose ?? (() => setMachineOpen(false))}>
    <View style={{ flex: 1, justifyContent: 'center', backgroundColor: palette.background }}>
      <StateScene kind={drawError ? 'error' : 'loading'} title={drawError ?? '뽑기 목록을 불러오는 중'}
        action={drawError ? (drawError === consentRequiredMessage ? { label: consentRecheckLabel, onPress: recheckConsent }
          : { label: '다시 불러오기', onPress: () => { void refreshDrawShop(); } }) : undefined} />
      <BounceButton label="닫기" onPress={() => { setMachineOpen(false); onGachaClose?.(); }} />
    </View>
  </FullScreenModal>;
  if (gachaOnly) return machine;

  const bonusLabel = showcaseBonusLabel(snapshot.mileage.showcaseBonus);

  return sky(
    <>
      <Stagger index={0}>
        <FloatingCard style={styles.card}>
          <View style={styles.mileageRow}>
            <Image source={mileageCoinArt} style={styles.coin} accessible={false} accessibilityIgnoresInvertColors />
            <Text accessibilityLabel={`마일리지 ${drawShop?.balance ?? snapshot.mileage.balance}포인트`} style={styles.balance}>{formatMileage(drawShop?.balance ?? snapshot.mileage.balance)}</Text>
            <Mascot interactive pose="gift" size={56} />
          </View>
          {(drawShop?.balance ?? snapshot.mileage.balance) === 0 ? <StateScene kind="empty" title="마일리지가 아직 없어요" action={{ label: '가게 방문하고 마일리지 모으기', onPress: () => router.push('/search') }} framed={false} /> : null}
          {pending ? <BounceButton label="이전 구매 결과 다시 확인" disabled={Boolean(busyGrade) || avatarBusy || experience.saving || refreshing} onPress={requestRecovery} /> : null}
          {drawPending ? <BounceButton label="이전 뽑기 결과 다시 확인" disabled={Boolean(busyGrade) || avatarBusy || experience.saving || refreshing} onPress={requestRecovery} /> : null}
          {bonusLabel ? <Text style={styles.rulesText}>{bonusLabel}</Text> : null}
          <View accessibilityLiveRegion="polite">
            {experience.error ? <Text style={styles.errorMessage}>{experience.error}</Text> : null}
            {notice ? <Text style={notice.tone === 'success' ? styles.successMessage : styles.errorMessage}>{notice.text}</Text> : null}
          </View>
        </FloatingCard>
      </Stagger>

      <Stagger index={1}>
        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>{shopDrawHeading}</Text>
          <Text style={styles.sectionNote}>{shopDrawIntro}</Text>
          {drawShop ? drawShop.pools.map((grade) => (
            <GradeRow
              key={grade.grade}
              grade={grade}
              balance={drawShop.balance}
              busy={busyGrade === grade.grade}
              purchaseBusy={Boolean(busyGrade) || avatarBusy || experience.saving}
              onBuy={() => { setSelectedGrade(grade.grade); setGradeResult(undefined); setNotice(undefined); setMachineOpen(true); }}
              styles={styles}
            />
          )) : <StateScene kind={drawError ? 'error' : 'loading'} title={drawError ?? '뽑기 목록을 불러오는 중'}
            action={drawError ? (drawError === consentRequiredMessage ? { label: consentRecheckLabel, onPress: recheckConsent }
          : { label: '다시 불러오기', onPress: () => { void refreshDrawShop(); } }) : undefined} />}
          <FloatingCard style={styles.card} onPress={() => router.push('/coin-shop')}
            accessibilityLabel="가게 행사 코인 뽑기권" accessibilityHint="가게와 이벤트를 고르고 기간이 있는 코인 뽑기권을 확인합니다">
            <Text accessibilityRole="header" style={styles.sectionTitle}>가게 행사 뽑기권 ›</Text>
            <Text style={styles.sectionNote}>가게·행사별 한정 뽑기권과 사용 기한을 확인해요.</Text>
          </FloatingCard>
        </View>
      </Stagger>

      <Fold title="마일리지 획득 안내"><Text style={styles.rulesText}>{earnRulesText(snapshot.mileage.rules)}</Text></Fold>

      <Stagger index={2}>
        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>마이룸 가구·벽·바닥</Text>
          <Text style={styles.sectionNote}>상품은 실제 가게 카탈로그와 보관함을 기준으로 보여요. 가격이 정해지면 구매할 수 있어요.</Text>
          <BounceButton label="내 보관함 보기" onPress={() => router.push('/room-inventory')} />
          {furnitureMessage ? <Text accessibilityLiveRegion="polite" style={styles.sectionNote}>{furnitureMessage}</Text> : null}
          {furniturePending ? <BounceButton label="이전 가구 구매 결과 다시 확인" disabled={furnitureBusy} onPress={() => void buyFurniture(furniturePending)} /> : null}
          {furnitureError ? <BounceButton label="가구 목록 다시 불러오기" onPress={() => void refreshFurniture()} /> : null}
          {!furniture && !furnitureError ? <StateScene kind="loading" title="가구를 불러오는 중" /> : null}
          {furniture?.catalog.length === 0 ? <Text style={styles.historyEmpty}>등록된 가구가 아직 없어요.</Text> : null}
          {furniture?.catalog.map((item) => {
            const owned = furniture.inventory.some((entry) => entry.itemId === item.id);
            return <FloatingCard key={item.id} style={styles.card}>
              <View style={{ alignSelf: 'center', minHeight: 84, justifyContent: 'center' }}><FurnitureArt assetId={item.assetId} name={item.name} size={84} /></View>
              <Text style={styles.sectionTitle}>{item.name}</Text>
              <Text style={styles.sectionNote}>{item.kind === 'FURNITURE' ? '가구' : item.kind === 'WALL' ? '벽' : '바닥'} · {owned ? '보관함에 있음'
                : item.priceMileage === null || !item.sellable ? '판매 준비 중' : `${item.priceMileage.toLocaleString('ko-KR')}P`}</Text>
              {owned ? <BounceButton label="마이룸에서 배치하기" onPress={() => router.push('/studio')} /> :
                <BounceButton label={item.sellable && item.priceMileage !== null ? '상품 보기' : '가격 미정 · 구매 불가'}
                  disabled={!item.sellable || item.priceMileage === null || Boolean(furniturePending)} onPress={() => setFurnitureChoice(item)} />}
            </FloatingCard>;
          })}
          {furnitureChoice ? <FloatingCard style={styles.card}>
            <View style={{ alignSelf: 'center' }}><FurnitureArt assetId={furnitureChoice.assetId} name={furnitureChoice.name} size={112} /></View>
            <Text accessibilityRole="header" style={styles.sectionTitle}>구매 확인 · {furnitureChoice.name}</Text>
            <Text style={styles.sectionNote}>{furnitureChoice.priceMileage?.toLocaleString('ko-KR')}P를 사용해 보관함에 넣어요.</Text>
            <BounceButton label={furnitureBusy ? '처리 중…' : '구매하고 보관함에 넣기'} disabled={furnitureBusy || Boolean(furniturePending)} onPress={() => void buyFurniture()} />
            <BounceButton label="취소" disabled={furnitureBusy} onPress={() => setFurnitureChoice(undefined)} />
          </FloatingCard> : null}
        </View>
      </Stagger>

      {experience.snapshot ? <ThemePackBoard snapshot={experience.snapshot} /> : null}

      <Stagger index={2}>
        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>가게 친구</Text>
          <View style={styles.grid}>
            {grid.map((cell) => <FriendCell key={cell.id} cell={cell} onPress={() => confirmAvatar(cell)} styles={styles} />)}
          </View>
        </View>
      </Stagger>

      <Stagger index={3}>
        <>
          <FloatingCard style={styles.card}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>최근 전체 랜덤 뽑기</Text>
            {drawShop?.history.length ? drawShop.history.map((entry) => <View key={entry.drawId} style={styles.historyRow}>
              <View style={styles.historyCopy}>
                <Text style={styles.historyName}>{gradeLabel(entry.grade)} · {entry.reward.name}</Text>
                <Text style={styles.historyMeta}>{entry.reward.kind === 'COIN' ? '가게 코인' : entry.reward.kind === 'THEME' ? '테마 꾸미기'
                  : entry.reward.kind === 'CHARACTER' ? '캐릭터' : entry.reward.kind === 'MILEAGE' ? '마일리지'
                    : entry.reward.kind === 'FURNITURE' ? '가구' : '리롤권'} · {new Date(entry.createdAt).toLocaleDateString('ko-KR')}</Text>
              </View>
              <Text style={styles.historyAmount}>-{formatMileage(entry.price)}</Text>
            </View>) : <Text style={styles.historyEmpty}>아직 뽑은 기록이 없어요.</Text>}
          </FloatingCard>
          <HistorySection api={api} refreshToken={historyRefreshToken} />
        </>
      </Stagger>
    </>,
    machine,
  );
}

function GradeRow({ grade, balance, busy, purchaseBusy, onBuy, styles }: {
  grade: GradeDrawPool; balance: number; busy: boolean; purchaseBusy: boolean; onBuy: () => void;
  styles: ReturnType<typeof useShopStyles>;
}) {
  const button = grade.total <= 0 ? { disabled: true, reason: '뽑기 목록을 준비 중이에요' }
    : balance < grade.price ? { disabled: true, reason: `마일리지 ${formatMileage(grade.price - balance)} 부족` }
      : { disabled: false, reason: undefined };
  // 다른 등급을 구매하는 동안에도 전부 비활성화해 눌러도 조용히 무시되는 상태를 피한다.
  const disabled = button.disabled || purchaseBusy;
  return (
    <FloatingCard style={styles.card}>
      <View style={styles.gradeHeader}>
        <PackArt grade={grade.grade} size={80} />
        <View style={styles.gradeCopy}>
          <Text style={styles.gradeName}>{gradeLabel(grade.grade)} 전체 랜덤</Text>
          <Text style={styles.gradePrice}>가격 {formatMileage(grade.price)}</Text>
          <Text style={styles.gradeOwned}>마일리지 · 가구 · 꾸미기 · 리롤권</Text>
        </View>
      </View>
      <Fold title="뽑기 확률 보기">{grade.rewards.map((entry) => <Text key={`${entry.rarity}:${entry.reward.kind}:${entry.reward.id}`} style={styles.disclosure}>
        {entry.reward.name} · {(entry.probability * 100).toLocaleString('ko-KR', { maximumFractionDigits: 4 })}%
      </Text>)}</Fold>
      {button.reason || (purchaseBusy && !busy) ? <Text style={styles.disabledReason}>{button.reason ?? '다른 작업을 처리하고 있어요'}</Text> : null}
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
