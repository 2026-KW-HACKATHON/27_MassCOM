import { Link } from 'expo-router';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMerchantCatalog } from '@/merchant/use-merchant-catalog';
import { colors } from '@/theme/colors';

export function MerchantDetailScreen({ merchantId, apiUrl }: { merchantId: string; apiUrl: string }) {
  useColorScheme();
  const insets = useSafeAreaInsets();
  const { merchants, loading, refreshing, error, retry, refresh } = useMerchantCatalog(apiUrl);
  const merchant = merchants.find((item) => item.id === merchantId);

  if (loading && !merchant) {
    return <CenteredState title="가게 이야기를 불러오는 중" loading />;
  }

  if (error && !merchant) {
    return <CenteredState title="가게 정보를 불러오지 못했어요" body={error} action="다시 불러오기" onPress={retry} />;
  }

  if (!merchant) {
    return <CenteredState title="찾을 수 없는 음식점입니다" body="목록에서 공개 중인 음식점을 다시 선택해 주세요." />;
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { paddingBottom: 48 + insets.bottom }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      <View style={styles.hero}>
        <View style={styles.heroTopline}>
          <Text style={styles.heroEyebrow}>WOLGYE LOCAL TABLE</Text>
          {merchant.demo ? <Text style={styles.demoBadge}>DEMO DATA</Text> : null}
        </View>
        <Text selectable style={styles.title}>{merchant.name}</Text>
        <Text selectable style={styles.story}>{merchant.story}</Text>
      </View>

      {error ? (
        <Pressable accessibilityRole="button" onPress={retry} style={styles.inlineError}>
          <Text style={styles.inlineErrorText}>최신 정보 갱신에 실패했습니다. 눌러서 다시 시도</Text>
        </Pressable>
      ) : null}

      <View style={styles.infoCard}>
        <InfoRow label="주소" value={merchant.roadAddress} />
        <InfoRow label="최소 이용" value={`${merchant.minimumSpendWon.toLocaleString('ko-KR')}원`} />
        <InfoRow label="참여 상태" value={merchant.campaign.enrollmentStatus === 'OPEN' ? '참여 가능' : '정원 마감'} />
      </View>

      <View style={styles.campaignHeader}>
        <Text style={styles.sectionEyebrow}>진행 중인 캠페인</Text>
        <Text selectable style={styles.campaignTitle}>{merchant.campaign.title}</Text>
        <Text selectable style={styles.period}>
          {formatDate(merchant.campaign.startsAt)} — {formatDate(merchant.campaign.endsAt)}
        </Text>
      </View>

      <View style={styles.rewardCard}>
        <Text style={styles.rewardHeading}>방문할수록 쌓이는 고정 보상</Text>
        <Text style={styles.rewardNote}>랜덤 뽑기나 결제 없이 1·3·5회 목표로만 진행합니다.</Text>
        <View style={styles.goalList}>
          {merchant.campaign.rewardGoals.map((goal, index) => (
            <RewardGoalRow
              key={`${goal.targetVisitCount}-${goal.displayName}`}
              target={goal.targetVisitCount}
              name={goal.displayName}
              final={index === merchant.campaign.rewardGoals.length - 1}
            />
          ))}
        </View>
      </View>

      <View style={styles.boundaryCard}>
        <Text style={styles.boundaryTitle}>지갑은 나중에 선택해도 됩니다.</Text>
        <Text selectable style={styles.boundaryBody}>
          음식점 탐색·방문 인증·앱 도감은 외부 지갑 없이 사용할 수 있습니다. 앱 수집품과 실제 NFT는
          별도 상태로 표시합니다.
        </Text>
        <Link href="/wallet" asChild>
          <Pressable accessibilityRole="button" style={styles.walletAction}>
            <Text style={styles.walletActionText}>외부 지갑 연결 화면 보기</Text>
          </Pressable>
        </Link>
      </View>

      <View style={styles.nextStep}>
        <Text style={styles.nextStepLabel}>이용했다면</Text>
        <Text style={styles.nextStepText}>점주가 만든 1회 코드로 방문과 보상권을 안전하게 받습니다.</Text>
        <Link href="/claim" asChild>
          <Pressable accessibilityRole="button" style={styles.walletAction}>
            <Text style={styles.walletActionText}>방문 코드 받기</Text>
          </Pressable>
        </Link>
      </View>
    </ScrollView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text selectable style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function RewardGoalRow({ target, name, final }: { target: number; name: string; final: boolean }) {
  return (
    <View style={styles.goalRow}>
      <View style={styles.timeline}>
        <View style={styles.goalNumber}>
          <Text style={styles.goalNumberText}>{target}</Text>
        </View>
        {!final ? <View style={styles.timelineLine} /> : null}
      </View>
      <View style={styles.goalCopy}>
        <Text style={styles.goalLabel}>{target}회 방문</Text>
        <Text selectable style={styles.goalName}>{name}</Text>
      </View>
    </View>
  );
}

function CenteredState({ title, body, action, onPress, loading = false }: { title: string; body?: string; action?: string; onPress?: () => void; loading?: boolean }) {
  return (
    <View style={styles.centeredState}>
      {loading ? <ActivityIndicator color={colors.primary} /> : null}
      <Text style={styles.centeredTitle}>{title}</Text>
      {body ? <Text style={styles.centeredBody}>{body}</Text> : null}
      {action && onPress ? (
        <Pressable accessibilityRole="button" onPress={onPress} style={styles.walletAction}>
          <Text style={styles.walletActionText}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

const styles = StyleSheet.create({
  content: { gap: 18, padding: 20, paddingBottom: 48, backgroundColor: colors.background },
  hero: { gap: 12, padding: 24, borderRadius: 26, borderCurve: 'continuous', backgroundColor: colors.primary },
  heroTopline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  heroEyebrow: { color: colors.onPrimary, fontSize: 11, fontWeight: '900', letterSpacing: 1.1 },
  demoBadge: { color: colors.onPrimary, fontSize: 10, fontWeight: '900', opacity: 0.78 },
  title: { color: colors.onPrimary, fontSize: 34, fontWeight: '900', lineHeight: 42, letterSpacing: -0.7 },
  story: { color: colors.onPrimary, fontSize: 16, lineHeight: 25, opacity: 0.88 },
  inlineError: { padding: 12, borderRadius: 12, backgroundColor: colors.errorContainer },
  inlineErrorText: { color: colors.onErrorContainer, fontSize: 13, lineHeight: 19 },
  infoCard: { paddingHorizontal: 18, borderRadius: 20, borderCurve: 'continuous', backgroundColor: colors.surface },
  infoRow: { flexDirection: 'row', gap: 18, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  infoLabel: { width: 72, color: colors.secondaryLabel, fontSize: 13, fontWeight: '700' },
  infoValue: { flex: 1, color: colors.label, fontSize: 14, fontWeight: '700', textAlign: 'right' },
  campaignHeader: { gap: 6, paddingTop: 4 },
  sectionEyebrow: { color: colors.primary, fontSize: 13, fontWeight: '900' },
  campaignTitle: { color: colors.label, fontSize: 26, fontWeight: '900', letterSpacing: -0.5 },
  period: { color: colors.secondaryLabel, fontSize: 13 },
  rewardCard: { gap: 8, padding: 20, borderRadius: 22, borderCurve: 'continuous', backgroundColor: colors.surface },
  rewardHeading: { color: colors.label, fontSize: 18, fontWeight: '900' },
  rewardNote: { color: colors.secondaryLabel, fontSize: 13, lineHeight: 20 },
  goalList: { marginTop: 10 },
  goalRow: { minHeight: 76, flexDirection: 'row', gap: 14 },
  timeline: { width: 34, alignItems: 'center' },
  goalNumber: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: colors.primaryContainer },
  goalNumberText: { color: colors.onPrimaryContainer, fontSize: 13, fontWeight: '900' },
  timelineLine: { flex: 1, width: 2, marginVertical: 5, backgroundColor: colors.separator },
  goalCopy: { gap: 3, paddingTop: 4 },
  goalLabel: { color: colors.secondaryLabel, fontSize: 12, fontWeight: '700' },
  goalName: { color: colors.label, fontSize: 17, fontWeight: '800' },
  boundaryCard: { gap: 10, padding: 20, borderRadius: 22, borderCurve: 'continuous', backgroundColor: colors.primaryContainer },
  boundaryTitle: { color: colors.onPrimaryContainer, fontSize: 18, fontWeight: '900' },
  boundaryBody: { color: colors.onPrimaryContainer, fontSize: 14, lineHeight: 22 },
  walletAction: { alignSelf: 'flex-start', marginTop: 4, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 14, backgroundColor: colors.primary },
  walletActionText: { color: colors.onPrimary, fontSize: 14, fontWeight: '800' },
  nextStep: { gap: 5, paddingHorizontal: 4 },
  nextStepLabel: { color: colors.primary, fontSize: 12, fontWeight: '900' },
  nextStepText: { color: colors.secondaryLabel, fontSize: 13, lineHeight: 20 },
  centeredState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 28, backgroundColor: colors.background },
  centeredTitle: { color: colors.label, fontSize: 21, fontWeight: '900', textAlign: 'center' },
  centeredBody: { color: colors.secondaryLabel, fontSize: 15, lineHeight: 23, textAlign: 'center' },
});
