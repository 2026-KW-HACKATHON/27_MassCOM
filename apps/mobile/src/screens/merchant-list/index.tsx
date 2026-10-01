import { Link, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AccountCredential } from '@/auth/account-credential';
import { useAuthSession } from '@/auth/auth-provider';
import { createBadgeApiClient, type OpenedReward } from '@/gamification/badge-api';
import { shouldRefreshBadgesQuietly } from '@/gamification/badge-refresh';
import { HomeRewardCard } from '@/gamification/home-reward-card';
import { RewardReveal } from '@/gamification/reward-reveal';
import { useBadgeBook } from '@/gamification/use-badge-book';
import type { PublicMerchant } from '@/merchant/merchant-api';
import { filterMerchants } from '@/merchant/filter-merchants';
import { useMerchantCatalog } from '@/merchant/use-merchant-catalog';
import { TabGlyph } from '@/navigation/tab-glyph';
import { useTabBarClearance } from '@/navigation/use-tab-bar-clearance';
import { useShopAvatarArt } from '@/shop/use-shop-avatar-art';
import { medalColorsForScheme, tierColors } from '@/theme/medal-colors';
import { colorsForScheme } from '@/theme/palette';
import { worldForScheme } from '@/theme/world';
import { AppHeader } from '@/ui/app-header';
import { FloatingCard } from '@/ui/floating-card';
import { heroMascotSize } from '@/ui/large-text';
import { Mascot } from '@/ui/mascot';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { Stagger } from '@/ui/stagger';
import { StateScene } from '@/ui/state-scene';
import { StatusBarScrim, useStatusBarScrim } from '@/ui/status-bar-scrim';

import { MerchantCrest } from './merchant-crest';
import { merchantCardHint, merchantCardLabel } from './merchant-card-label';
import { passportChipData, type PassportChipData } from './passport-chip';
import { makeMerchantListStyles } from './styles';
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
  // design-298.md: 홈 헤더 아바타가 상점에서 고른 대표 캐릭터를 보여준다(없으면 AppHeader의 기본 마스코트).
  const avatarArt = useShopAvatarArt(apiUrl, auth.credential);
  const [query, setQuery] = useState('');
  const visibleMerchants = useMemo(() => filterMerchants(merchants, query), [merchants, query]);
  const filtering = query.trim().length > 0;
  const openMerchant = (merchantId: string) => router.push({ pathname: '/merchants/[merchantId]', params: { merchantId } });
  // PR #301 리뷰: 홈 새로고침이 음식점 목록만 다시 받고 배지 책은 그대로였다(보상 상자가 거절된 뒤에도 묵은 상태로
  // 남는다). 당겨서 새로고침마다 올려, 여권 칩·보상 카드가 각자의 badge book도 같이 다시 읽게 한다.
  const [badgeRefreshToken, setBadgeRefreshToken] = useState(0);
  const refreshAll = useCallback(() => {
    void refresh();
    setBadgeRefreshToken((value) => value + 1);
  }, [refresh]);

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
                      <SignedInPassportChip apiUrl={apiUrl} credential={auth.credential} onSessionInvalid={auth.invalidateSession} refreshToken={badgeRefreshToken} />
                    ) : (
                      <PassportChip copy="로그인하면 여권이 열려요" />
                    )}
                    <MapChip />
                  </View>
                </View>
                {/* Decorative: it still wiggles for a tap, but adds no stop for screen readers. */}
                <Mascot interactive pose={refreshing ? 'search' : 'explore-map'} size={heroMascotSize(fontScale, 120)} />
              </View>
            </AppHeader>
            {auth.credential && auth.accountId ? (
              <View style={styles.rewardCardWrap}>
                <SignedInRewardCard apiUrl={apiUrl} credential={auth.credential} onSessionInvalid={auth.invalidateSession} refreshToken={badgeRefreshToken} />
              </View>
            ) : null}
            <View style={styles.header}>
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
                      placeholder="이름·주소·이야기로 찾기"
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
                title="검색 결과가 없어요"
                body="다른 이름이나 주소로 찾아보세요."
                action={{ label: '검색 초기화', onPress: () => setQuery('') }}
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
                <MerchantCard merchant={item} apiUrl={apiUrl} onOpen={openMerchant} />
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

/** Reads the badge book only when signed in (the hook needs a credential); until it loads or if it fails the plain copy shows. */
function SignedInPassportChip({ apiUrl, credential, onSessionInvalid, refreshToken }: {
  apiUrl: string;
  credential: AccountCredential;
  onSessionInvalid: () => Promise<void>;
  /** Bumped by the home screen's pull-to-refresh (#301 review): it used to reload only the store list. */
  refreshToken: number;
}) {
  const badgeApi = useMemo(
    () => createBadgeApiClient({ apiUrl, credential, onSessionInvalid }),
    [apiUrl, credential, onSessionInvalid],
  );
  const { book, refreshQuietly } = useBadgeBook(badgeApi);
  // The tab stays mounted, so coming back after a visit claim quietly picks up new badges.
  const firstFocus = useRef(true);
  useFocusEffect(useCallback(() => {
    if (firstFocus.current) { firstFocus.current = false; return; }
    void refreshQuietly();
  }, [refreshQuietly]));
  const firstRefreshToken = useRef(true);
  useEffect(() => {
    if (firstRefreshToken.current) { firstRefreshToken.current = false; return; }
    void refreshQuietly();
  }, [refreshToken, refreshQuietly]);
  return <PassportChip copy="내 탐험 여권 보기" data={passportChipData(book)} />;
}

/**
 * 탐색(홈)의 보상 상자 요약 카드(#296, Option A): 여권 칩과 같은 배지 책을 쓰지만 자기만의 조회를 한 번 더 한다.
 * ponytail: 칩과 카드가 각자 `/me/badges`를 읽는 건 중복이지만(둘 다 짧은 읽기 전용 호출), 서로 다른 화면 위치에 있어
 * 하나의 훅으로 묶으면 더 복잡해진다 — 홈 화면에서 칩과 카드를 늘 함께 바꿀 일이 생기면 그때 하나로 올린다.
 */
function SignedInRewardCard({ apiUrl, credential, onSessionInvalid, refreshToken }: {
  apiUrl: string;
  credential: AccountCredential;
  onSessionInvalid: () => Promise<void>;
  /** Bumped by the home screen's pull-to-refresh (#301 review): it used to reload only the store list. */
  refreshToken: number;
}) {
  const router = useRouter();
  const badgeApi = useMemo(
    () => createBadgeApiClient({ apiUrl, credential, onSessionInvalid }),
    [apiUrl, credential, onSessionInvalid],
  );
  const { book, applyOpened, refreshQuietly } = useBadgeBook(badgeApi);
  const [revealed, setRevealed] = useState<OpenedReward>();
  const firstFocus = useRef(true);
  useFocusEffect(useCallback(() => {
    if (firstFocus.current) { firstFocus.current = false; return; }
    void refreshQuietly();
  }, [refreshQuietly]));
  const firstRefreshToken = useRef(true);
  useEffect(() => {
    if (firstRefreshToken.current) { firstRefreshToken.current = false; return; }
    void refreshQuietly();
  }, [refreshToken, refreshQuietly]);
  // PR #301 리뷰: 보상이 거절됐는데(예: 마지막 쿠폰 소진) 책을 다시 읽지 않으면 그 상자가 계속 READY로 보여
  // homeFeaturedReward가 같은(이제 못 여는) 상자만 돌려주고 그 뒤 진짜 READY 상자를 가린다.
  const onOpenFailed = useCallback((code: string | undefined) => {
    if (shouldRefreshBadgesQuietly(code)) void refreshQuietly();
  }, [refreshQuietly]);
  const onRevealed = useCallback((result: OpenedReward) => { applyOpened(result); setRevealed(result); }, [applyOpened]);
  if (!book) return null;
  return (
    <>
      <HomeRewardCard book={book} onOpen={badgeApi.openReward} onRevealed={onRevealed} onOpenFailed={onOpenFailed} />
      <RewardReveal
        result={revealed}
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

function MerchantCard({ merchant, apiUrl, onOpen }: { merchant: PublicMerchant; apiUrl: string; onOpen: (merchantId: string) => void }) {
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
        <Text selectable numberOfLines={2} style={styles.cardStory}>{merchant.story}</Text>
        <View style={styles.cardMeta}>
          <Text selectable numberOfLines={2} style={styles.cardAddress}>{merchant.roadAddress}</Text>
          <Text style={styles.cardArrow}>→</Text>
        </View>
        <Text style={styles.campaignName}>{merchant.campaign.title}</Text>
      </View>
    </FloatingCard>
  );
}
