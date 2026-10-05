import { Link, useRouter } from 'expo-router';
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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuthSession } from '@/auth/auth-provider';
import { applyMerchantFilters, hasActiveFilters, type ProgressFilter } from '@/merchant/apply-merchant-filters';
import type { PublicMerchant } from '@/merchant/merchant-api';
import type { MerchantCategory } from '@/merchant/merchant-categories';
import { visitorTagLabels } from '@/merchant/visitor-feedback-codes';
import { useMerchantCatalog } from '@/merchant/use-merchant-catalog';
import { TabGlyph } from '@/navigation/tab-glyph';
import { useTabBarClearance } from '@/navigation/use-tab-bar-clearance';
import { colorsForScheme } from '@/theme/palette';
import { worldForScheme } from '@/theme/world';
import { AppHeader } from '@/ui/app-header';
import { FloatingCard } from '@/ui/floating-card';
import { isLargeText } from '@/ui/large-text';
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
  const clearance = useTabBarClearance();
  const scrim = useStatusBarScrim();
  const { fontScale } = useWindowDimensions();
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

  // Issue #331: 검색어·업종·진행 칩으로 거른다. 진행 칩은 로그인했고 데이터(/collection, /me/badges)를 불러왔을 때만 보인다.
  const signedIn = Boolean(auth.credential && auth.accountId);
  const discovery = useDiscoveryProgress({
    apiUrl, credential: auth.credential, onSessionInvalid: auth.invalidateSession, refreshToken: badgeRefreshToken,
  });
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
              title="가게 검색"
              subtitle="이름·메뉴·주소로 찾고 지도로도 볼 수 있어요"
            >
              <View style={styles.chipRow}>
                <MapChip />
              </View>
            </AppHeader>
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
