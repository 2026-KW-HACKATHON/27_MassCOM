import { Link } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { PublicMerchant } from '@/merchant/merchant-api';
import { filterMerchants, type MerchantAvailabilityFilter } from '@/merchant/filter-merchants';
import { useMerchantCatalog } from '@/merchant/use-merchant-catalog';
import { TabGlyph } from '@/navigation/tab-glyph';
import { colors } from '@/theme/colors';
import { colorsForScheme, type AppColors } from '@/theme/palette';
import { uiMetrics } from '@/theme/ui-metrics';

type Props = {
  apiUrl: string;
};

export function MerchantListScreen({ apiUrl }: Props) {
  const scheme = useColorScheme();
  const palette = colorsForScheme(scheme);
  const insets = useSafeAreaInsets();
  const { merchants, loading, refreshing, error, retry, refresh } = useMerchantCatalog(apiUrl);
  const [query, setQuery] = useState('');
  const [availability, setAvailability] = useState<MerchantAvailabilityFilter>('all');
  const visibleMerchants = useMemo(
    () => filterMerchants(merchants, query, availability),
    [merchants, query, availability],
  );
  const filtering = query.trim().length > 0 || availability !== 'all';

  return (
    <FlatList
      data={visibleMerchants}
      keyExtractor={(merchant) => merchant.id}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { paddingBottom: 48 + insets.bottom, backgroundColor: palette.background }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={palette.primary} />}
      ListHeaderComponent={
        <View style={styles.header}>
          <View style={[styles.routeMarker, { backgroundColor: palette.accentContainer }]}>
            <Text style={[styles.routeMarkerText, { color: palette.onAccentContainer }]}>
              월계1동 · 동네 한 바퀴
            </Text>
          </View>
          <Text selectable style={[styles.title, { color: palette.label }]}>월계에서 만나는{`\n`}오늘의 한 끼.</Text>
          <Text selectable style={[styles.intro, { color: palette.secondaryLabel }]}>
            공개된 음식점을 찾고, 방문을 도감에 모아보세요.
          </Text>
          {merchants.length > 0 ? (
            <View style={styles.discoveryTools}>
              <View style={[styles.searchField, { backgroundColor: palette.surface, borderColor: palette.separator }]}>
                <View accessibilityElementsHidden style={styles.searchGlyph}>
                  <TabGlyph name="explore" color={palette.primary} size={21} />
                </View>
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  accessibilityLabel="음식점 검색"
                  placeholder="이름·주소·이야기로 찾기"
                  placeholderTextColor={palette.secondaryLabel}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                  style={[styles.searchInput, { color: palette.label }]}
                />
                {query ? (
                  <Pressable accessibilityRole="button" accessibilityLabel="검색어 지우기" onPress={() => setQuery('')} style={styles.clearSearch}>
                    <Text style={[styles.clearSearchText, { color: palette.secondaryLabel }]}>지우기</Text>
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
                      { backgroundColor: availability === value ? palette.primary : palette.surface, borderColor: availability === value ? palette.primary : palette.separator },
                      pressed && styles.cardPressed,
                    ]}
                  >
                    <Text style={[styles.filterText, { color: availability === value ? palette.onPrimary : palette.label }]}>{label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
          <View style={styles.sectionHeading}>
            <View style={styles.sectionTitleRow}>
              <Text style={[styles.sectionEyebrow, { color: palette.label }]}>동네 음식점</Text>
              <Text accessibilityLiveRegion="polite" style={[styles.sectionCount, { color: palette.secondaryLabel }]}>
                {filtering ? `${visibleMerchants.length} / ${merchants.length}곳` : `${merchants.length}곳`}
              </Text>
            </View>
            {merchants.length > 0 ? (
              <Link href="/recommendations" asChild>
                <Pressable accessibilityRole="button" accessibilityLabel="다음 가게 추천 보기" style={styles.recommendationAction}>
                  <Text style={[styles.recommendationActionText, { color: palette.primary }]}>추천 보기 →</Text>
                </Pressable>
              </Link>
            ) : null}
          </View>
          {error && merchants.length > 0 ? (
            <Pressable accessibilityRole="button" onPress={retry} style={[styles.inlineError, { backgroundColor: palette.errorContainer }]}>
              <Text style={[styles.inlineErrorText, { color: palette.onErrorContainer }]}>{error} 눌러서 다시 시도</Text>
            </Pressable>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        loading ? (
          <StatusPanel palette={palette} title="동네 지도를 펼치는 중" body="공개 중인 캠페인을 확인하고 있습니다.">
            <ActivityIndicator color={palette.primary} />
          </StatusPanel>
        ) : error ? (
          <StatusPanel palette={palette} title="지금은 목록을 가져오지 못했어요" body={error} action="다시 불러오기" onPress={retry} />
        ) : merchants.length > 0 ? (
          <StatusPanel
            palette={palette}
            title="검색 결과가 없어요"
            body="다른 이름이나 주소로 찾거나, 참여 상태 필터를 바꿔 보세요."
            action="검색 초기화"
            onPress={() => { setQuery(''); setAvailability('all'); }}
          />
        ) : (
          <CatalogEmptyState palette={palette} onRefresh={refresh} refreshing={refreshing} />
        )
      }
      renderItem={({ item, index }) => <MerchantCard merchant={item} index={index} palette={palette} />}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListFooterComponent={
        merchants.length > 0 ? (
          <Text selectable style={[styles.footer, { color: palette.secondaryLabel }]}>
            표시된 점포는 현재 개발·검증용 데이터일 수 있습니다. 실제 협약 점포 여부는 별도로
            확인합니다.
          </Text>
        ) : null
      }
    />
  );
}

function CatalogEmptyState({ palette, onRefresh, refreshing }: { palette: AppColors; onRefresh: () => void; refreshing: boolean }) {
  return (
    <View style={[styles.emptyState, { backgroundColor: palette.accentContainer }]}>
      <View style={styles.emptyRoute} accessibilityElementsHidden>
        <View style={[styles.routeStop, { backgroundColor: palette.primary }]} />
        <View style={[styles.routeTrack, { borderColor: palette.onAccentContainer }]} />
        <View style={[styles.routeStop, styles.routeStopOutline, { borderColor: palette.primary }]} />
      </View>
      <Text style={[styles.emptyEyebrow, { color: palette.onAccentContainer }]}>지금의 월계1동</Text>
      <Text selectable style={[styles.emptyTitle, { color: palette.onAccentContainer }]}>공개 중인 음식점이{`\n`}아직 없어요.</Text>
      <Text selectable style={[styles.emptyBody, { color: palette.onAccentContainer }]}>
        참여 캠페인이 열리면 실제 점포가 여기에 나타납니다. 지금은 서비스 이용 흐름을 먼저 살펴볼 수 있어요.
      </Text>
      <View style={[styles.journey, { borderTopColor: palette.onAccentContainer }]}>
        <Text style={[styles.journeyLabel, { color: palette.onAccentContainer }]}>이용 순서</Text>
        <Text style={[styles.journeyText, { color: palette.onAccentContainer }]}>01 음식점 찾기  →  02 방문 인증  →  03 도감</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ busy: refreshing }}
        disabled={refreshing}
        onPress={onRefresh}
        style={({ pressed }) => [styles.emptyRefresh, { backgroundColor: palette.primary }, pressed && styles.cardPressed]}
      >
        <Text style={[styles.emptyRefreshText, { color: palette.onPrimary }]}>{refreshing ? '확인 중…' : '목록 다시 확인'}</Text>
      </Pressable>
    </View>
  );
}

export function MerchantApiConfigurationRequired() {
  const palette = colorsForScheme(useColorScheme());
  return (
    <View style={[styles.configurationContent, { backgroundColor: palette.background }]}>
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

function MerchantCard({ merchant, index, palette }: { merchant: PublicMerchant; index: number; palette: AppColors }) {
  return (
    <Link
      href={{ pathname: '/merchants/[merchantId]', params: { merchantId: merchant.id } }}
      asChild
    >
      <Pressable accessibilityRole="button" style={({ pressed }) => [styles.card, { backgroundColor: palette.surface, borderColor: palette.separator }, pressed && styles.cardPressed]}>
        <View style={styles.cardTopline}>
          <Text style={[styles.routeNumber, { color: palette.primary }]}>{String(index + 1).padStart(2, '0')}</Text>
          <View style={[styles.statusBadge, { backgroundColor: merchant.campaign.enrollmentStatus === 'FULL' ? palette.errorContainer : palette.successContainer }]}>
            <Text style={[styles.statusBadgeText, { color: merchant.campaign.enrollmentStatus === 'FULL' ? palette.onErrorContainer : palette.onSuccessContainer }]}>
              {merchant.campaign.enrollmentStatus === 'OPEN' ? '참여 가능' : '정원 마감'}
            </Text>
          </View>
          {merchant.demo ? (
            <View style={[styles.demoBadge, { backgroundColor: palette.primaryContainer }]}>
              <Text style={[styles.demoBadgeText, { color: palette.onPrimaryContainer }]}>DEMO</Text>
            </View>
          ) : null}
        </View>
        <Text selectable style={[styles.cardTitle, { color: palette.label }]}>{merchant.name}</Text>
        <Text selectable numberOfLines={2} style={[styles.cardStory, { color: palette.secondaryLabel }]}>{merchant.story}</Text>
        <View style={[styles.cardRule, { backgroundColor: palette.separator }]} />
        <View style={styles.cardMeta}>
          <Text selectable numberOfLines={1} style={[styles.cardAddress, { color: palette.label }]}>{merchant.roadAddress}</Text>
          <Text style={[styles.cardArrow, { color: palette.primary }]}>→</Text>
        </View>
        <Text style={[styles.campaignName, { color: palette.secondaryLabel }]}>{merchant.campaign.title}</Text>
      </Pressable>
    </Link>
  );
}

function StatusPanel({
  palette,
  title,
  body,
  action,
  onPress,
  children,
}: {
  palette: AppColors;
  title: string;
  body: string;
  action?: string;
  onPress?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <View style={[styles.statusPanel, { backgroundColor: palette.surface }]}>
      {children}
      <Text style={[styles.statusTitle, { color: palette.label }]}>{title}</Text>
      <Text selectable style={[styles.statusBody, { color: palette.secondaryLabel }]}>{body}</Text>
      {action && onPress ? (
        <Pressable accessibilityRole="button" onPress={onPress} style={[styles.primaryAction, { backgroundColor: palette.primary }]}>
          <Text style={[styles.primaryActionText, { color: palette.onPrimary }]}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    padding: uiMetrics.pageInset,
    paddingBottom: 48,
    backgroundColor: colors.background,
  },
  header: { gap: 11, marginBottom: 14 },
  discoveryTools: { gap: 12, paddingTop: 8 },
  searchField: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1 },
  searchGlyph: { justifyContent: 'center' },
  searchInput: { flex: 1, minWidth: 0, fontSize: 15, paddingVertical: 10 },
  clearSearch: { minHeight: uiMetrics.minTouch, justifyContent: 'center', paddingHorizontal: 4 },
  clearSearchText: { fontSize: 13, fontWeight: '700' },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filterChip: { minHeight: uiMetrics.minTouch, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 999, borderWidth: 1 },
  filterText: { fontSize: 13, fontWeight: '800' },
  routeMarker: {
    alignSelf: 'flex-start',
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
  },
  routeMarkerText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.2 },
  title: { color: colors.label, fontSize: 27, fontWeight: '800', lineHeight: 34, letterSpacing: -0.6 },
  intro: { color: colors.secondaryLabel, fontSize: 14, lineHeight: 21 },
  recommendationAction: { minHeight: uiMetrics.minTouch, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  recommendationActionText: { color: colors.primary, fontSize: 13, fontWeight: '800' },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  sectionEyebrow: { color: colors.label, fontSize: 18, fontWeight: '800' },
  sectionCount: { color: colors.secondaryLabel, fontSize: 13, fontWeight: '700' },
  inlineError: { padding: 12, borderRadius: 12, backgroundColor: colors.errorContainer },
  inlineErrorText: { color: colors.onErrorContainer, fontSize: 13, lineHeight: 19 },
  separator: { height: 14 },
  card: {
    gap: 10,
    padding: 16,
    borderRadius: uiMetrics.cardRadius,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    backgroundColor: colors.surface,
  },
  cardPressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },
  cardTopline: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  routeNumber: { marginRight: 'auto', color: colors.primary, fontSize: 13, fontWeight: '900', letterSpacing: 1.2 },
  statusBadge: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, backgroundColor: colors.successContainer },
  statusBadgeText: { color: colors.onSuccessContainer, fontSize: 11, fontWeight: '800' },
  fullBadge: { backgroundColor: colors.errorContainer },
  fullBadgeText: { color: colors.onErrorContainer },
  demoBadge: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 999, backgroundColor: colors.primaryContainer },
  demoBadgeText: { color: colors.onPrimaryContainer, fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },
  cardTitle: { color: colors.label, fontSize: 21, fontWeight: '800', letterSpacing: -0.4 },
  cardStory: { color: colors.secondaryLabel, fontSize: 14, lineHeight: 21 },
  cardRule: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardAddress: { flex: 1, color: colors.label, fontSize: 13, fontWeight: '600' },
  cardArrow: { color: colors.primary, fontSize: 20, fontWeight: '800' },
  campaignName: { color: colors.secondaryLabel, fontSize: 12 },
  statusPanel: { alignItems: 'center', gap: 12, padding: 28, borderRadius: 22, backgroundColor: colors.surface },
  emptyState: { gap: 14, padding: 24, borderRadius: 24, borderCurve: 'continuous' },
  emptyRoute: { height: 24, flexDirection: 'row', alignItems: 'center' },
  routeStop: { width: 15, height: 15, borderRadius: 999 },
  routeStopOutline: { backgroundColor: 'transparent', borderWidth: 2 },
  routeTrack: { width: 72, height: 1, borderTopWidth: 1, borderStyle: 'dashed' },
  emptyEyebrow: { fontSize: 12, fontWeight: '900', letterSpacing: 0.3 },
  emptyTitle: { fontSize: 24, lineHeight: 31, fontWeight: '900', letterSpacing: -0.5 },
  emptyBody: { fontSize: 14, lineHeight: 22 },
  journey: { gap: 7, paddingTop: 14, borderTopWidth: 1 },
  journeyLabel: { fontSize: 12, fontWeight: '900' },
  journeyText: { fontSize: 13, lineHeight: 21, fontWeight: '700' },
  emptyRefresh: { minHeight: uiMetrics.minTouch, alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: 18, borderRadius: 14 },
  emptyRefreshText: { fontSize: 14, fontWeight: '800' },
  statusTitle: { color: colors.label, fontSize: 20, fontWeight: '800', textAlign: 'center' },
  statusBody: { color: colors.secondaryLabel, fontSize: 15, lineHeight: 23, textAlign: 'center' },
  primaryAction: { marginTop: 4, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 14, backgroundColor: colors.primary },
  primaryActionText: { color: colors.onPrimary, fontSize: 14, fontWeight: '800' },
  footer: { marginTop: 22, color: colors.secondaryLabel, fontSize: 12, lineHeight: 19 },
  configurationContent: { flex: 1, justifyContent: 'center', gap: 18, padding: 24, backgroundColor: colors.background },
  configurationCard: { gap: 8, padding: 18, borderRadius: 18, backgroundColor: colors.surface },
  configurationCode: { color: colors.primary, fontFamily: 'monospace', fontSize: 14, fontWeight: '700' },
  configurationHelp: { color: colors.secondaryLabel, fontSize: 13, lineHeight: 20 },
});
