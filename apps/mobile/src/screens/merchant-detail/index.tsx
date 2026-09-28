import { Link } from 'expo-router';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMerchantCatalog } from '@/merchant/use-merchant-catalog';
import { colorsForScheme } from '@/theme/palette';
import { makeMerchantDetailStyles } from './styles';

type MerchantDetailStyles = ReturnType<typeof makeMerchantDetailStyles>;

export function MerchantDetailScreen({ merchantId, apiUrl }: { merchantId: string; apiUrl: string }) {
  const palette = colorsForScheme(useColorScheme());
  const styles = StyleSheet.create(makeMerchantDetailStyles(palette, StyleSheet.hairlineWidth));
  const insets = useSafeAreaInsets();
  const { merchants, loading, refreshing, error, retry, refresh } = useMerchantCatalog(apiUrl);
  const merchant = merchants.find((item) => item.id === merchantId);

  if (loading && !merchant) {
    return <CenteredState styles={styles} palette={palette} title="가게 이야기를 불러오는 중" loading />;
  }

  if (error && !merchant) {
    return <CenteredState styles={styles} palette={palette} title="가게 정보를 불러오지 못했어요" body={error} action="다시 불러오기" onPress={retry} />;
  }

  if (!merchant) {
    return <CenteredState styles={styles} palette={palette} title="찾을 수 없는 음식점입니다" body="목록에서 공개 중인 음식점을 다시 선택해 주세요." />;
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
        {merchant.story ? <Text selectable style={styles.story}>{merchant.story}</Text> : null}
      </View>

      {error ? (
        <Pressable accessibilityRole="button" onPress={retry} style={styles.inlineError}>
          <Text style={styles.inlineErrorText}>최신 정보 갱신에 실패했습니다. 눌러서 다시 시도</Text>
        </Pressable>
      ) : null}

      <View style={styles.infoCard}>
        <InfoRow styles={styles} label="주소" value={merchant.roadAddress} />
        <InfoRow styles={styles} label="최소 이용" value={`${merchant.minimumSpendWon.toLocaleString('ko-KR')}원`} />
        <InfoRow styles={styles} label="참여 상태" value={merchant.campaign.enrollmentStatus === 'OPEN' ? '참여 가능' : '정원 마감'} />
      </View>

      <View style={styles.infoCard}>
        <InfoRow styles={styles} label="점포 제공 영업시간" value={merchant.businessHours || '영업시간 정보가 아직 없습니다.'} />
      </View>
      <View style={styles.infoCard}>
        <Text accessibilityRole="header" style={styles.sectionEyebrow}>메뉴·가격</Text>
        {merchant.menuItems.length ? merchant.menuItems.map((item, index) =>
          <InfoRow key={index} styles={styles} label={item.name} value={`${item.priceWon.toLocaleString('ko-KR')}원`} />)
          : <Text style={styles.infoValue}>메뉴 정보가 아직 없습니다.</Text>}
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
              styles={styles}
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
        <Link href={{ pathname: '/wallet', params: { merchantId } }} asChild>
          <Pressable accessibilityRole="button" style={styles.walletAction}>
            <Text style={styles.walletActionText}>외부 지갑 연결 화면 보기</Text>
          </Pressable>
        </Link>
      </View>

      <View style={styles.nextStep}>
        <Text style={styles.nextStepLabel}>이용했다면</Text>
        <Text style={styles.nextStepText}>점주가 만든 1회 코드로 방문과 보상권을 안전하게 받습니다.</Text>
        <Link href={{ pathname: '/claim', params: { merchantId } }} asChild>
          <Pressable accessibilityRole="button" style={styles.walletAction}>
            <Text style={styles.walletActionText}>방문 코드 받기</Text>
          </Pressable>
        </Link>
      </View>
    </ScrollView>
  );
}

function InfoRow({ styles, label, value }: { styles: MerchantDetailStyles; label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text selectable style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function RewardGoalRow({ styles, target, name, final }: { styles: MerchantDetailStyles; target: number; name: string; final: boolean }) {
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

function CenteredState({ styles, palette, title, body, action, onPress, loading = false }: { styles: MerchantDetailStyles; palette: ReturnType<typeof colorsForScheme>; title: string; body?: string; action?: string; onPress?: () => void; loading?: boolean }) {
  return (
    <View style={styles.centeredState}>
      {loading ? <ActivityIndicator color={palette.primary} /> : null}
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
