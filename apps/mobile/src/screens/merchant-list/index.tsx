import { Link, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
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
import { createBadgeApiClient } from '@/gamification/badge-api';
import { useBadgeBook } from '@/gamification/use-badge-book';
import type { PublicMerchant } from '@/merchant/merchant-api';
import { filterMerchants, type MerchantAvailabilityFilter } from '@/merchant/filter-merchants';
import { useMerchantCatalog } from '@/merchant/use-merchant-catalog';
import { TabGlyph } from '@/navigation/tab-glyph';
import { useTabBarClearance } from '@/navigation/use-tab-bar-clearance';
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
  const [query, setQuery] = useState('');
  const [availability, setAvailability] = useState<MerchantAvailabilityFilter>('all');
  const visibleMerchants = useMemo(
    () => filterMerchants(merchants, query, availability),
    [merchants, query, availability],
  );
  const filtering = query.trim().length > 0 || availability !== 'all';
  const openMerchant = (merchantId: string) => router.push({ pathname: '/merchants/[merchantId]', params: { merchantId } });

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
            onRefresh={refresh}
            tintColor={palette.primary}
            colors={[palette.primary]}
            progressBackgroundColor={world.card}
            progressViewOffset={insets.top}
          />
        }
        ListHeaderComponent={
          <>
            <AppHeader title="어디로 탐험할까요?" subtitle="안 가본 가게에 도장을 찍어요">
              <View style={styles.heroRow}>
                <View style={styles.heroCopy}>
                  {auth.credential && auth.accountId ? (
                    <SignedInPassportChip apiUrl={apiUrl} credential={auth.credential} onSessionInvalid={auth.invalidateSession} />
                  ) : (
                    <PassportChip copy="로그인하면 여권이 열려요" />
                  )}
                </View>
                {/* Decorative: it still wiggles for a tap, but adds no stop for screen readers. */}
                <Mascot interactive pose={refreshing ? 'search' : 'explore-map'} size={heroMascotSize(fontScale, 120)} />
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
                  <View style={styles.filters} accessibilityRole="radiogroup" accessibilityLabel="참여 상태 필터">
                    {([
                      ['all', '전체'],
                      ['open', '참여 가능'],
                    ] as const).map(([value, label]) => (
                      <Pressable
                        key={value}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: availability === value }}
                        onPress={() => setAvailability(value)}
                        style={({ pressed }) => [
                          styles.filterChip,
                          availability === value
                            ? [styles.filterChipOn, pressed ? styles.filterChipOnPressed : null]
                            : [styles.filterChipIdle, pressed ? styles.filterChipIdlePressed : null],
                        ]}
                      >
                        <Text style={[styles.filterText, availability === value ? styles.filterTextOn : styles.filterTextIdle]}>{label}</Text>
                      </Pressable>
                    ))}
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
                body="다른 이름이나 주소로 찾거나, 참여 상태 필터를 바꿔 보세요."
                action={{ label: '검색 초기화', onPress: () => { setQuery(''); setAvailability('all'); } }}
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
                <MerchantCard merchant={item} onOpen={openMerchant} />
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

/** Reads the badge book only when signed in (the hook needs a credential); until it loads or if it fails the plain copy shows. */
function SignedInPassportChip({ apiUrl, credential, onSessionInvalid }: {
  apiUrl: string;
  credential: AccountCredential;
  onSessionInvalid: () => Promise<void>;
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
  return <PassportChip copy="내 탐험 여권 보기" data={passportChipData(book)} />;
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

function MerchantCard({ merchant, onOpen }: { merchant: PublicMerchant; onOpen: (merchantId: string) => void }) {
  const styles = useMerchantListStyles();
  const palette = colorsForScheme(useColorScheme());
  const full = merchant.campaign.enrollmentStatus === 'FULL';
  const status = merchant.campaign.enrollmentStatus === 'OPEN' ? '참여 가능' : '정원 마감';
  return (
    <FloatingCard
      onPress={() => onOpen(merchant.id)}
      accessibilityLabel={merchantCardLabel(merchant)}
      accessibilityHint={merchantCardHint()}
      style={styles.card}
    >
      <MerchantCrest merchant={merchant} />
      <View style={styles.cardBody}>
        <View style={styles.cardTopline}>
          <View style={[styles.statusBadge, full ? { backgroundColor: palette.errorContainer } : null]}>
            <Text style={[styles.statusBadgeText, full ? { color: palette.onErrorContainer } : null]}>{status}</Text>
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
          <Text selectable numberOfLines={1} style={styles.cardAddress}>{merchant.roadAddress}</Text>
          <Text style={styles.cardArrow}>→</Text>
        </View>
        <Text style={styles.campaignName}>{merchant.campaign.title}</Text>
      </View>
    </FloatingCard>
  );
}
