import * as Application from 'expo-application';
import { Link, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useColorScheme, useWindowDimensions, type ImageStyle, type StyleProp, type TextStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AccountCredential } from '@/auth/account-credential';
import {
  initialPollingState,
  nextPollingState,
  resolveCollectionLoad,
  type PollingState,
} from '@/commerce/collection-recovery';
import { CommerceApiError, createCommerceApiClient, type CollectionSnapshot } from '@/commerce/commerce-api';
import { createBadgeApiClient, type Coupon, type MedalKind, type OpenedReward, type RewardMilestone } from '@/gamification/badge-api';
import { couponsOf, shouldStackTrio, type ShareVariant } from '@/gamification/badge-rules';
import { CouponTicket } from '@/gamification/coupon-ticket';
import { CouponUseSheet } from '@/gamification/coupon-use-sheet';
import { MedalDetail } from '@/gamification/medal-detail';
import { MedalShelf, MedalShelfSkeleton, SectionRetry } from '@/gamification/medal-shelf';
import { PassportHero } from '@/gamification/passport-hero';
import { RewardReveal } from '@/gamification/reward-reveal';
import { RewardTrack } from '@/gamification/reward-track';
import { useBadgeBook } from '@/gamification/use-badge-book';
import { collectibleArtNote } from '@/merchant-art/art-source';
import { useArtFallback } from '@/merchant-art/use-art-fallback';
import { useMerchantCatalog } from '@/merchant/use-merchant-catalog';
import { useTabBarClearance } from '@/navigation/use-tab-bar-clearance';
import { colorsForScheme } from '@/theme/palette';
import { uiMetrics } from '@/theme/ui-metrics';
import { worldForScheme } from '@/theme/world';
import { AppHeader } from '@/ui/app-header';
import { FloatingCard } from '@/ui/floating-card';
import { PassportStampPage } from '@/ui/passport-stamp-page';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';
import { StateScene } from '@/ui/state-scene';
import { WalletApiClient, type ActiveWalletBindingResponse } from '@/wallet/wallet-api';

import { collectionCounts, shouldStackCounts } from './collection-counts';
import { CollectibleDetail } from './collectible-detail';
import { buildMerchantGoals, buildStampSlots, toPassportStamp } from './collection-stamps';
import { merchantArt, type MerchantArt } from './merchant-art';
import { collectibleArtSize } from './showcase-collectible-art';
import { makeCollectionStyles } from './styles';

// One StyleSheet per colour scheme instead of one per render of every card.
const styleCache = new Map<'light' | 'dark', ReturnType<typeof createCollectionStyles>>();
function createCollectionStyles(scheme: 'light' | 'dark') {
  return StyleSheet.create(makeCollectionStyles(colorsForScheme(scheme), worldForScheme(scheme), StyleSheet.hairlineWidth));
}
function useCollectionStyles() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  let styles = styleCache.get(scheme);
  if (!styles) {
    styles = createCollectionStyles(scheme);
    styleCache.set(scheme, styles);
  }
  return styles;
}

const quietBadgeRefreshCodes = new Set(['REWARD_LOCKED', 'REWARD_OFFER_UNAVAILABLE', 'REWARD_CAPACITY_EXHAUSTED', 'INVALID_RESPONSE']);

export function CollectionScreen({
  apiUrl,
  credential,
  onSessionInvalid,
}: {
  apiUrl: string;
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
  const { focus, entitlement } = useLocalSearchParams<{ focus?: string; entitlement?: string }>();
  const scrollView = useRef<ScrollView>(null);
  const [rewardsY, setRewardsY] = useState<number>();
  const [headerHeight, setHeaderHeight] = useState(0);
  const [detailKind, setDetailKind] = useState<MedalKind>();
  const [revealed, setRevealed] = useState<OpenedReward>();
  const [usingCoupon, setUsingCoupon] = useState<Coupon>();
  const [collectibleDetail, setCollectibleDetail] = useState<{ entitlementId: string; merchantName: string; client: typeof api }>();
  const [polling, setPolling] = useState<PollingState>();
  const [binding, setBinding] = useState<ActiveWalletBindingResponse['binding']>();
  const [bindingError, setBindingError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyEntitlementId, setBusyEntitlementId] = useState<string>();
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [pollingRetrying, setPollingRetrying] = useState(false);
  const collection = polling?.snapshot;
  const loadCollectible = useCallback((entitlementId: string) => api.getCollectible(entitlementId), [api]);

  useFocusEffect(useCallback(() => () => setCollectibleDetail(undefined), [setCollectibleDetail]));

  // Acquisition links open only an entitlement in the authenticated collection.
  // A legacy reward without artwork still remains successfully collected.
  useEffect(() => {
    if (focus !== 'collectible' || !collection) return;
    const timer = setTimeout(() => {
      const item = collection.collectibles.find((value) => value.entitlementId === entitlement);
      if (item?.artwork) setCollectibleDetail({ entitlementId: item.entitlementId, merchantName: item.merchantName, client: api });
      else setMessage('보상은 도감에 보관됐어요. 다시 볼 수 있는 가게 수집품은 아직 없어요.');
      router.setParams({ focus: undefined, entitlement: undefined });
    }, 0);
    return () => clearTimeout(timer);
  }, [focus, entitlement, collection, router, api]);
  const { merchants: publicMerchants, loading: merchantsLoading, error: merchantsError, retry: retryMerchants, refresh: refreshMerchants } = useMerchantCatalog(apiUrl);
  const stampSlots = useMemo(
    () => buildStampSlots(publicMerchants, collection?.visits ?? []),
    [publicMerchants, collection],
  );
  const artUrlByMerchant = useMemo(() => new Map(publicMerchants.map((merchant) => [merchant.id, merchant.artUrl])), [publicMerchants]);
  const merchantGoals = buildMerchantGoals(publicMerchants, collection?.visits ?? [], collection?.collectibles ?? [], new Date().toISOString());
  const artSize = collectibleArtSize(width, uiMetrics.pageInset, styles.collectibleCard.padding);
  const detailMedal = badges.book?.medals.find((medal) => medal.kind === detailKind);
  const coupons = couponsOf(badges.book);

  useEffect(() => {
    let active = true;
    void Promise.allSettled([api.getCollection(), walletApi.getActiveBinding()])
      .then(([collectionResult, bindingResult]) => {
        if (!active) return;
        const resolved = resolveCollectionLoad(collectionResult, bindingResult);
        if (!resolved.ok) {
          setError('도감을 불러오지 못했습니다. API 연결을 확인해 주세요.');
          return;
        }
        setPolling(initialPollingState(resolved.collection));
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
  }, [api, walletApi]);

  useEffect(() => {
    if (polling?.mode !== 'polling') return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await api.getCollection();
        if (active) {
          setPolling((current) => current
            ? nextPollingState(current, { type: 'success', snapshot: next })
            : initialPollingState(next));
        }
      } catch {
        if (active) {
          setPolling((current) => current
            ? nextPollingState(current, { type: 'failure' })
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
  }, [api, polling?.mode]);

  // The tab stays mounted; coming back after a visit claim quietly picks up new stamps and badges.
  const focusCount = useRef(0);
  const { refreshQuietly: refreshBadgesQuietly } = badges;

  // "도감에서 상자 열기" arrives with ?focus=rewards; scroll once the reward section is laid out.
  useEffect(() => {
    if (focus !== 'rewards' || rewardsY === undefined) return;
    // Clear the param inside the frame: clearing it first re-runs this effect and cancels the scroll.
    const frame = requestAnimationFrame(() => {
      // The section's y is measured inside the content below the header, so the header's height is added.
      scrollView.current?.scrollTo({ y: Math.max(0, headerHeight + rewardsY - 12), animated: true });
      router.setParams({ focus: undefined });
    });
    return () => cancelAnimationFrame(frame);
  }, [focus, headerHeight, rewardsY, router]);

  useFocusEffect(useCallback(() => {
    focusCount.current += 1;
    if (focusCount.current === 1) return;
    void refreshBadgesQuietly();
    void Promise.allSettled([api.getCollection(), walletApi.getActiveBinding()]).then(([collectionResult, bindingResult]) => {
      const resolved = resolveCollectionLoad(collectionResult, bindingResult);
      if (!resolved.ok) return;
      setPolling((current) => current
        ? nextPollingState(current, { type: 'success', snapshot: resolved.collection })
        : initialPollingState(resolved.collection));
      setBinding(resolved.binding);
      if (!resolved.bindingError) setBindingError(undefined);
    });
  }, [api, walletApi, refreshBadgesQuietly]));

  async function refresh() {
    setRefreshing(true);
    setError(undefined);
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
        setPolling((current) => current
          ? nextPollingState(current, { type: 'success', snapshot: resolved.collection })
          : initialPollingState(resolved.collection));
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
    try {
      const next = await api.getCollection();
      setPolling((current) => current
        ? nextPollingState(current, { type: 'success', snapshot: next })
        : initialPollingState(next));
    } catch {
      setError('NFT 등록 작업 결과를 다시 확인하지 못했습니다. 접수는 취소되지 않았습니다.');
    } finally {
      setPollingRetrying(false);
    }
  }

  function confirmMint(item: CollectionSnapshot['collectibles'][number]) {
    if (!binding) return;
    Alert.alert(
      '양도 제한 NFT 접수',
      `받을 주소\n${binding.address}\n\n체인 ${chainLabel(binding.chainId)}\n일반 전송이 제한되며 서비스가 발행 비용을 부담합니다. 공개 장부에는 주소와 NFT 식별 정보가 남습니다.`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '주소 확인 후 접수',
          onPress: () => void submitMint(item.entitlementId),
        },
      ],
    );
  }

  async function submitMint(entitlementId: string) {
    if (!binding || busyEntitlementId) return;
    setBusyEntitlementId(entitlementId);
    setError(undefined);
    setMessage(undefined);
    const idempotencyKey =
      `mint-${binding.bindingId}-${binding.bindingVersion}-${entitlementId}`;
    try {
      const result = await api.requestMint({
        entitlementId,
        walletBindingId: binding.bindingId,
        bindingVersion: binding.bindingVersion,
        consentVersion: 'nft-mint-v1',
        idempotencyKey,
      });
      setMessage(
        result.replayed
          ? '이미 접수한 NFT 작업을 다시 불러왔습니다.'
          : 'NFT 발행을 접수했습니다. 아직 블록체인 등록 완료가 아닙니다.',
      );
      setPolling(initialPollingState(await api.getCollection()));
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
    if (code && quietBadgeRefreshCodes.has(code)) void refreshBadgesQuietly();
  }, [refreshBadgesQuietly]);
  const loadBadgeBook = useCallback(() => badgeApi.getBadgeBook(), [badgeApi]);
  const createIdentity = useCallback(() => api.createCustomerIdentity(), [api]);
  const revokeIdentity = useCallback((token: string) => api.revokeCustomerIdentity(token), [api]);

  // The header (sky art included) is the first thing inside the scroll content, so it scrolls away with the page.
  const header = <AppHeader title="도감" subtitle="가본 가게마다 도장이 찍혀요" />;
  const sky = (body: ReactNode) => (
    <SkyBackdrop>
      <SkyScrollView
        header={header}
        onHeaderLayout={setHeaderHeight}
        contentContainerStyle={[styles.content, { paddingBottom: clearance }]}
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
        <PassportHero
          book={badges.book}
          counts={summary}
          isShowcase={isShowcase}
          stackCounts={stackCounts}
          stackMain={fontScale >= 1.5}
          onOpenRewards={() => scrollView.current?.scrollTo({ y: Math.max(0, headerHeight + (rewardsY ?? 0) - 12), animated: true })}
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

        {badges.book ? (
          <Section title="보상 상자" note="배지 3개마다 상자가 하나씩 열려요." onLayout={setRewardsY}>
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
        ) : null}

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

        <Section title="앱에서 받은 수집품" note="보상권을 받으면 앱 도감에 먼저 기록됩니다.">
          {collection.collectibles.length === 0 ? (
            <EmptyCopy text="아직 받은 수집품이 없습니다. 첫 방문을 인증해 보세요." />
          ) : (
            collection.collectibles.map((item) => {
              const art = merchantArt({ id: item.merchantId, artUrl: artUrlByMerchant.get(item.merchantId) }, apiUrl);
              return (
                <FloatingCard key={item.entitlementId} style={styles.collectibleCard}>
                {item.artwork ? (
                  <>
                    <Pressable accessibilityRole="button" accessibilityLabel={`${item.artwork.name}, ${item.artwork.gradeName}, 수집품 상세 보기`}
                      onPress={() => setCollectibleDetail({ entitlementId: item.entitlementId, merchantName: item.merchantName, client: api })}>
                      <Image source={{ uri: item.artwork.thumbnailDataUrl }} accessible={false} resizeMode="contain" style={[styles.collectibleArt, { width: artSize, height: artSize }]} />
                    </Pressable>
                    <Text style={[styles.collectibleArtNote, { color: palette.secondaryLabel }]}>{item.artwork.gradeName} · {item.artwork.theme.name}</Text>
                    <Pressable accessibilityRole="button" onPress={() => setCollectibleDetail({ entitlementId: item.entitlementId, merchantName: item.merchantName, client: api })}
                      style={[styles.walletButton, { borderColor: palette.primary }]}>
                      <Text style={[styles.walletButtonText, { color: palette.primary }]}>가게 수집품 다시 보기</Text>
                    </Pressable>
                  </>
                ) : art ? (
                  <CollectibleArt art={art} size={artSize} imageStyle={styles.collectibleArt} noteStyle={[styles.collectibleArtNote, { color: palette.secondaryLabel }]} />
                ) : null}
                <View style={styles.collectibleTopline}>
                  <Text style={[styles.goalBadge, { color: palette.primary }]}>{item.targetVisitCount}회</Text>
                  <Text style={[styles.appStatus, { color: palette.onSuccessContainer }]}>APP · 수집 완료</Text>
                </View>
                <Text selectable style={[styles.itemTitle, { color: palette.label }]}>{item.artwork?.name ?? item.displayName}</Text>
                <Text style={[styles.itemMeta, { color: palette.secondaryLabel }]}>{item.merchantName} · {item.campaignTitle}</Text>
                <View style={[styles.nftRow, { borderTopColor: palette.separator }]}>
                  <Text style={[styles.nftLabel, { color: palette.secondaryLabel }]}>실제 NFT</Text>
                  <Text style={[styles.nftValue, { color: palette.label }]}>{nftLabel(item.nftStatus)}</Text>
                </View>
                {item.recipient ? (
                  <Text selectable style={[styles.recipient, { color: palette.secondaryLabel }]}>수령인 {shortAddress(item.recipient)}</Text>
                ) : null}
                {item.nft ? (
                  <Text selectable style={[styles.nftIdentity, { color: palette.primary }]}>
                    {chainLabel(item.nft.chainId)} · {shortAddress(item.nft.contractAddress)} · #{item.nft.tokenId}
                  </Text>
                ) : null}
                {item.nftStatus === 'NOT_REQUESTED' ? (
                  binding ? (
                    <Pressable
                      accessibilityRole="button"
                      disabled={busyEntitlementId === item.entitlementId}
                      onPress={() => confirmMint(item)}
                      style={[styles.mintButton, { backgroundColor: palette.primary }, busyEntitlementId === item.entitlementId && styles.disabled]}
                    >
                      <Text style={[styles.mintButtonText, { color: palette.onPrimary }]}>
                        {busyEntitlementId === item.entitlementId ? '접수 중…' : '양도 제한 NFT 받기'}
                      </Text>
                    </Pressable>
                  ) : (
                    <Link href="/wallet" asChild>
                      <Pressable accessibilityRole="button" style={StyleSheet.flatten([styles.walletButton, { borderColor: palette.primary }])}>
                        <Text style={[styles.walletButtonText, { color: palette.primary }]}>외부 지갑 주소 확인</Text>
                      </Pressable>
                    </Link>
                  )
                ) : null}
                </FloatingCard>
              );
            })
          )}
        </Section>

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

        <Link href="/recommendations" asChild>
          <Pressable accessibilityRole="button" style={StyleSheet.flatten([styles.primaryButton, { backgroundColor: palette.primary }])}>
            <Text style={[styles.primaryButtonText, { color: palette.onPrimary }]}>다음 음식점 추천 보기</Text>
          </Pressable>
        </Link>
      </SkyScrollView>

      <MedalDetail medal={detailMedal} variant={variant} onClose={() => setDetailKind(undefined)} />
      {collectibleDetail?.client === api ? <CollectibleDetail key={collectibleDetail.entitlementId} entitlementId={collectibleDetail.entitlementId}
        merchantName={collectibleDetail.merchantName} load={loadCollectible} onClose={() => setCollectibleDetail(undefined)} /> : null}
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

function Section({ title, note, children, onLayout }: {
  title: string;
  note?: string;
  children: React.ReactNode;
  /** Reports the section's y inside the scroll content (for scroll-to). */
  onLayout?: (y: number) => void;
}) {
  const styles = useCollectionStyles();
  return (
    <View style={styles.section} onLayout={onLayout ? (event) => onLayout(event.nativeEvent.layout.y) : undefined}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
      {note ? <Text style={styles.sectionNote}>{note}</Text> : null}
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

/**
 * The picture on a collectible card. The owner's AI picture says only that (it is not an NFT and does not claim to be one); the
 * bundled showcase picture keeps its "not proof of a real NFT" note. A picture that fails to load (a stale catalog pointing at
 * art that was reset) leaves the card without one.
 */
function CollectibleArt({ art, size, imageStyle, noteStyle }: {
  art: MerchantArt; size: number; imageStyle: StyleProp<ImageStyle>; noteStyle: StyleProp<TextStyle>;
}) {
  const { source, onError } = useArtFallback(art.source);
  if (!source) return null;
  return (
    <>
      <Image source={source} onError={onError} accessible={false} style={[imageStyle, { width: size, height: size }]} />
      <Text style={noteStyle}>{collectibleArtNote(art.fromServer)}</Text>
    </>
  );
}

function EmptyCopy({ text }: { text: string }) {
  const styles = useCollectionStyles();
  return <Text style={styles.emptyCopy}>{text}</Text>;
}

function nftLabel(status: CollectionSnapshot['collectibles'][number]['nftStatus']): string {
  if (status === 'QUEUED') return 'NFT 접수';
  if (status === 'CONFIRMING') return '블록체인 확인 중';
  if (status === 'FINALIZED') return '등록 완료';
  if (status === 'REVIEW_REQUIRED') return '확인 필요';
  return '발행하지 않음';
}

function mintErrorMessage(error: unknown): string {
  if (error instanceof CommerceApiError) {
    const messages: Record<string, string> = {
      WALLET_BINDING_CHANGED: '지갑 주소 확인 버전이 바뀌었습니다. 지갑 화면에서 다시 확인해 주세요.',
      WALLET_BINDING_NOT_FOUND: '확인된 외부 지갑 주소가 없습니다.',
      ENTITLEMENT_EXPIRED: 'NFT 신청 기간이 만료됐습니다.',
      MINT_PENDING: '이미 처리 중인 NFT 작업이 있습니다.',
      CAPACITY_UNAVAILABLE: '약속된 발행 수량을 확인할 수 없어 접수를 중지했습니다.',
      CONSENT_REQUIRED: '최신 공개·양도 제한 안내 동의가 필요합니다.',
    };
    return messages[error.code] ?? `NFT 접수 실패: ${error.code}`;
  }
  return 'NFT 접수 중 네트워크 오류가 발생했습니다. 보상권은 유지됩니다.';
}

function shortAddress(value: string): string {
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function chainLabel(chainId: number): string {
  if (chainId === 84532) return 'Base Sepolia';
  if (chainId === 8453) return 'Base';
  if (chainId === 31337) return 'Local Anvil';
  return `Chain ${chainId}`;
}
