import { Link } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';

import type { PublicMerchant } from '@/merchant/merchant-api';
import { useMerchantCatalog } from '@/merchant/use-merchant-catalog';
import { colors } from '@/theme/colors';

type Props = {
  apiUrl: string;
};

export function MerchantListScreen({ apiUrl }: Props) {
  useColorScheme();
  const { merchants, loading, refreshing, error, retry, refresh } = useMerchantCatalog(apiUrl);

  return (
    <FlatList
      data={merchants}
      keyExtractor={(merchant) => merchant.id}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      ListHeaderComponent={
        <View style={styles.header}>
          <View style={styles.routeMarker}>
            <Text style={styles.routeMarkerText}>월계1동 · LOCAL ROUTE 01</Text>
          </View>
          <Text selectable style={styles.title}>오늘의 한 끼가{`\n`}동네 기록이 됩니다.</Text>
          <Text selectable style={styles.intro}>
            지갑 없이 가게를 둘러보고 방문을 모아보세요. 실제 NFT 발행은 원하는 사람만 나중에
            선택합니다.
          </Text>
          <View style={styles.primaryActions}>
            <Link href="/claim" asChild>
              <Pressable accessibilityRole="button" style={styles.primaryActionLink}>
                <Text style={styles.primaryActionLinkText}>방문 코드 받기</Text>
              </Pressable>
            </Link>
            <Link href="/collection" asChild>
              <Pressable accessibilityRole="button" style={styles.primaryActionLink}>
                <Text style={styles.primaryActionLinkText}>내 도감</Text>
              </Pressable>
            </Link>
          </View>
          <Link href="/recommendations" asChild>
            <Pressable accessibilityRole="button" style={styles.recommendationAction}>
              <Text style={styles.recommendationActionText}>이유가 보이는 다음 가게 추천 →</Text>
            </Pressable>
          </Link>
          <View style={styles.quickActions}>
            <Link href="/merchant" asChild>
              <Pressable accessibilityRole="button" style={styles.secondaryAction}>
                <Text style={styles.secondaryActionText}>점주 데모</Text>
              </Pressable>
            </Link>
            <Link href="/wallet" asChild>
              <Pressable accessibilityRole="button" style={styles.secondaryAction}>
                <Text style={styles.secondaryActionText}>외부 지갑 연결</Text>
              </Pressable>
            </Link>
            <View style={styles.privacyNote}>
              <Text style={styles.privacyNoteText}>탐색에는 지갑 불필요</Text>
            </View>
          </View>
          <View style={styles.sectionHeading}>
            <Text style={styles.sectionEyebrow}>동네 음식점</Text>
            <Text style={styles.sectionCount}>{merchants.length}곳</Text>
          </View>
          {error && merchants.length > 0 ? (
            <Pressable accessibilityRole="button" onPress={retry} style={styles.inlineError}>
              <Text style={styles.inlineErrorText}>{error} 눌러서 다시 시도</Text>
            </Pressable>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        loading ? (
          <StatusPanel title="동네 지도를 펼치는 중" body="공개 중인 캠페인을 확인하고 있습니다.">
            <ActivityIndicator color={colors.primary} />
          </StatusPanel>
        ) : error ? (
          <StatusPanel title="지금은 목록을 가져오지 못했어요" body={error} action="다시 불러오기" onPress={retry} />
        ) : (
          <StatusPanel
            title="현재 참여 중인 음식점이 없어요"
            body="공개 캠페인이 시작되면 이곳에서 바로 확인할 수 있습니다."
          />
        )
      }
      renderItem={({ item, index }) => <MerchantCard merchant={item} index={index} />}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListFooterComponent={
        merchants.length > 0 ? (
          <Text selectable style={styles.footer}>
            표시된 점포는 현재 개발·검증용 데이터일 수 있습니다. 실제 협약 점포 여부는 별도로
            확인합니다.
          </Text>
        ) : null
      }
    />
  );
}

export function MerchantApiConfigurationRequired() {
  return (
    <View style={styles.configurationContent}>
      <Text style={styles.sectionEyebrow}>설정 필요</Text>
      <Text selectable style={styles.title}>음식점 API 주소가{`\n`}아직 연결되지 않았습니다.</Text>
      <Text selectable style={styles.intro}>
        EXPO_PUBLIC_API_URL을 설정하면 지갑 설정 없이도 음식점 탐색을 시작할 수 있습니다.
      </Text>
      <View style={styles.configurationCard}>
        <Text selectable style={styles.configurationCode}>EXPO_PUBLIC_API_URL</Text>
        <Text style={styles.configurationHelp}>실기기에서는 컴퓨터의 LAN 주소, 배포 환경에서는 HTTPS 주소를 사용합니다.</Text>
      </View>
    </View>
  );
}

function MerchantCard({ merchant, index }: { merchant: PublicMerchant; index: number }) {
  return (
    <Link
      href={{ pathname: '/merchants/[merchantId]', params: { merchantId: merchant.id } }}
      asChild
    >
      <Pressable accessibilityRole="button" style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}>
        <View style={styles.cardTopline}>
          <Text style={styles.routeNumber}>{String(index + 1).padStart(2, '0')}</Text>
          <View style={[styles.statusBadge, merchant.campaign.enrollmentStatus === 'FULL' && styles.fullBadge]}>
            <Text style={[styles.statusBadgeText, merchant.campaign.enrollmentStatus === 'FULL' && styles.fullBadgeText]}>
              {merchant.campaign.enrollmentStatus === 'OPEN' ? '참여 가능' : '정원 마감'}
            </Text>
          </View>
          {merchant.demo ? (
            <View style={styles.demoBadge}>
              <Text style={styles.demoBadgeText}>DEMO</Text>
            </View>
          ) : null}
        </View>
        <Text selectable style={styles.cardTitle}>{merchant.name}</Text>
        <Text selectable numberOfLines={2} style={styles.cardStory}>{merchant.story}</Text>
        <View style={styles.cardRule} />
        <View style={styles.cardMeta}>
          <Text selectable numberOfLines={1} style={styles.cardAddress}>{merchant.roadAddress}</Text>
          <Text style={styles.cardArrow}>→</Text>
        </View>
        <Text style={styles.campaignName}>{merchant.campaign.title}</Text>
      </Pressable>
    </Link>
  );
}

function StatusPanel({
  title,
  body,
  action,
  onPress,
  children,
}: {
  title: string;
  body: string;
  action?: string;
  onPress?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <View style={styles.statusPanel}>
      {children}
      <Text style={styles.statusTitle}>{title}</Text>
      <Text selectable style={styles.statusBody}>{body}</Text>
      {action && onPress ? (
        <Pressable accessibilityRole="button" onPress={onPress} style={styles.primaryAction}>
          <Text style={styles.primaryActionText}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    padding: 20,
    paddingBottom: 48,
    backgroundColor: colors.background,
  },
  header: { gap: 16, marginBottom: 22 },
  routeMarker: {
    alignSelf: 'flex-start',
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.primaryContainer,
  },
  routeMarkerText: { color: colors.onPrimaryContainer, fontSize: 12, fontWeight: '800', letterSpacing: 0.7 },
  title: { color: colors.label, fontSize: 34, fontWeight: '900', lineHeight: 42, letterSpacing: -0.8 },
  intro: { color: colors.secondaryLabel, fontSize: 16, lineHeight: 25 },
  quickActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  primaryActions: { flexDirection: 'row', gap: 10 },
  primaryActionLink: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, borderRadius: 14, backgroundColor: colors.primary },
  primaryActionLinkText: { color: colors.onPrimary, fontSize: 14, fontWeight: '900' },
  recommendationAction: { minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, borderRadius: 14, backgroundColor: colors.primaryContainer },
  recommendationActionText: { color: colors.onPrimaryContainer, fontSize: 14, fontWeight: '900' },
  secondaryAction: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  secondaryActionText: { color: colors.primary, fontSize: 14, fontWeight: '800' },
  privacyNote: { flex: 1 },
  privacyNoteText: { color: colors.secondaryLabel, fontSize: 12, lineHeight: 18 },
  sectionHeading: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 16 },
  sectionEyebrow: { color: colors.primary, fontSize: 14, fontWeight: '800' },
  sectionCount: { color: colors.secondaryLabel, fontSize: 13, fontWeight: '700' },
  inlineError: { padding: 12, borderRadius: 12, backgroundColor: colors.errorContainer },
  inlineErrorText: { color: colors.onErrorContainer, fontSize: 13, lineHeight: 19 },
  separator: { height: 14 },
  card: {
    gap: 10,
    padding: 20,
    borderRadius: 22,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    backgroundColor: colors.surface,
    boxShadow: '0 9px 28px rgba(16, 40, 51, 0.07)',
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
  cardTitle: { color: colors.label, fontSize: 24, fontWeight: '900', letterSpacing: -0.4 },
  cardStory: { color: colors.secondaryLabel, fontSize: 15, lineHeight: 23 },
  cardRule: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardAddress: { flex: 1, color: colors.label, fontSize: 13, fontWeight: '600' },
  cardArrow: { color: colors.primary, fontSize: 20, fontWeight: '800' },
  campaignName: { color: colors.secondaryLabel, fontSize: 12 },
  statusPanel: { alignItems: 'center', gap: 12, padding: 28, borderRadius: 22, backgroundColor: colors.surface },
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
