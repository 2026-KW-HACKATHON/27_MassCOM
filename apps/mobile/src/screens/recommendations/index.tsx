import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AccountCredential } from '@/auth/account-credential';
import { MerchantMark } from '@/merchant/merchant-mark';
import { createRecommendationApiClient, type Recommendation } from '@/recommendation/recommendation-api';
import { courseChipText } from '@/courses/course-copy';
import { colorsForScheme, type AppColors } from '@/theme/palette';
import { BackHeader } from '@/ui/back-header';
import { FloatingCard } from '@/ui/floating-card';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';
import { reasonLabel, recommendationHint, recommendationLabel } from './recommendation-label';
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
  const router = useRouter();
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

  // The native stack header is hidden for this page: the back button lives in the sky header inside the scroll content.
  const header = <BackHeader title="다음 가게 추천" />;

  if (loading && !recommendations) {
    return (
      <SkyBackdrop>
        <SkyScrollView header={header}>
          <View style={styles.centered}>
            <ActivityIndicator color={palette.primary} />
            <Text style={styles.centeredTitle}>다음 동네 가게를 찾는 중</Text>
          </View>
        </SkyScrollView>
      </SkyBackdrop>
    );
  }

  if (!recommendations) {
    return (
      <SkyBackdrop>
        <SkyScrollView header={header}>
          <View style={styles.centered}>
            <Text style={styles.centeredTitle}>추천을 불러오지 못했어요</Text>
            <Text accessibilityRole="alert" style={styles.centeredBody}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={refresh} style={styles.retryButton}>
              <Text style={styles.retryButtonText}>다시 불러오기</Text>
            </Pressable>
          </View>
        </SkyScrollView>
      </SkyBackdrop>
    );
  }

  return (
    <SkyBackdrop>
      <SkyScrollView
        header={header}
        contentContainerStyle={[styles.content, { paddingBottom: 48 + insets.bottom }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} progressViewOffset={insets.top} />}
      >
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>다음 월계 맛길</Text>
          <Text selectable style={styles.title}>다음에 가볼 가게</Text>
          <Text selectable style={styles.body}>
            아직 안 가본 가게와 다음 보상이 가까운 가게를 먼저 보여줘요. 자리가 다 찬 가게는 빼요.
          </Text>
          <Pressable accessibilityRole="button" onPress={() => router.push('/courses')} style={styles.courseListLink}>
            <Text style={styles.courseListLinkText}>연합 미션 보기 →</Text>
          </Pressable>
        </View>

        <Text style={styles.rotationNote}>순위가 같은 가게는 날마다 순서를 바꿔 보여줘요.</Text>

        {error ? <Text accessibilityLiveRegion="polite" style={styles.inlineError}>{error}</Text> : null}

        {recommendations.length === 0 ? (
          <FloatingCard style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>지금 추천할 수 있는 점포가 없어요</Text>
            <Text style={styles.emptyBody}>공개 캠페인과 정원 상태를 확인한 뒤 다시 시도해 주세요.</Text>
          </FloatingCard>
        ) : (
          recommendations.map((item, index) => (
            <RecommendationCard styles={styles} palette={palette} key={item.merchantId} item={item} index={index} />
          ))
        )}
      </SkyScrollView>
    </SkyBackdrop>
  );
}

function RecommendationCard({ styles, palette, item, index }: { styles: RecommendationsStyles; palette: AppColors; item: Recommendation; index: number }) {
  const router = useRouter();
  return (
    <FloatingCard
      style={styles.card}
      accessibilityLabel={recommendationLabel(item)}
      accessibilityHint={recommendationHint()}
      onPress={() => router.push({ pathname: '/merchants/[merchantId]', params: { merchantId: item.merchantId, from: 'recommendation' } })}
    >
      <View style={styles.cardTopline}>
        <Text style={styles.reasonCode}>{reasonLabel(item.reasonCode)}</Text>
        {item.demo ? <Text style={styles.demo}>DEMO</Text> : null}
      </View>
      <View style={styles.cardNameRow}>
        <MerchantMark label={String(index + 1)} visited={item.progressVisitCount > 0} palette={palette} />
        <Text selectable style={[styles.cardTitle, { flex: 1 }]}>{item.merchantName}</Text>
      </View>
      <Text selectable style={styles.reason}>{item.reasonText}</Text>
      {item.course ? <Pressable accessibilityRole="button" accessibilityLabel={`${courseChipText(item.course)} 상세 보기`}
        onPress={(event) => { event.stopPropagation(); router.push({ pathname: '/courses/[courseId]', params: { courseId: item.course!.courseId } }); }}
        style={styles.courseChip}><Text style={styles.courseChipText}>{courseChipText(item.course)} →</Text></Pressable> : null}
      <Text style={styles.meta}>{item.roadAddress}</Text>
      <View style={styles.progressRow}>
        <Text style={styles.progress}>현재 {item.progressVisitCount}회</Text>
        <Text style={styles.goal}>{item.nextGoal ? `다음 ${item.nextGoal.targetVisitCount}회 · ${item.nextGoal.displayName}` : '고정 보상 완료'}</Text>
      </View>
      <Text style={styles.openDetail}>가게 상세 보기 →</Text>
    </FloatingCard>
  );
}
