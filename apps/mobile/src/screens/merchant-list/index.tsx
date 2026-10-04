import { Link, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
  useWindowDimensions,
  type ImageSourcePropType,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuthSession } from '@/auth/auth-provider';
import type { BadgeApiClient, BadgeBook, OpenedReward } from '@/gamification/badge-api';
import { shouldRefreshBadgesQuietly } from '@/gamification/badge-refresh';
import { couponExpiryNotice } from '@/gamification/coupon-expiry';
import { HomeRewardCard } from '@/gamification/home-reward-card';
import { RewardReveal } from '@/gamification/reward-reveal';
import { applyMerchantFilters, hasActiveFilters, type ProgressFilter } from '@/merchant/apply-merchant-filters';
import type { PublicMerchant } from '@/merchant/merchant-api';
import type { MerchantCategory } from '@/merchant/merchant-categories';
import { visitorTagLabels } from '@/merchant/visitor-feedback-codes';
import { useMerchantCatalog } from '@/merchant/use-merchant-catalog';
import { TabGlyph } from '@/navigation/tab-glyph';
import { useTabBarClearance } from '@/navigation/use-tab-bar-clearance';
import { createRecommendationApiClient, type Recommendation } from '@/recommendation/recommendation-api';
import { useShopAvatarArt } from '@/shop/use-shop-avatar-art';
import { medalColorsForScheme, tierColors } from '@/theme/medal-colors';
import { colorsForScheme } from '@/theme/palette';
import { worldForScheme } from '@/theme/world';
import { AppHeader } from '@/ui/app-header';
import { FloatingCard } from '@/ui/floating-card';
import { heroMascotSize, isLargeText } from '@/ui/large-text';
import { Mascot } from '@/ui/mascot';
import { Companion } from '@/ui/companion';
import { ExperienceEntry } from '@/ui/experience-entry';
import { HomeExploration } from '@/ui/home-exploration';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { Stagger } from '@/ui/stagger';
import { StateScene } from '@/ui/state-scene';
import { StatusBarScrim, useStatusBarScrim } from '@/ui/status-bar-scrim';

import { DiscoveryChips } from './discovery-chips';
import {
  buildFilterContext,
  categoryChipOptions,
  emptyFilterCopy,
  keepAvailableFilters,
  progressChipOptions,
  toggleProgress,
} from './discovery-filters';
import { MerchantCrest } from './merchant-crest';
import { merchantCardHint, merchantCardLabel } from './merchant-card-label';
import { passportChipData, type PassportChipData } from './passport-chip';
import { homeNextGoalTitle } from './next-goal-card';
import { makeMerchantListStyles } from './styles';
import { useDiscoveryProgress } from './use-discovery-progress';
import { useMerchantListStyles } from './use-merchant-list-styles';

type Props = {
  apiUrl: string;
};

export function MerchantListScreen({ apiUrl }: Props) {
  const scheme = useColorScheme();
  const palette = colorsForScheme(scheme);
  const world = worldForScheme(scheme);
  const styles = useMerchantListStyles();
  const router = useRouter();
  const auth = useAuthSession();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const clearance = useTabBarClearance();
  const scrim = useStatusBarScrim();
  const { merchants, loading, refreshing, error, retry, refresh } = useMerchantCatalog(apiUrl);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<MerchantCategory | null>(null);
  const [progress, setProgress] = useState<ProgressFilter | null>(null);
  const openMerchant = (merchantId: string) => router.push({ pathname: '/merchants/[merchantId]', params: { merchantId, from: 'list' } });
  // 목록과 공유 배지 책을 당겨 새로고침에서 함께 갱신한다.
  const [badgeRefreshToken, setBadgeRefreshToken] = useState(0);
  const refreshAll = useCallback(() => {
    void refresh();
    setBadgeRefreshToken((value) => value + 1);
  }, [refresh]);
  // design-298.md: 홈 헤더 아바타가 상점에서 고른 대표 캐릭터를 보여준다(없으면 AppHeader의 기본 마스코트). 탭 포커스가
  // 돌아올 때(useShopAvatarArt 내부)와 이 당겨서 새로고침에도 다시 읽는다(PR #312 리뷰 5번).
  const avatarArt = useShopAvatarArt(apiUrl, auth.credential, badgeRefreshToken);

  // Issue #331: 검색어·업종·진행 칩으로 거른다. 진행 칩은 로그인했고 데이터(/collection, /me/badges)를 불러왔을 때만 보인다.
  const signedIn = Boolean(auth.credential && auth.accountId);
  const discovery = useDiscoveryProgress({
    apiUrl, credential: auth.credential, onSessionInvalid: auth.invalidateSession, refreshToken: badgeRefreshToken,
  });
  const recommendationApi = useMemo(
    () => signedIn && auth.credential ? createRecommendationApiClient({ apiUrl, credential: auth.credential, onSessionInvalid: auth.invalidateSession }) : undefined,
    [apiUrl, signedIn, auth.credential, auth.invalidateSession],
  );
  const [nextGoal, setNextGoal] = useState<{ api: typeof recommendationApi; item: Recommendation | undefined }>();
  const [recommendationFailure, setRecommendationFailure] = useState<typeof recommendationApi>();
  const [recommendationRetry, setRecommendationRetry] = useState(0);
  const bestNextGoal = signedIn && nextGoal?.api === recommendationApi ? nextGoal?.item : undefined;
  const recommendationStale = Boolean(recommendationApi && recommendationFailure === recommendationApi);
  useFocusEffect(useCallback(() => {
    // 포커스 중 당겨 새로고침·재시도도 같은 조회를 다시 시작한다.
    void badgeRefreshToken;
    void recommendationRetry;
    if (!recommendationApi) return;
    const controller = new AbortController();
    void recommendationApi.listRecommendations(controller.signal)
      .then((items) => {
        if (!controller.signal.aborted) {
          setNextGoal({ api: recommendationApi, item: items[0] });
          setRecommendationFailure(undefined);
        }
      })
      .catch(() => {
        // 기존 추천은 남겨 두되 최신 안내가 아님을 알리고 다시 확인할 수 있게 한다.
        if (!controller.signal.aborted) setRecommendationFailure(recommendationApi);
      });
    return () => controller.abort();
  }, [recommendationApi, badgeRefreshToken, recommendationRetry]));
  const categoryOptions = useMemo(() => categoryChipOptions(merchants), [merchants]);
  const progressOptions = useMemo(
    () => progressChipOptions({ signedIn, collectionReady: discovery.collection !== undefined, badgesReady: discovery.book !== undefined }),
    [signedIn, discovery.collection, discovery.book],
  );
  // 칩이 사라진 선택(로그아웃, 목록에서 빠진 업종)은 전체로 되돌린다.
  const filters = useMemo(
    () => keepAvailableFilters({ query, category, progress }, { categories: categoryOptions, progressOptions }),
    [query, category, progress, categoryOptions, progressOptions],
  );
  // 되돌린 선택은 상태에서도 지운다(adjusting state while rendering): 안 그러면 칩이 다시 나타날 때 조용히 되살아난다.
  if (filters.category !== category) setCategory(filters.category);
  if (filters.progress !== progress) setProgress(filters.progress);
  const filterContext = useMemo(
    () => buildFilterContext({ merchants, collection: discovery.collection, book: discovery.book, now: new Date().toISOString() }),
    [merchants, discovery.collection, discovery.book],
  );
  const visibleMerchants = useMemo(() => applyMerchantFilters(merchants, filters, filterContext), [merchants, filters, filterContext]);
  const filtering = hasActiveFilters(filters);
  const emptyCopy = useMemo(() => emptyFilterCopy(filters), [filters]);
  const clearFilters = useCallback(() => {
    setQuery('');
    setCategory(null);
    setProgress(null);
  }, []);

  return (
    <SkyBackdrop>
      <FlatList
        data={visibleMerchants}
        keyExtractor={(merchant) => merchant.id}
        keyboardShouldPersistTaps="handled"
        onScroll={scrim.onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={[styles.content, { paddingBottom: clearance }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refreshAll}
            tintColor={palette.primary}
            colors={[palette.primary]}
            progressBackgroundColor={world.card}
            progressViewOffset={insets.top}
          />
        }
        ListHeaderComponent={
          <>
            <AppHeader
              title="어디로 탐험할까요?"
              subtitle="안 가본 가게에 도장을 찍어요"
              showFriendsEntry
              avatarArt={avatarArt}
            >
              <View style={styles.heroRow}>
                <View style={styles.heroCopy}>
                  <View style={styles.chipRow}>
                    {auth.credential && auth.accountId ? (
                      <PassportChip copy="내 탐험 여권 보기" data={passportChipData(discovery.book)} />
                    ) : (
                      <PassportChip copy="로그인하면 여권이 열려요" />
                    )}
                    <MapChip />
                  </View>
                </View>
                {/* Decorative: it still wiggles for a tap, but adds no stop for screen readers. */}
                {avatarArt ? <Companion art={avatarArt} interactive size={heroMascotSize(fontScale, 120)} />
                  : <Mascot interactive pose={refreshing ? 'search' : 'explore-map'} size={heroMascotSize(fontScale, 120)} />}
              </View>
            </AppHeader>
            {auth.credential && auth.accountId ? (
              <View style={styles.rewardCardWrap}>
                <SignedInRewardCard book={discovery.book} badgeApi={discovery.badgeApi} refreshQuietly={discovery.refreshQuietly} applyOpened={discovery.applyOpened} companionArt={avatarArt} key={auth.accountId} />
              </View>
            ) : null}
            <View style={styles.header}>
              {signedIn ? <ExperienceEntry /> : null}
              {auth.credential ? <HomeExploration apiUrl={apiUrl} credential={auth.credential}
                onSessionInvalid={auth.invalidateSession} merchants={merchants} collection={discovery.collection} /> : null}
              {bestNextGoal ? (
                <FloatingCard>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${homeNextGoalTitle(bestNextGoal)}, ${bestNextGoal.reasonText}`}
                    accessibilityHint="추천 가게 상세 보기"
                    onPress={() => router.push({ pathname: '/merchants/[merchantId]', params: { merchantId: bestNextGoal.merchantId, from: 'recommendation' } })}
                    style={styles.nextGoalCard}
                  >
                    <Text style={styles.nextGoalTitle}>{homeNextGoalTitle(bestNextGoal)}</Text>
                    <Text style={styles.nextGoalReason}>{bestNextGoal.reasonText}</Text>
                  </Pressable>
                </FloatingCard>
              ) : null}
              {recommendationStale ? (
                <Pressable accessibilityRole="button" accessibilityLabel="최신 추천 다시 확인"
                  onPress={() => setRecommendationRetry((value) => value + 1)} style={styles.recommendationRetry}>
                  <Text style={styles.nextGoalReason}>최신 추천을 확인하지 못했어요 · 다시 확인</Text>
                </Pressable>
              ) : null}
              {merchants.length > 0 ? (
                <View style={styles.discoveryTools}>
                  <View style={styles.searchField}>
                    <View accessibilityElementsHidden style={styles.searchGlyph}>
                      <TabGlyph name="explore" color={palette.primary} size={21} />
                    </View>
                    <TextInput
                      value={query}
                      onChangeText={setQuery}
                      accessibilityLabel="음식점 검색"
                      placeholder="이름·메뉴·주소로 찾기"
                      placeholderTextColor={world.cardMuted}
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="search"
                      style={styles.searchInput}
                    />
                    {query ? (
                      <Pressable accessibilityRole="button" accessibilityLabel="검색어 지우기" onPress={() => setQuery('')} style={styles.clearSearch}>
                        <Text style={styles.clearSearchText}>지우기</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  <DiscoveryChips
                    categories={categoryOptions}
                    category={filters.category}
                    onCategory={setCategory}
                    progressOptions={progressOptions}
                    progress={filters.progress}
                    onProgress={(next) => setProgress(toggleProgress(filters.progress, next))}
                  />
                </View>
              ) : null}
              <View style={styles.sectionHeading}>
                <View style={styles.sectionTitleRow}>
                  <Text accessibilityRole="header" style={styles.sectionEyebrow}>동네 음식점</Text>
                  <Text accessibilityLiveRegion="polite" style={styles.sectionCount}>
                    {filtering ? `${visibleMerchants.length} / ${merchants.length}곳` : `${merchants.length}곳`}
                  </Text>
                </View>
                {merchants.length > 0 ? (
                  <Link href="/recommendations" asChild>
                    <Pressable accessibilityRole="button" accessibilityLabel="다음 가게 추천 보기" style={styles.recommendationAction}>
                      <Text style={styles.recommendationActionText}>추천 보기 →</Text>
                    </Pressable>
                  </Link>
                ) : null}
              </View>
              {merchants.length > 0 ? (
                <View style={styles.notice}>
                  <Text selectable style={styles.noticeText}>
                    표시된 점포는 현재 개발·검증용 데이터일 수 있습니다. 실제 협약 점포 여부는 별도로
                    확인합니다.
                  </Text>
                </View>
              ) : null}
              {error && merchants.length > 0 ? (
                <Pressable accessibilityRole="button" onPress={retry} style={styles.inlineError}>
                  <Text style={styles.inlineErrorText}>{error} 눌러서 다시 시도</Text>
                </Pressable>
              ) : null}
            </View>
          </>
        }
        ListEmptyComponent={
          <View style={styles.itemWrap}>
            {loading ? (
              <StateScene kind="loading" title="동네 지도를 펼치는 중" body="공개 중인 캠페인을 확인하고 있습니다." />
            ) : error ? (
              <StateScene kind="error" title="지금은 목록을 가져오지 못했어요" body={error} action={{ label: '다시 불러오기', onPress: retry }} />
            ) : merchants.length > 0 ? (
              <StateScene
                kind="empty"
                title={emptyCopy.title}
                body={emptyCopy.body}
                action={{ label: emptyCopy.actionLabel, onPress: clearFilters }}
              />
            ) : (
              <FloatingCard>
                <CatalogEmptyState onRefresh={refresh} refreshing={refreshing} />
              </FloatingCard>
            )}
          </View>
        }
        renderItem={({ item, index }) => {
          // Stagger lets rows past the first screenful appear at once.
          return (
            <Stagger index={index}>
              <View style={styles.itemWrap}>
                <MerchantCard merchant={item} apiUrl={apiUrl} fontScale={fontScale} onOpen={openMerchant} />
              </View>
            </Stagger>
          );
        }}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
      <StatusBarScrim scrollY={scrim.scrollY} />
    </SkyBackdrop>
  );
}

/** The chip that opens the passport. `data` (from the badge book) swaps the plain copy for "배지 3/9" and a best-tier medal dot. */
function PassportChip({ copy, data }: { copy?: string; data?: PassportChipData }) {
  const scheme = useColorScheme();
  const styles = useMerchantListStyles();
  const dot = data && data.tier !== 0 ? tierColors(medalColorsForScheme(scheme), data.tier) : undefined;
  return (
    <Link href="/collection" asChild>
      <Pressable accessibilityRole="button" accessibilityLabel={data?.label} style={styles.passportChip}>
        {dot ? <View accessible={false} style={[styles.passportChipDot, { backgroundColor: dot.base, borderColor: dot.edge }]} /> : null}
        <Text style={styles.passportChipText}>{data ? data.text : copy}</Text>
      </Pressable>
    </Link>
  );
}

/** Opens the 지도 tab: the same shops as a picture map (Issue #228). */
function MapChip() {
  const palette = colorsForScheme(useColorScheme());
  const styles = useMerchantListStyles();
  return (
    <Link href="/map" asChild>
      <Pressable accessibilityRole="button" accessibilityLabel="지도로 보기, 동네 그림 지도 열기" style={styles.mapChip}>
        <TabGlyph name="map" color={palette.onPrimaryContainer} size={18} />
        <Text style={styles.mapChipText}>지도로 보기</Text>
      </Pressable>
    </Link>
  );
}

/** 배지 책은 진행 필터·여권 칩과 공유하고, 상자를 열면 같은 책에 즉시 반영한다. */
function SignedInRewardCard({ book, badgeApi, refreshQuietly, applyOpened, companionArt }: {
  book: BadgeBook | undefined;
  badgeApi: BadgeApiClient | undefined;
  refreshQuietly: () => Promise<void>;
  applyOpened: (result: OpenedReward) => void;
  companionArt?: ImageSourcePropType;
}) {
  const router = useRouter();
  const styles = useMerchantListStyles();
  const expiryNotice = couponExpiryNotice(book, new Date());
  const [revealed, setRevealed] = useState<OpenedReward>();
  // PR #301 리뷰: 보상이 거절됐는데(예: 마지막 쿠폰 소진) 책을 다시 읽지 않으면 그 상자가 계속 READY로 보여
  // homeFeaturedReward가 같은(이제 못 여는) 상자만 돌려주고 그 뒤 진짜 READY 상자를 가린다.
  const onOpenFailed = useCallback((code: string | undefined) => {
    if (shouldRefreshBadgesQuietly(code)) void refreshQuietly();
  }, [refreshQuietly]);
  const onRevealed = useCallback((result: OpenedReward) => { applyOpened(result); setRevealed(result); }, [applyOpened]);
  if (!book || !badgeApi) return null;
  return (
    <>
      {expiryNotice ? (
        <Pressable accessibilityRole="button" accessibilityLabel={expiryNotice}
          accessibilityHint="도감의 쿠폰과 보상을 확인해요." onPress={() => router.navigate({ pathname: '/collection', params: { focus: 'rewards' } })}
          style={styles.couponExpiryNotice}>
          <Text style={styles.couponExpiryNoticeText}>{expiryNotice}</Text>
        </Pressable>
      ) : null}
      <HomeRewardCard book={book} onOpen={badgeApi.openReward} onRevealed={onRevealed} onOpenFailed={onOpenFailed} />
      <RewardReveal
        result={revealed}
        companionArt={companionArt}
        onClose={() => setRevealed(undefined)}
        onUse={() => {
          setRevealed(undefined);
          router.navigate({ pathname: '/collection', params: { focus: 'rewards' } });
        }}
      />
    </>
  );
}

function CatalogEmptyState({ onRefresh, refreshing }: { onRefresh: () => void; refreshing: boolean }) {
  const styles = useMerchantListStyles();
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={styles.emptyEyebrow}>지금의 월계1동</Text>
      <StateScene
        framed={false}
        kind="empty"
        title="공개 중인 음식점이 아직 없어요."
        body="참여 캠페인이 열리면 실제 점포가 여기에 나타납니다. 지금은 서비스 이용 흐름을 먼저 살펴볼 수 있어요."
        action={{ label: refreshing ? '확인 중…' : '목록 다시 확인', onPress: onRefresh, disabled: refreshing }}
      />
      <View style={styles.journey}>
        <Text style={styles.journeyLabel}>이용 순서</Text>
        <Text style={styles.journeyText}>01 음식점 찾기  →  02 방문 인증  →  03 도감</Text>
      </View>
    </View>
  );
}

export function MerchantApiConfigurationRequired() {
  const scheme = useColorScheme();
  const palette = colorsForScheme(scheme);
  const styles = StyleSheet.create(makeMerchantListStyles(palette, worldForScheme(scheme), StyleSheet.hairlineWidth));
  return (
    <View style={styles.configurationContent}>
      <Text style={[styles.sectionEyebrow, { color: palette.label }]}>설정 필요</Text>
      <Text selectable style={[styles.title, { color: palette.label }]}>음식점 API 주소가{`\n`}아직 연결되지 않았습니다.</Text>
      <Text selectable style={[styles.intro, { color: palette.secondaryLabel }]}>
        EXPO_PUBLIC_API_URL을 설정하면 지갑 설정 없이도 음식점 탐색을 시작할 수 있습니다.
      </Text>
      <View style={[styles.configurationCard, { backgroundColor: palette.surface }]}>
        <Text selectable style={[styles.configurationCode, { color: palette.primary }]}>EXPO_PUBLIC_API_URL</Text>
        <Text style={[styles.configurationHelp, { color: palette.secondaryLabel }]}>실기기에서는 컴퓨터의 LAN 주소, 배포 환경에서는 HTTPS 주소를 사용합니다.</Text>
      </View>
    </View>
  );
}

function MerchantCard({ merchant, apiUrl, fontScale, onOpen }: { merchant: PublicMerchant; apiUrl: string; fontScale: number; onOpen: (merchantId: string) => void }) {
  const styles = useMerchantListStyles();
  // 방문한 사람은 누구나 적립한다(D-023). 참여 정원이 차도 "마감"으로 보이지 않는다.
  const status = '참여 가능';
  return (
    <FloatingCard
      onPress={() => onOpen(merchant.id)}
      accessibilityLabel={merchantCardLabel(merchant)}
      accessibilityHint={merchantCardHint()}
      style={styles.card}
    >
      <MerchantCrest merchant={merchant} apiUrl={apiUrl} />
      <View style={styles.cardBody}>
        <View style={styles.cardTopline}>
          <View style={styles.statusBadge}>
            <Text style={styles.statusBadgeText}>{status}</Text>
          </View>
          {merchant.demo ? (
            <View style={styles.demoBadge}>
              <Text style={styles.demoBadgeText}>DEMO</Text>
            </View>
          ) : null}
        </View>
        <Text selectable style={styles.cardTitle}>{merchant.name}</Text>
        <Text selectable numberOfLines={isLargeText(fontScale) ? 4 : 2} style={styles.cardStory}>{merchant.story}</Text>
        <View style={styles.cardMeta}>
          <Text selectable style={styles.cardAddress}>{merchant.roadAddress}</Text>
          <Text style={styles.cardArrow}>→</Text>
        </View>
        {merchant.visitorTags[0] ? (
          <Text style={styles.campaignName}>{visitorTagLabels[merchant.visitorTags[0].code]} · {merchant.visitorTags[0].count}명</Text>
        ) : null}
        <Text style={styles.campaignName}>{merchant.campaign.title}</Text>
      </View>
    </FloatingCard>
  );
}
