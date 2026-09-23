import { Link } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AccountCredential } from '@/auth/account-credential';
import { createRecommendationApiClient, type Recommendation } from '@/recommendation/recommendation-api';
import { colorsForScheme } from '@/theme/palette';
import { makeRecommendationsStyles } from './styles';

type RecommendationsStyles = ReturnType<typeof makeRecommendationsStyles>;

export function RecommendationsScreen({
  apiUrl,
  credential,
  onSessionInvalid,
}: {
  apiUrl: string;
  credential: AccountCredential;
  onSessionInvalid: () => Promise<void>;
}) {
  const palette = colorsForScheme(useColorScheme());
  const styles = StyleSheet.create(makeRecommendationsStyles(palette, StyleSheet.hairlineWidth));
  const insets = useSafeAreaInsets();
  const api = useMemo(
    () => createRecommendationApiClient({ apiUrl, credential, onSessionInvalid }),
    [apiUrl, credential, onSessionInvalid],
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
        <ActivityIndicator color={palette.primary} />
        <Text style={styles.centeredTitle}>다음 동네 가게를 찾는 중</Text>
      </View>
    );
  }

  if (!recommendations) {
    return (
      <View style={styles.centered}>
        <Text style={styles.centeredTitle}>추천을 불러오지 못했어요</Text>
        <Text accessibilityRole="alert" style={styles.centeredBody}>{error}</Text>
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

      {error ? <Text accessibilityLiveRegion="polite" style={styles.inlineError}>{error}</Text> : null}

      {recommendations.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>지금 추천할 수 있는 점포가 없어요</Text>
          <Text style={styles.emptyBody}>공개 캠페인과 정원 상태를 확인한 뒤 다시 시도해 주세요.</Text>
        </View>
      ) : (
        recommendations.map((item, index) => (
          <RecommendationCard styles={styles} key={item.merchantId} item={item} index={index} />
        ))
      )}
    </ScrollView>
  );
}

function RecommendationCard({ styles, item, index }: { styles: RecommendationsStyles; item: Recommendation; index: number }) {
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
