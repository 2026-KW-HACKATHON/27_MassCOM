import * as Application from 'expo-application';
import { Link, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useColorScheme, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AccountCredential } from '@/auth/account-credential';
import {
  clearFinalizedNotice,
  initialPollingState,
  nextPollingState,
  resolveCollectionLoad,
  type PollingState,
} from '@/commerce/collection-recovery';
import { CommerceApiError, createCommerceApiClient, type CollectionSnapshot } from '@/commerce/commerce-api';
import { createBadgeApiClient, type Coupon, type MedalKind, type OpenedReward, type RewardMilestone } from '@/gamification/badge-api';
import { shouldRefreshBadgesQuietly } from '@/gamification/badge-refresh';
import { couponsOf, explorerRank, shouldStackTrio, type ShareVariant } from '@/gamification/badge-rules';
import { CouponTicket } from '@/gamification/coupon-ticket';
import { CouponUseSheet } from '@/gamification/coupon-use-sheet';
import { MedalDetail } from '@/gamification/medal-detail';
import { MedalShelf, MedalShelfSkeleton, SectionRetry } from '@/gamification/medal-shelf';
import { PassportHero } from '@/gamification/passport-hero';
import { RewardReveal } from '@/gamification/reward-reveal';
import { RewardTrack } from '@/gamification/reward-track';
import { useBadgeBook } from '@/gamification/use-badge-book';
import { useMerchantCatalog } from '@/merchant/use-merchant-catalog';
import { useTabBarClearance } from '@/navigation/use-tab-bar-clearance';
import { colorsForScheme } from '@/theme/palette';
import { AppHeader } from '@/ui/app-header';
import { Fold } from '@/ui/fold';
import { FloatingCard } from '@/ui/floating-card';
import { PassportStampPage } from '@/ui/passport-stamp-page';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';
import { StateScene } from '@/ui/state-scene';
import { WalletApiClient, type ActiveWalletBindingResponse } from '@/wallet/wallet-api';

import { collectibleFocusAction, parseEntitlementIds, resolveCollectibleLink } from './collectible-focus';
import { collectionCounts, shouldStackCounts } from './collection-counts';
import { CollectibleBrowser } from './collectible-browser';
import { CollectibleDetail } from './collectible-detail';
import { groupCollectibles, ungroupedCollectibles } from './collectible-groups';
import { CollectibleReveal } from './collectible-reveal';
import { useCollectibleShare } from './collectible-share';
import { buildMerchantGoals, buildStampSlots, toPassportStamp } from './collection-stamps';
import { readFavorites, readShownReactions, writeFavorites, writeShownReactions } from './collection-prefs-storage';
import { favoritesBaseForWrite, toggleFavorite } from './collection-prefs';
import {
  visibleReactionEvent,
  dismissReactionEvent,
  eligibleReactionEvents,
  enqueueReactionEvents,
  pendingReactionEvents,
  reactionKeyToPersist,
  type ReactionEvent,
} from './mascot-reactions';
import { MascotReactionToast } from './mascot-reaction-toast';
import { chainLabel, mintRefusalText } from './nft-status';
import { mintConsentMessage, mintConsentTitle, mintConsentVersion } from './mint-consent';
import { buildStoreSeries } from './store-series';
import { useCollectionStyles } from './use-collection-styles';

/**
 * #314: a render error elsewhere (e.g. an array style reaching expo-router's `<Slot>`, see collectible-browser.tsx)
 * can make expo-router tear down and remount the Root Layout while this tab's own effect cleanup is mid-flight.
 * `useNavigationContainerRef()` only returns the ref captured at this component's last render — by the time an
 * unmount cleanup runs, the global router may have already swapped to a fresh, not-yet-ready one, so that ref
 * still (wrongly) reports itself ready and cannot gate this safely. expo-router has no public hook that reads
 * live readiness outside of a render, so this catches its own documented failure instead of guessing beforehand.
 * The params are only being cleared as tidy-up here; if the navigator is gone there is nothing left to clear.
 */
function clearCollectionFocusParams(router: ReturnType<typeof useRouter>, params: { focus: undefined; entitlement?: undefined }): void {
  try {
    router.setParams(params);
  } catch (caught) {
    if (!(caught instanceof Error) || !caught.message.includes('mounting the Root Layout')) throw caught;
  }
}

export function CollectionScreen({
  apiUrl,
  accountId,
  credential,
  onSessionInvalid,
}: {
  apiUrl: string;
  accountId: string;
  credential: AccountCredential;
  onSessionInvalid: () => Promise<void>;
}) {
  const clearance = useTabBarClearance();
  const insets = useSafeAreaInsets();
  const isShowcase = Application.applicationId === 'kr.masscom.wolgye.demo';
  const variant: ShareVariant = isShowcase ? 'showcase' : 'production';
  const palette = colorsForScheme(useColorScheme());
  const styles = useCollectionStyles();
  const { width, fontScale } = useWindowDimensions();
  const stackCounts = shouldStackCounts(width, fontScale);
  const stackTrio = shouldStackTrio(width, fontScale);
  const api = useMemo(
    () => createCommerceApiClient({ apiUrl, credential, onSessionInvalid }),
    [apiUrl, credential, onSessionInvalid],
  );
  const walletApi = useMemo(
    () => new WalletApiClient({ apiUrl, credential, onSessionInvalid }),
    [apiUrl, credential, onSessionInvalid],
  );
  const badgeApi = useMemo(
    () => createBadgeApiClient({ apiUrl, credential, onSessionInvalid }),
    [apiUrl, credential, onSessionInvalid],
  );
  const badges = useBadgeBook(badgeApi);
  const router = useRouter();
  const { focus, entitlement } = useLocalSearchParams<{ focus?: string; entitlement?: string | string[] }>();
  const scrollView = useRef<ScrollView>(null);
  // #314: only sky()'s loading/error scene uses this (the loaded album below uses `scrollView` above).
  const skyScrollView = useRef<ScrollView>(null);
  // #320 review: onContentSizeChange can re-fire with no real growth (e.g. a retry re-render keeps the same
  // error height) — tracked here so the re-scroll below only fires on an actual increase, not every call.
  const skyContentHeight = useRef(0);
  const [rewardsY, setRewardsY] = useState<number>();
  // #296 review: the reward track lives inside a collapsed-by-default Fold; this tracks whether it is open so a
  // `focus=rewards` link and the passport's "보상" button can force it open instead of scrolling to a hidden card.
  const [rewardsFoldExpanded, setRewardsFoldExpanded] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [detailKind, setDetailKind] = useState<MedalKind>();
  const [revealed, setRevealed] = useState<OpenedReward>();
  const [usingCoupon, setUsingCoupon] = useState<Coupon>();
  const [collectibleDetail, setCollectibleDetail] = useState<{ entitlementId: string; merchantName: string; client: typeof api; intro?: boolean }>();
  // 297번 봉투 열기 연출: 방문 수령 직후에만 채워지고, 건너뛰거나 상세로 넘어가면 비운다. 저장은 이미 끝난 상태라 여기서 뭘 하든 보상엔 영향이 없다.
  const [revealEntitlement, setRevealEntitlement] = useState<{ entitlementIds: readonly string[]; merchantName: string }>();
  const [favorites, setFavorites] = useState<readonly string[]>([]);
  const shownReactions = useRef<Set<string>>(new Set());
  const favoritesRef = useRef<readonly string[]>([]);
  const favoritesReadFailed = useRef(false);
  // 대표 진열·마스코트 반응의 저장된 값을 계정별 저장소에서 다 읽을 때까지는 참(true)이 아니다.
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  // 화면은 한 번에 하나씩만 반응을 보인다. 큐의 머리만 실제로 보여준 것이라 그것만 "본 것"으로 기록한다(그 아래 effect).
  const [reactionQueue, setReactionQueue] = useState<readonly ReactionEvent[]>([]);
  const { host: shareHost, share: shareCollectible, sharing } = useCollectibleShare();
  const [polling, setPolling] = useState<PollingState>();
  const [binding, setBinding] = useState<ActiveWalletBindingResponse['binding']>();
  const [bindingError, setBindingError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyEntitlementId, setBusyEntitlementId] = useState<string>();
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [pollingRetrying, setPollingRetrying] = useState(false);
  // 조회를 시작할 때마다 올리는 세대. 나중에 시작한 조회가 먼저 적용되면 오래된 응답은 버린다.
  const requestGeneration = useRef(0);
  const startRequest = useCallback(() => ++requestGeneration.current, []);
  const applySnapshot = useCallback((snapshot: CollectionSnapshot, generation: number) => {
    setPolling((current) => current
      ? nextPollingState(current, { type: 'success', snapshot, generation })
      : initialPollingState(snapshot, generation));
  }, []);
  const collection = polling?.snapshot;
  const loadCollectible = useCallback((entitlementId: string) => api.getCollectible(entitlementId), [api]);

  // focus=collectible 링크를 시도할 때마다 올리는 세대. 탭을 떠나거나 새 링크가 시작되면 세대를 올려, 그 전 시도의 재조회가
  // 나중에 끝나도 (이미 떠난) 그 결과로 연출을 다시 열지 않게 막는다(resolveCollectibleLink가 이 값을 확인한다).
  const linkGeneration = useRef(0);

  // 탭을 떠나면 상세뿐 아니라 획득 연출도 닫는다(둘 다 그 사이 새로 받은 수집품에만 걸린 일회성 화면이다).
  // 탭을 떠날 때 처리 중이던 획득 링크도 버린다(돌아왔을 때 닫았던 연출이 다시 열리지 않게). 링크 처리는 탭이 보일 때만 한다.
  const [tabFocused, setTabFocused] = useState(false);
  // 마스코트 반응은 도감 탭이 보이고 획득 연출·상세·보상 상자·메달 상세·쿠폰 같은 전체 화면이 덮지 않을 때만 띄우고 "본 것"으로 기록한다.
  const reactionOnScreen = tabFocused && !revealEntitlement && !collectibleDetail && !revealed && !detailKind && !usingCoupon;
  const reactionEvent = visibleReactionEvent(reactionQueue, reactionOnScreen);
  useFocusEffect(useCallback(() => {
    setTabFocused(true);
    return () => {
      setTabFocused(false);
      setCollectibleDetail(undefined);
      setRevealEntitlement(undefined);
      linkGeneration.current += 1;
      clearCollectionFocusParams(router, { focus: undefined, entitlement: undefined });
    };
  }, [setCollectibleDetail, setRevealEntitlement, router]));

  // 대표 진열·마스코트 반응 기록은 계정별 로컬 저장소에서 읽는다. 화면은 계정마다 새로 마운트되므로(라우트의 key=accountId) 한 번만 읽으면 된다.
  useEffect(() => {
    let active = true;
    void Promise.all([readFavorites(accountId), readShownReactions(accountId)]).then(([favoritesValue, shownValue]) => {
      if (!active) return;
      favoritesReadFailed.current = favoritesValue === undefined;
      favoritesRef.current = favoritesValue ?? [];
      setFavorites(favoritesRef.current);
      shownReactions.current = new Set(shownValue);
      setPrefsLoaded(true);
    });
    return () => { active = false; };
  }, [accountId]);

  const toggleCollectibleFavorite = useCallback((key: string) => {
    // 저장된 값을 아직 못 읽었으면 무시한다: 지금 건드리면 빈 초기값 위에 쓰게 되고, 뒤늦게 도착하는 실제 값이 그 변경을 덮어써 버린다.
    if (!prefsLoaded) return;
    // 저장소 읽기가 실패했으면 첫 쓰기 전에 다시 읽는다. 다시 읽기도 실패하면 저장된 대표 진열을 빈 목록으로 덮지 않게 쓰지 않는다.
    void favoritesBaseForWrite(favoritesRef.current, favoritesReadFailed.current, () => readFavorites(accountId)).then((base) => {
      if (base === undefined) return;
      favoritesReadFailed.current = false;
      const next = toggleFavorite(base, key);
      favoritesRef.current = next;
      setFavorites(next);
      void writeFavorites(accountId, next);
    });
  }, [accountId, prefsLoaded]);

  // Acquisition links open every entitlement this visit granted (297번: 1·3·5회 목표가 한 번에 여럿이면 모두), comma-joined
  // into the one `entitlement` param. A legacy reward without artwork still remains successfully collected.
  // The tab stays mounted, so the snapshot may predate the reward just received: when an entitlement is missing, re-read
  // the collection once through the same generation-gated path as every other read, then open it or show the message.
  const collectibleLink = useRef<{ rereadFor?: string; doneFor?: string }>({});
  useEffect(() => {
    if (focus !== 'collectible') { collectibleLink.current = {}; return; }
    // 탭을 떠난 뒤 늦게 끝난 재조회가 도감을 갱신해도 이 effect가 새 세대로 다시 열지 않게, 보이는 동안에만 처리한다.
    if (!tabFocused) return;
    const link = collectibleLink.current;
    // entitlement는 보통 콤마로 묶인 문자열 하나지만, 쿼리 키가 반복되면(`?entitlement=a&entitlement=b`) 라우터가 배열로
    // 돌려준다; 둘 다 받아 콤마 분리·중복 제거까지 한 번에 하는 parseEntitlementIds를 거친다. 비교·캐시 키는 원래 값(entitlement)
    // 대신 이 정규화된 목록의 join으로 쓴다 — 중복 제거 전 값으로 비교하면 "a,a,b"와 "a,b"를 다른 링크로 취급하게 된다.
    const ids = parseEntitlementIds(entitlement);
    const linkKey = ids.join(',');
    if (!collection || link.doneFor === linkKey) return;
    // 이 시도만의 세대: 탭을 떠나거나(위 useFocusEffect) 다른 링크가 새로 시작되면(이 effect가 다시 돎) 세대가 올라가
    // resolveCollectibleLink가 이 시도의 뒤늦은 결과를 무시하게 한다. 도감 조회 자체의 세대(startRequest/generation)와는
    // 별개다: 저건 오래된 조회 응답을 거르고, 이건 이미 떠난 링크가 열어보려는 연출을 거른다.
    const linkAttempt = ++linkGeneration.current;
    const finish = (snapshot: CollectionSnapshot) => {
      const outcomes = ids.map((id) => resolveCollectibleLink(snapshot, id, linkAttempt, () => linkGeneration.current));
      if (outcomes.some((outcome) => outcome.action === 'stale')) return;
      link.doneFor = linkKey;
      const opened = outcomes.flatMap((outcome) => (outcome.action === 'open' ? [outcome] : []));
      // 방문 수령 직후 도착한 링크만 획득 연출을 연다; 전달은 이미 끝난 뒤라 연출을 건너뛰어도 보관 상태는 그대로다.
      if (opened.length > 0) setRevealEntitlement({ entitlementIds: opened.map((outcome) => outcome.entitlementId), merchantName: opened[0]!.merchantName });
      else setMessage('보상은 도감에 보관됐어요. 다시 볼 수 있는 가게 수집품은 아직 없어요.');
      clearCollectionFocusParams(router, { focus: undefined, entitlement: undefined });
    };
    if (ids.some((id) => collectibleFocusAction(collection, id, link.rereadFor === linkKey) === 'fetch')) {
      link.rereadFor = linkKey;
      const generation = startRequest();
      void api.getCollection().then((next) => { applySnapshot(next, generation); finish(next); }, () => finish(collection));
      return;
    }
    const timer = setTimeout(() => finish(collection), 0);
    return () => clearTimeout(timer);
  }, [focus, entitlement, collection, router, api, startRequest, applySnapshot, tabFocused]);
  const { merchants: publicMerchants, loading: merchantsLoading, error: merchantsError, retry: retryMerchants, refresh: refreshMerchants } = useMerchantCatalog(apiUrl);
  const stampSlots = useMemo(
    () => buildStampSlots(publicMerchants, collection?.visits ?? []),
    [publicMerchants, collection],
  );
  const artUrlByMerchant = useMemo(() => new Map(publicMerchants.map((merchant) => [merchant.id, merchant.artUrl])), [publicMerchants]);
  const merchantGoals = buildMerchantGoals(publicMerchants, collection?.visits ?? [], collection?.collectibles ?? [], new Date().toISOString());
  const collectibleGroups = useMemo(() => groupCollectibles(collection?.collectibles ?? []), [collection]);
  const storeSeries = useMemo(() => buildStoreSeries(publicMerchants, collection?.collectibles ?? []), [publicMerchants, collection]);

  // 17.1 마스코트 반응: 새로 자격을 얻은 이벤트를 큐에 더한다(이미 큐에 있거나 이미 보여준 것은 다시 넣지 않는다). 큐 조작은
  // mascot-reactions.ts의 controller 함수(enqueue/currentReactionEvent/reactionKeyToPersist/dismissReactionEvent)만 쓴다:
  // 여기서 직접 배열을 자르거나 큐 전체를 "본 것"으로 기록하지 않는다(그게 한 번에 여러 반응을 놓치던 원래 버그였다).
  useEffect(() => {
    if (!prefsLoaded) return;
    const eligible = eligibleReactionEvents(collectibleGroups, storeSeries);
    const pending = pendingReactionEvents(eligible, shownReactions.current);
    if (pending.length === 0) return;
    setReactionQueue((current) => enqueueReactionEvents(current, pending));
  }, [prefsLoaded, collectibleGroups, storeSeries]);

  // 큐의 머리만 화면에 실제로 뜬 것이므로 그것만 "본 것"으로 기록한다: 한 틱에 여러 개가 자격을 얻어도 하나씩만 보이고,
  // 나머지는 자기 차례가 와서 실제로 보일 때 각자 기록된다(한꺼번에 지금 다 기록하면 아직 안 보여준 것도 사라진다).
  useEffect(() => {
    const key = reactionKeyToPersist(reactionQueue, shownReactions.current, reactionOnScreen);
    if (!key) return;
    shownReactions.current = new Set([...shownReactions.current, key]);
    void writeShownReactions(accountId, shownReactions.current);
  }, [reactionQueue, accountId, reactionOnScreen]);

  const handleDismissReaction = useCallback(() => setReactionQueue(dismissReactionEvent), []);
  const legacyCollectibles = useMemo(() => ungroupedCollectibles(collection?.collectibles ?? []), [collection]);
  const detailMedal = badges.book?.medals.find((medal) => medal.kind === detailKind);
  const coupons = couponsOf(badges.book);

  useEffect(() => {
    let active = true;
    const generation = startRequest();
    void Promise.allSettled([api.getCollection(), walletApi.getActiveBinding()])
      .then(([collectionResult, bindingResult]) => {
        if (!active) return;
        const resolved = resolveCollectionLoad(collectionResult, bindingResult);
        if (!resolved.ok) {
          setError('도감을 불러오지 못했습니다. API 연결을 확인해 주세요.');
          return;
        }
        applySnapshot(resolved.collection, generation);
        setBinding(resolved.binding);
        setBindingError(resolved.bindingError
          ? '도감은 불러왔지만 지갑 상태는 확인하지 못했습니다.'
          : undefined);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, walletApi, startRequest, applySnapshot]);

  useEffect(() => {
    if (polling?.mode !== 'polling') return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const generation = startRequest();
      try {
        const next = await api.getCollection();
        if (active) applySnapshot(next, generation);
      } catch {
        if (active) {
          setPolling((current) => current
            ? nextPollingState(current, { type: 'failure', generation })
            : current);
        }
      } finally {
        if (active) timer = setTimeout(() => void poll(), 3_000);
      }
    }
    timer = setTimeout(() => void poll(), 3_000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [api, polling?.mode, startRequest, applySnapshot]);

  // The tab stays mounted; coming back after a visit claim quietly picks up new stamps and badges.
  const focusCount = useRef(0);
  const { refreshQuietly: refreshBadgesQuietly } = badges;

  // "도감에서 상자 열기" arrives with ?focus=rewards. The reward track sits inside a Fold that starts collapsed and
  // unmounts its body, so merely scrolling to a measured y never worked: force that fold open, then scroll to its
  // own position (reported by Fold's onLayout below on its root view, so it is known whether expanded or not).
  useEffect(() => {
    if (focus !== 'rewards') return;
    // Deferred (not called synchronously in the effect body) to avoid cascading renders.
    const expandTimer = setTimeout(() => setRewardsFoldExpanded(true), 0);
    if (rewardsY === undefined) return () => clearTimeout(expandTimer);
    // Clear the param inside the frame: clearing it first re-runs this effect and cancels the scroll.
    const frame = requestAnimationFrame(() => {
      scrollView.current?.scrollTo({ y: Math.max(0, headerHeight + rewardsY - 12), animated: true });
      clearCollectionFocusParams(router, { focus: undefined });
    });
    return () => { clearTimeout(expandTimer); cancelAnimationFrame(frame); };
  }, [focus, headerHeight, rewardsY, router]);

  // Same fold-aware scroll for the in-app "보상" button (PassportHero, inside the "메달·배지 더보기" fold): the
  // rewards fold may still be collapsed even though the passport's own fold is open.
  const scrollToRewards = useCallback(() => {
    setRewardsFoldExpanded(true);
    scrollView.current?.scrollTo({ y: Math.max(0, headerHeight + (rewardsY ?? 0) - 12), animated: true });
  }, [headerHeight, rewardsY]);

  useFocusEffect(useCallback(() => {
    focusCount.current += 1;
    if (focusCount.current === 1) return;
    void refreshBadgesQuietly();
    const generation = startRequest();
    void Promise.allSettled([api.getCollection(), walletApi.getActiveBinding()]).then(([collectionResult, bindingResult]) => {
      const resolved = resolveCollectionLoad(collectionResult, bindingResult);
      if (!resolved.ok) return;
      applySnapshot(resolved.collection, generation);
      setBinding(resolved.binding);
      if (!resolved.bindingError) setBindingError(undefined);
    });
  }, [api, walletApi, refreshBadgesQuietly, startRequest, applySnapshot]));

  async function refresh() {
    setRefreshing(true);
    setError(undefined);
    const generation = startRequest();
    try {
      const [collectionResult, bindingResult] = await Promise.allSettled([
        api.getCollection(),
        walletApi.getActiveBinding(),
        refreshMerchants(),
        badges.status === 'ready' ? badges.refreshQuietly() : badges.retry(),
      ]);
      const resolved = resolveCollectionLoad(collectionResult, bindingResult);
      if (!resolved.ok) {
        setError('최신 도감을 가져오지 못했습니다. 기존 내용은 유지합니다.');
      } else {
        applySnapshot(resolved.collection, generation);
        setBinding(resolved.binding);
        setBindingError(resolved.bindingError
          ? '도감은 갱신했지만 지갑 상태는 확인하지 못했습니다.'
          : undefined);
      }
    } finally {
      setRefreshing(false);
    }
  }

  async function refreshBinding() {
    setBindingError(undefined);
    try {
      setBinding((await walletApi.getActiveBinding()).binding);
    } catch {
      setBindingError('지갑 상태를 확인하지 못했습니다. 도감과 방문 기록은 유지됩니다.');
    }
  }

  async function retryPolling() {
    if (!polling || pollingRetrying) return;
    setPollingRetrying(true);
    const generation = startRequest();
    try {
      applySnapshot(await api.getCollection(), generation);
    } catch {
      setError('NFT 등록 작업 결과를 다시 확인하지 못했습니다. 접수는 취소되지 않았습니다.');
    } finally {
      setPollingRetrying(false);
    }
  }

  function confirmMint(entitlementId: string) {
    if (!binding) return;
    Alert.alert(
      mintConsentTitle,
      mintConsentMessage(binding.address, chainLabel(binding.chainId)),
      [
        { text: '취소', style: 'cancel' },
        {
          text: '주소 확인 후 접수',
          onPress: () => void submitMint(entitlementId),
        },
      ],
    );
  }

  async function submitMint(entitlementId: string) {
    if (!binding || busyEntitlementId) return;
    setBusyEntitlementId(entitlementId);
    setError(undefined);
    setMessage(undefined);
    // 이전 확정 알림이 아래 접수 안내를 가리지 않도록 접수하기 전에 지운다.
    setPolling((current) => current ? clearFinalizedNotice(current) : current);
    const idempotencyKey =
      `mint-${binding.bindingId}-${binding.bindingVersion}-${entitlementId}`;
    try {
      const result = await api.requestMint({
        entitlementId,
        walletBindingId: binding.bindingId,
        bindingVersion: binding.bindingVersion,
        consentVersion: mintConsentVersion,
        idempotencyKey,
      });
      setMessage(
        result.replayed
          ? '이미 접수한 NFT 작업을 다시 불러왔습니다.'
          : 'NFT 발행을 접수했습니다. 아직 블록체인 등록 완료가 아닙니다.',
      );
      const generation = startRequest();
      applySnapshot(await api.getCollection(), generation);
    } catch (caught) {
      setError(mintErrorMessage(caught));
    } finally {
      setBusyEntitlementId(undefined);
    }
  }

  const openReward = useCallback((milestone: RewardMilestone) => badgeApi.openReward(milestone), [badgeApi]);
  const { applyOpened, replace: replaceBadgeBook } = badges;
  const onRevealed = useCallback((result: OpenedReward) => {
    applyOpened(result);
    setRevealed(result);
  }, [applyOpened, setRevealed]);
  const onOpenFailed = useCallback((code: string | undefined) => {
    if (shouldRefreshBadgesQuietly(code)) void refreshBadgesQuietly();
  }, [refreshBadgesQuietly]);
  const loadBadgeBook = useCallback(() => badgeApi.getBadgeBook(), [badgeApi]);
  const createIdentity = useCallback(() => api.createCustomerIdentity(), [api]);
  const revokeIdentity = useCallback((token: string) => api.revokeCustomerIdentity(token), [api]);

  // The header (sky art included) is the first thing inside the scroll content, so it scrolls away with the page.
  // Option A(#296): the full PassportHero no longer opens the screen; a one-line strip takes its place here, and the
  // full card moves into the "메달·배지 더보기" fold below.
  const header = (
    <AppHeader title="도감" subtitle="가본 가게마다 도장이 찍혀요">
      {badges.book ? <CompactPassportStrip book={badges.book} /> : null}
    </AppHeader>
  );
  // #314: the sky header art leaves little room under it, and the loading/error scene (mascot + title + a wrapped
  // error body + retry button) can end up just tall enough to need scrolling past the floating tab bar — with
  // nothing on screen hinting the retry button is reachable at all. `contentOffset` only applies on first mount,
  // but this view mounts once while still showing the short "loading" scene and only grows once it flips to the
  // (taller) error scene, so it must re-scroll whenever the content's measured size changes instead. A scene that
  // already fits just no-ops here (nothing left to scroll to).
  const onSkyContentSizeChange = useCallback((_width: number, height: number) => {
    // #320 review: this can re-fire with no real growth (e.g. retrying keeps the same error height) — only
    // re-scroll on an actual increase, so it never yanks someone who scrolled back up to reread the error.
    if (height <= skyContentHeight.current) return;
    skyContentHeight.current = height;
    // A plain scrollTo() here is a no-op: at the moment this fires the native side has only just learned the new
    // size and has not yet applied it to the scrollable area, so the call is clamped against the still-stale
    // (shorter) range. Deferring one frame lets that settle first.
    requestAnimationFrame(() => skyScrollView.current?.scrollTo({ y: height, animated: false }));
  }, []);
  const sky = (body: ReactNode) => (
    <SkyBackdrop>
      <SkyScrollView
        ref={skyScrollView}
        header={header}
        onHeaderLayout={setHeaderHeight}
        contentContainerStyle={[styles.content, { paddingBottom: clearance }]}
        onContentSizeChange={onSkyContentSizeChange}
      >
        {body}
      </SkyScrollView>
    </SkyBackdrop>
  );

  if (loading && !collection) {
    return sky(<StateScene kind="loading" title="방문 도감을 펼치는 중" />);
  }

  if (!collection) {
    return sky(
      <StateScene kind="error" title="도감을 불러오지 못했어요" body={error} action={{ label: '다시 불러오기', onPress: () => { void refresh(); } }} />,
    );
  }

  const summary = collectionCounts(collection);

  return (
    <SkyBackdrop>
      <SkyScrollView
        ref={scrollView}
        header={header}
        onHeaderLayout={setHeaderHeight}
        contentContainerStyle={[styles.content, { paddingBottom: clearance }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} progressViewOffset={insets.top} />}
      >
        <Section title="내 수집 앨범" note="가게·시즌·등급으로 찾아보고, 좋아하는 수집품을 대표로 놓아요.">
          <CollectibleBrowser
            groups={collectibleGroups}
            legacy={legacyCollectibles}
            artUrlByMerchant={artUrlByMerchant}
            series={storeSeries}
            favorites={favorites}
            sharing={sharing}
            mint={{ apiUrl, nftMinting: collection.nftMinting, binding, busyEntitlementId, onConfirmMint: confirmMint }}
            onToggleFavorite={toggleCollectibleFavorite}
            onOpenDetail={(entitlementId, merchantName) => setCollectibleDetail({ entitlementId, merchantName, client: api })}
            onShare={(group) => void shareCollectible({ thumbnailDataUrl: group.artwork.thumbnailDataUrl, merchantName: group.merchantName, name: group.artwork.name })}
          />
        </Section>

        {error ? <Text style={[styles.inlineError, { color: palette.onErrorContainer, backgroundColor: palette.errorContainer }]}>{error}</Text> : null}
        {bindingError ? (
          <View style={[styles.recoveryBanner, { backgroundColor: palette.errorContainer }]}>
            <Text selectable style={[styles.recoveryText, { color: palette.onErrorContainer }]}>{bindingError}</Text>
            <Pressable accessibilityRole="button" onPress={() => void refreshBinding()} style={[styles.recoveryButton, { backgroundColor: palette.surface }]}>
              <Text style={[styles.recoveryButtonText, { color: palette.primary }]}>지갑 상태 다시 확인</Text>
            </Pressable>
          </View>
        ) : null}
        {polling?.mode === 'manual-retry' ? (
          <View accessibilityLiveRegion="polite" style={[styles.recoveryBanner, { backgroundColor: palette.errorContainer }]}>
            <Text selectable style={[styles.recoveryText, { color: palette.onErrorContainer }]}>
              NFT 등록 작업 결과를 확인하지 못했습니다. 접수는 취소되지 않았습니다.
            </Text>
            <Pressable
              accessibilityRole="button"
              disabled={pollingRetrying}
              onPress={() => void retryPolling()}
              style={[styles.recoveryButton, { backgroundColor: palette.surface }, pollingRetrying && styles.disabled]}
            >
              <Text style={[styles.recoveryButtonText, { color: palette.primary }]}>{pollingRetrying ? '확인 중…' : '지금 다시 확인'}</Text>
            </Pressable>
          </View>
        ) : null}
        {polling?.message === 'NFT_FINALIZED' ? (
          <Text accessibilityLiveRegion="polite" style={[styles.inlineMessage, { color: palette.onPrimaryContainer, backgroundColor: palette.primaryContainer }]}>
            NFT가 블록체인 이벤트 대조를 거쳐 등록 완료됐습니다.
          </Text>
        ) : message ? <Text style={[styles.inlineMessage, { color: palette.onPrimaryContainer, backgroundColor: palette.primaryContainer }]}>{message}</Text> : null}

        {/* Option A(#296): 전체 여권/배지·보상 상자/도장판·방문 기록은 기본 접힘(Fold)으로 미뤄, 앨범이 첫 화면을 차지한다. */}
        <Fold title="메달·배지 더보기" summary={badges.book ? `배지 ${Math.min(9, badges.book.earnedTiers)}/9` : undefined}>
          <PassportHero
            book={badges.book}
            counts={summary}
            isShowcase={isShowcase}
            stackCounts={stackCounts}
            stackMain={fontScale >= 1.5}
            onOpenRewards={scrollToRewards}
          />
          <Section title="배지">
            {badges.book ? (
              <MedalShelf medals={badges.book.medals} stacked={stackTrio} onSelect={setDetailKind} />
            ) : badges.status === 'error' ? (
              <SectionRetry message="배지를 불러오지 못했어요. 도감의 다른 기록은 그대로예요." onRetry={() => void badges.retry()} busy={badges.retrying} />
            ) : (
              <MedalShelfSkeleton stacked={stackTrio} />
            )}
          </Section>
        </Fold>

        {badges.book ? (
          <Fold
            title="쿠폰·NFT 발행 현황"
            summary={`쿠폰 ${coupons.length}개`}
            expanded={rewardsFoldExpanded}
            onToggle={() => setRewardsFoldExpanded((value) => !value)}
            onLayout={setRewardsY}
          >
            <Section title="보상 상자" note="배지 3개마다 상자가 하나씩 열려요.">
              <RewardTrack
                book={badges.book}
                onOpen={openReward}
                onRevealed={onRevealed}
                onOpenFailed={onOpenFailed}
              />
              <Text style={styles.subsectionTitle}>내 쿠폰</Text>
              {coupons.length === 0 ? (
                <EmptyCopy text="상자를 열면 쿠폰이 여기에 모여요." />
              ) : (
                coupons.map((coupon) => <CouponTicket key={coupon.couponId} coupon={coupon} onUse={setUsingCoupon} />)
              )}
            </Section>
          </Fold>
        ) : null}

        <Fold title="도장판·방문 기록" summary={stampSlots.length > 0 ? `도장 ${stampSlots.filter((slot) => slot.visited).length}/${stampSlots.length}` : undefined}>
          {merchantsError ? (
            <Section title="도장판">
              <Pressable accessibilityRole="button" onPress={retryMerchants} style={styles.recoveryButton}>
                <Text style={[styles.recoveryButtonText, { color: palette.primary }]}>음식점 목록을 불러오지 못했습니다. 다시 시도</Text>
              </Pressable>
            </Section>
          ) : merchantsLoading ? (
            <Section title="도장판"><EmptyCopy text="공개 음식점을 불러오는 중입니다." /></Section>
          ) : stampSlots.length > 0 ? (
            <Section
              title="도장판"
              note={`도장 ${stampSlots.filter((slot) => slot.visited).length}/${stampSlots.length} · 보상 진행은 현재 캠페인의 인정된 방문만 셉니다.`}
            >
              <PassportStampPage apiUrl={apiUrl} stamps={stampSlots.map((slot, index) => toPassportStamp(slot, merchantGoals[index]!, artUrlByMerchant.get(slot.merchantId) ?? null))} />
            </Section>
          ) : (
            <Section title="도장판"><EmptyCopy text="현재 공개된 음식점이 없습니다." /></Section>
          )}

          <Section title="방문 기록" note="방문한 날짜(한국 기준)만 기록하고, 식사 시각은 남기지 않아요.">
            {collection.visits.length === 0 ? (
              <EmptyCopy text="아직 인증한 방문이 없습니다." />
            ) : (
              collection.visits.map((visit) => (
                <FloatingCard key={visit.visitEventId} style={styles.visitRow}>
                  <View style={styles.visitLeft}>
                    <Text selectable style={[styles.visitMerchant, { color: palette.label }]}>{visit.merchantName}</Text>
                    <Text style={[styles.itemMeta, { color: palette.secondaryLabel }]}>{visit.campaignTitle}</Text>
                  </View>
                  <View style={styles.visitRight}>
                    <Text style={[styles.visitDate, { color: palette.label }]}>{visit.businessDate}</Text>
                    <Text style={[styles.progressLabel, { color: palette.primary }]}>{visit.progressCounted ? '진행 반영' : '방문만 기록'}</Text>
                  </View>
                </FloatingCard>
              ))
            )}
          </Section>
        </Fold>

        <Link href="/recommendations" asChild>
          <Pressable accessibilityRole="button" style={StyleSheet.flatten([styles.primaryButton, { backgroundColor: palette.primary }])}>
            <Text style={[styles.primaryButtonText, { color: palette.onPrimary }]}>다음 음식점 추천 보기</Text>
          </Pressable>
        </Link>
      </SkyScrollView>

      <MedalDetail medal={detailMedal} variant={variant} onClose={() => setDetailKind(undefined)} />
      {collectibleDetail?.client === api ? <CollectibleDetail key={collectibleDetail.entitlementId} entitlementId={collectibleDetail.entitlementId}
        merchantName={collectibleDetail.merchantName} intro={collectibleDetail.intro === true} load={loadCollectible} onClose={() => setCollectibleDetail(undefined)} onUnavailable={() => void refresh()} /> : null}
      {revealEntitlement ? (
        <CollectibleReveal
          key={revealEntitlement.entitlementIds.join(',')}
          entitlementIds={revealEntitlement.entitlementIds}
          merchantName={revealEntitlement.merchantName}
          load={loadCollectible}
          collectibles={collection?.collectibles ?? []}
          series={storeSeries}
          onSkip={() => setRevealEntitlement(undefined)}
          onOpenDetail={(entitlementId) => {
            // 실제로 불러오는 데 성공한 첫 카드(봉투 쪽이 넘겨준 id)이므로 상세에서 획득 때 한 번 재생하는 동작부터 보여 준다.
            // 배치의 원래 첫 id(entitlementIds[0])를 그대로 쓰면, 그게 로드에 실패해 카드로 보이지도 않은 경우 엉뚱한 걸 연다.
            setCollectibleDetail({ entitlementId, merchantName: revealEntitlement.merchantName, client: api, intro: true });
            setRevealEntitlement(undefined);
          }}
        />
      ) : null}
      {shareHost}
      <MascotReactionToast event={reactionEvent} onClose={handleDismissReaction} />
      <RewardReveal
        result={revealed}
        onClose={() => setRevealed(undefined)}
        onUse={(coupon) => {
          setRevealed(undefined);
          setUsingCoupon(coupon);
        }}
      />
      <CouponUseSheet
        coupon={usingCoupon}
        variant={variant}
        createIdentity={createIdentity}
        revokeIdentity={revokeIdentity}
        loadBadgeBook={loadBadgeBook}
        onBadgeBook={replaceBadgeBook}
        onClose={() => setUsingCoupon(undefined)}
      />
    </SkyBackdrop>
  );
}

function Section({ title, note, children }: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  const styles = useCollectionStyles();
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
      {note ? <Text style={styles.sectionNote}>{note}</Text> : null}
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function EmptyCopy({ text }: { text: string }) {
  const styles = useCollectionStyles();
  return <Text style={styles.emptyCopy}>{text}</Text>;
}

/** Compact header strip (Option A, #296): "골목 탐험가 · 배지 4/9", replacing the full PassportHero at the top of the screen. */
function CompactPassportStrip({ book }: { book: { earnedTiers: number } }) {
  const styles = useCollectionStyles();
  const earned = Math.min(9, book.earnedTiers);
  return (
    <View style={styles.passportStrip}>
      <Text style={styles.passportStripText}>{explorerRank(book.earnedTiers).title} · 배지 {earned}/9</Text>
    </View>
  );
}

function mintErrorMessage(error: unknown): string {
  if (error instanceof CommerceApiError) {
    return mintRefusalText(error.code);
  }
  return 'NFT 접수 중 네트워크 오류가 발생했습니다. 보상권은 유지됩니다.';
}
