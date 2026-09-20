import { Link } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { createRecommendationApiClient, type Recommendation } from '@/recommendation/recommendation-api';
import { colors } from '@/theme/colors';

export function RecommendationsScreen({ apiUrl, accountId }: { apiUrl: string; accountId: string }) {
  const insets = useSafeAreaInsets();
  const api = useMemo(
    () => createRecommendationApiClient({ apiUrl, accountId }),
    [accountId, apiUrl],
  );
  const [recommendations, setRecommendations] = useState<readonly Recommendation[]>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    void api
      .listRecommendations(controller.signal)
      .then(setRecommendations)
      .catch(() => {
        if (!controller.signal.aborted) {
          setError('추천을 불러오지 못했습니다. API 연결을 확인해 주세요.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [api]);

  async function refresh() {
    setRefreshing(true);
    setError(undefined);
    try {
      setRecommendations(await api.listRecommendations());
    } catch {
      setError('최신 추천을 가져오지 못했습니다. 기존 순서는 유지합니다.');
    } finally {
      setRefreshing(false);
    }
  }

  if (loading && !recommendations) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.centeredTitle}>다음 동네 가게를 찾는 중</Text>
      </View>
    );
  }

  if (!recommendations) {
    return (
      <View style={styles.centered}>
        <Text style={styles.centeredTitle}>추천을 불러오지 못했어요</Text>
        <Text style={styles.centeredBody}>{error}</Text>
        <Pressable accessibilityRole="button" onPress={refresh} style={styles.retryButton}>
          <Text style={styles.retryButtonText}>다시 불러오기</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { paddingBottom: 48 + insets.bottom }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>다음 월계 맛길</Text>
        <Text selectable style={styles.title}>추천 이유를 보고{`\n`}다음 가게를 고릅니다.</Text>
        <Text selectable style={styles.body}>
          정원 마감 점포는 빼고, 미방문 점포와 다음 고정 보상까지 가까운 점포를 먼저 보여줍니다.
        </Text>
      </View>

      <View style={styles.policyCard}>
        <Text style={styles.policyTitle}>추천 정책</Text>
        <Text style={styles.policyBody}>미방문 우선 · 이유 공개 · 한국 날짜별 동일 순위 회전</Text>
      </View>

      {error ? <Text style={styles.inlineError}>{error}</Text> : null}

      {recommendations.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>지금 추천할 수 있는 점포가 없어요</Text>
          <Text style={styles.emptyBody}>공개 캠페인과 정원 상태를 확인한 뒤 다시 시도해 주세요.</Text>
        </View>
      ) : (
        recommendations.map((item, index) => (
          <RecommendationCard key={item.merchantId} item={item} index={index} />
        ))
      )}
    </ScrollView>
  );
}

function RecommendationCard({ item, index }: { item: Recommendation; index: number }) {
  return (
    <Link
      href={{ pathname: '/merchants/[merchantId]', params: { merchantId: item.merchantId } }}
      asChild
    >
      <Pressable accessibilityRole="button" style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}>
        <View style={styles.cardTopline}>
          <Text style={styles.rank}>{String(index + 1).padStart(2, '0')}</Text>
          <Text style={styles.reasonCode}>{reasonLabel(item.reasonCode)}</Text>
          {item.demo ? <Text style={styles.demo}>DEMO</Text> : null}
        </View>
        <Text selectable style={styles.cardTitle}>{item.merchantName}</Text>
        <Text selectable style={styles.reason}>{item.reasonText}</Text>
        <Text style={styles.meta}>{item.roadAddress}</Text>
        <View style={styles.progressRow}>
          <Text style={styles.progress}>현재 {item.progressVisitCount}회</Text>
          <Text style={styles.goal}>{item.nextGoal ? `다음 ${item.nextGoal.targetVisitCount}회 · ${item.nextGoal.displayName}` : '고정 보상 완료'}</Text>
        </View>
        <Text style={styles.openDetail}>가게 상세 보기 →</Text>
      </Pressable>
    </Link>
  );
}

function reasonLabel(code: Recommendation['reasonCode']): string {
  if (code === 'NEW_PLACE') return '새로운 가게';
  if (code === 'NEXT_REWARD') return '다음 보상 가까움';
  return '도감 완성';
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 28, backgroundColor: colors.background },
  centeredTitle: { color: colors.label, fontSize: 21, fontWeight: '900', textAlign: 'center' },
  centeredBody: { color: colors.secondaryLabel, fontSize: 14, lineHeight: 22, textAlign: 'center' },
  retryButton: { paddingHorizontal: 18, paddingVertical: 12, borderRadius: 14, backgroundColor: colors.primary },
  retryButtonText: { color: colors.onPrimary, fontSize: 14, fontWeight: '900' },
  content: { gap: 16, padding: 20, paddingBottom: 48, backgroundColor: colors.background },
  hero: { gap: 11, paddingBottom: 8 },
  eyebrow: { color: colors.primary, fontSize: 13, fontWeight: '900' },
  title: { color: colors.label, fontSize: 31, fontWeight: '900', lineHeight: 39, letterSpacing: -0.6 },
  body: { color: colors.secondaryLabel, fontSize: 15, lineHeight: 24 },
  policyCard: { gap: 4, padding: 16, borderRadius: 18, backgroundColor: colors.primaryContainer },
  policyTitle: { color: colors.onPrimaryContainer, fontSize: 13, fontWeight: '900' },
  policyBody: { color: colors.onPrimaryContainer, fontSize: 13, lineHeight: 20 },
  inlineError: { padding: 12, borderRadius: 12, color: colors.onErrorContainer, backgroundColor: colors.errorContainer, fontSize: 13 },
  emptyCard: { gap: 8, padding: 22, borderRadius: 20, backgroundColor: colors.surface },
  emptyTitle: { color: colors.label, fontSize: 18, fontWeight: '900' },
  emptyBody: { color: colors.secondaryLabel, fontSize: 14, lineHeight: 22 },
  card: { gap: 11, padding: 20, borderRadius: 22, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.separator, backgroundColor: colors.surface },
  cardPressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },
  cardTopline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rank: { marginRight: 'auto', color: colors.primary, fontSize: 13, fontWeight: '900', letterSpacing: 1 },
  reasonCode: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, color: colors.onSuccessContainer, backgroundColor: colors.successContainer, fontSize: 11, fontWeight: '900' },
  demo: { color: colors.onPrimaryContainer, fontSize: 10, fontWeight: '900' },
  cardTitle: { color: colors.label, fontSize: 24, fontWeight: '900' },
  reason: { color: colors.label, fontSize: 16, lineHeight: 24, fontWeight: '700' },
  meta: { color: colors.secondaryLabel, fontSize: 12 },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  progress: { color: colors.secondaryLabel, fontSize: 12, fontWeight: '700' },
  goal: { flex: 1, color: colors.label, fontSize: 12, fontWeight: '800', textAlign: 'right' },
  openDetail: { color: colors.primary, fontSize: 13, fontWeight: '900', textAlign: 'right' },
});
