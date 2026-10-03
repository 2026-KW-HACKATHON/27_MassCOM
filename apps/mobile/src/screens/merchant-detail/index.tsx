import { Link } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AccountCredential } from '@/auth/account-credential';
import { useAuthSession } from '@/auth/auth-provider';
import { recommendMerchant } from '@/friends/recommend-share';
import { useArtFallback } from '@/merchant-art/use-art-fallback';
import { useMerchantCatalog } from '@/merchant/use-merchant-catalog';
import { createVisitorFeedbackApiClient, VisitorFeedbackApiError, type VisitorFeedbackSelection } from '@/merchant/visitor-feedback-api';
import { visitorTagLabels } from '@/merchant/visitor-feedback-codes';
import { colorsForScheme } from '@/theme/palette';
import { worldForScheme } from '@/theme/world';
import { BounceButton } from '@/ui/bounce-button';
import { FloatingCard } from '@/ui/floating-card';
import { BackHeader } from '@/ui/back-header';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';
import { Stagger } from '@/ui/stagger';
import { StateScene } from '@/ui/state-scene';

import { merchantArt } from '../collection/merchant-art';
import { makeMerchantDetailStyles } from './styles';
import { VisitorFeedbackForm } from './visitor-feedback-form';

type MerchantDetailStyles = ReturnType<typeof makeMerchantDetailStyles>;

export function MerchantDetailScreen({ merchantId, apiUrl }: { merchantId: string; apiUrl: string }) {
  const scheme = useColorScheme();
  const palette = colorsForScheme(scheme);
  const world = worldForScheme(scheme);
  const styles = useMemo(
    () => StyleSheet.create(makeMerchantDetailStyles(palette, world, StyleSheet.hairlineWidth)),
    [palette, world],
  );
  const insets = useSafeAreaInsets();
  const auth = useAuthSession();
  const { merchants, loading, refreshing, error, retry, refresh } = useMerchantCatalog(apiUrl);
  const merchant = merchants.find((item) => item.id === merchantId);
  // The hero picture; one that fails to load (a stale catalog pointing at art that was reset) is dropped and the sky shows.
  const art = merchant ? merchantArt(merchant, apiUrl) : undefined;
  const hero = useArtFallback(art?.source);

  if (loading && !merchant) {
    return <StateFrame styles={styles}><StateScene kind="loading" title="가게 이야기를 불러오는 중" /></StateFrame>;
  }

  if (error && !merchant) {
    return (
      <StateFrame styles={styles}>
        <StateScene kind="error" title="가게 정보를 불러오지 못했어요" body={error} action={{ label: '다시 불러오기', onPress: retry }} />
      </StateFrame>
    );
  }

  if (!merchant) {
    return (
      <StateFrame styles={styles}>
        <StateScene kind="empty" title="찾을 수 없는 음식점입니다" body="목록에서 공개 중인 음식점을 다시 선택해 주세요." />
      </StateFrame>
    );
  }

  const artNote = art ? (art.fromServer ? '사장님이 고른 AI 그림' : '가상 점포 시연 그림') : undefined;

  return (
    <SkyBackdrop>
      <SkyScrollView
        header={<BackHeader title="음식점 상세" art={hero.source} artNote={hero.source ? artNote : undefined} onArtError={hero.onError} />}
        contentContainerStyle={{ paddingBottom: 48 + insets.bottom }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} progressViewOffset={insets.top} />}
      >
        <View style={styles.content}>
          <Stagger index={0}>
            <FloatingCard style={styles.hero}>
              <View style={styles.heroTopline}>
                <Text style={styles.heroEyebrow}>WOLGYE LOCAL TABLE</Text>
                {merchant.demo ? <Text style={styles.demoBadge}>DEMO DATA</Text> : null}
              </View>
              <Text selectable accessibilityRole="header" style={styles.title}>{merchant.name}</Text>
              {merchant.story ? <Text selectable style={styles.story}>{merchant.story}</Text> : null}
              <BounceButton
                label="친구에게 추천"
                variant="secondary"
                onPress={() => { void recommendMerchant({ id: merchant.id, name: merchant.name, demo: merchant.demo }); }}
              />
            </FloatingCard>
          </Stagger>

          {error ? (
            <Pressable accessibilityRole="button" onPress={retry} style={styles.inlineError}>
              <Text style={styles.inlineErrorText}>최신 정보 갱신에 실패했습니다. 눌러서 다시 시도</Text>
            </Pressable>
          ) : null}

          <Stagger index={1}>
            <FloatingCard style={styles.infoCard}>
              <InfoRow styles={styles} label="주소" value={merchant.roadAddress} />
              <InfoRow styles={styles} label="최소 이용" value={`${merchant.minimumSpendWon.toLocaleString('ko-KR')}원`} />
              <InfoRow styles={styles} label="참여 상태" value="방문하면 누구나 적립" />
            </FloatingCard>
          </Stagger>

          <Stagger index={2}>
            <FloatingCard style={styles.infoCard}>
              <InfoRow styles={styles} label="점포 제공 영업시간" value={merchant.businessHours || '영업시간 정보가 아직 없습니다.'} />
            </FloatingCard>
          </Stagger>
          <Stagger index={3}>
            <FloatingCard style={styles.infoCard}>
              <Text accessibilityRole="header" style={[styles.sectionEyebrow, styles.menuHeading]}>메뉴·가격</Text>
              {merchant.menuItems.length ? merchant.menuItems.map((item, index) =>
                <InfoRow key={index} styles={styles} label={item.name} value={`${item.priceWon.toLocaleString('ko-KR')}원`} />)
                : <Text style={styles.infoValue}>메뉴 정보가 아직 없습니다.</Text>}
            </FloatingCard>
          </Stagger>

          <Stagger index={4}>
            <FloatingCard style={styles.feedbackCard}>
              <Text accessibilityRole="header" style={styles.feedbackHeading}>방문자들이 고른 특징</Text>
              {merchant.visitorTags.length > 0 ? (
                <View style={styles.feedbackTags}>
                  {merchant.visitorTags.map(({ code, count }) => (
                    <View key={code} style={styles.feedbackTag}>
                      <Text style={styles.feedbackTagText}>{visitorTagLabels[code]} · {count}명</Text>
                    </View>
                  ))}
                </View>
              ) : <Text style={styles.feedbackEmpty}>아직 충분히 모이지 않았어요(같은 특징을 3명 이상 고르면 보여요)</Text>}
              {auth.credential && auth.accountId ? (
                <MyVisitorFeedback
                  key={`${merchant.id}:${auth.accountId}`}
                  merchantId={merchant.id}
                  apiUrl={apiUrl}
                  credential={auth.credential}
                  onSessionInvalid={auth.invalidateSession}
                  styles={styles}
                />
              ) : null}
            </FloatingCard>
          </Stagger>

          <Stagger index={5}>
            <FloatingCard style={styles.rewardCard}>
              <Text style={styles.sectionEyebrow}>진행 중인 캠페인</Text>
              <Text selectable style={styles.campaignTitle}>{merchant.campaign.title}</Text>
              <Text selectable style={styles.period}>
                {formatDate(merchant.campaign.startsAt)} — {formatDate(merchant.campaign.endsAt)}
              </Text>
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
            </FloatingCard>
          </Stagger>

          <Stagger index={6}>
            <FloatingCard style={styles.boundaryCard}>
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
            </FloatingCard>
          </Stagger>

          <Stagger index={7}>
            <FloatingCard style={styles.nextStep}>
              <Text style={styles.nextStepLabel}>이용했다면</Text>
              <Text style={styles.nextStepText}>점주가 만든 1회 코드로 방문과 보상권을 안전하게 받습니다.</Text>
              <Link href={{ pathname: '/claim', params: { merchantId } }} asChild>
                <Pressable accessibilityRole="button" style={styles.walletAction}>
                  <Text style={styles.walletActionText}>방문 코드 받기</Text>
                </Pressable>
              </Link>
            </FloatingCard>
          </Stagger>
        </View>
      </SkyScrollView>
    </SkyBackdrop>
  );
}

function MyVisitorFeedback({ merchantId, apiUrl, credential, onSessionInvalid, styles }: {
  merchantId: string;
  apiUrl: string;
  credential: AccountCredential;
  onSessionInvalid: () => Promise<void>;
  styles: MerchantDetailStyles;
}) {
  const client = useMemo(
    () => createVisitorFeedbackApiClient({ apiUrl, credential, onSessionInvalid }),
    [apiUrl, credential, onSessionInvalid],
  );
  const [selection, setSelection] = useState<VisitorFeedbackSelection | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const requestVersion = useRef(0);
  useEffect(() => () => { requestVersion.current += 1; }, [client, merchantId]);

  async function open() {
    if (loading) return;
    const version = ++requestVersion.current;
    setLoading(true);
    setMessage(null);
    try {
      const mine = await client.getMine(merchantId);
      if (requestVersion.current === version) setSelection(mine);
    } catch (cause) {
      if (requestVersion.current === version) setMessage(cause instanceof VisitorFeedbackApiError && cause.code === 'NOT_ELIGIBLE'
        ? '방문 인증한 가게에서만 고를 수 있어요.'
        : '내 선택을 불러오지 못했어요. 다시 시도해 주세요.');
    } finally {
      if (requestVersion.current === version) setLoading(false);
    }
  }

  return selection ? (
    <VisitorFeedbackForm
      merchantId={merchantId}
      client={client}
      initialSelection={selection}
      editContext
      onClose={() => setSelection(null)}
      onSaved={() => { setSelection(null); setMessage('고마워요! 다른 손님이 가게를 고를 때 도움이 돼요.'); }}
      onNotEligible={() => { setSelection(null); setMessage('방문 인증한 가게에서만 고를 수 있어요.'); }}
    />
  ) : (
    <View>
      <Pressable accessibilityRole="button" accessibilityLabel="내 선택 남기기 또는 바꾸기" accessibilityState={{ disabled: loading }} disabled={loading} onPress={() => { void open(); }} style={styles.feedbackAction}>
        <Text style={styles.feedbackActionText}>{loading ? '내 선택 불러오는 중' : '내 선택 남기기/바꾸기'}</Text>
      </Pressable>
      {message ? <Text accessibilityRole="alert" style={styles.feedbackMessage}>{message}</Text> : null}
    </View>
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

function StateFrame({ styles, children }: { styles: MerchantDetailStyles; children: React.ReactNode }) {
  return (
    <SkyBackdrop>
      <SkyScrollView header={<BackHeader title="음식점 상세" />}>
        <View style={styles.stateWrap}>{children}</View>
      </SkyScrollView>
    </SkyBackdrop>
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
