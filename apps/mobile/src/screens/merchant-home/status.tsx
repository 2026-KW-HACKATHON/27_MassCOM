import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useColorScheme, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { focusMerchantHeading } from './focus-heading';
import { createVisitReversalScroll } from './visit-reversal-scroll';
import type { AccountCredential } from '@/auth/account-credential';
import { createCommerceApiClient } from '@/commerce/commerce-api';
import { createMerchantInsightsApiClient, type MerchantOverview, type VisitorFeedbackSummary } from '@/merchant-insights/api';
import { feedbackSections, overviewCards, visitBars } from '@/merchant-insights/view-model';
import { StaffReversalCards } from '@/screens/merchant-claim/staff-reversal';
import type { VisitSelection } from '@/screens/merchant-claim/issued-visit';
import { makeMerchantClaimStyles } from '@/screens/merchant-claim/styles';
import { colorsForScheme } from '@/theme/palette';

type Props = {
  apiUrl: string;
  merchantId: string;
  credential: AccountCredential;
  onSessionInvalid: () => void | Promise<void>;
  selectedVisit?: VisitSelection;
};

export function MerchantStatusScreen({ apiUrl, merchantId, credential, onSessionInvalid, selectedVisit }: Props) {
  const colors = colorsForScheme(useColorScheme());
  const { fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reversalStyles = StyleSheet.create(makeMerchantClaimStyles(colors, StyleSheet.hairlineWidth));
  const insights = useMemo(() => createMerchantInsightsApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const commerce = useMemo(() => createCommerceApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const [overview, setOverview] = useState<MerchantOverview>();
  const [feedback, setFeedback] = useState<VisitorFeedbackSummary>();
  const [overviewError, setOverviewError] = useState(false);
  const [feedbackError, setFeedbackError] = useState(false);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [feedbackLoading, setFeedbackLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reversalRefresh, setReversalRefresh] = useState(0);
  const overviewRequest = useRef(0);
  const feedbackRequest = useRef(0);
  const mounted = useRef(true);
  const heading = useRef<Text>(null);
  const scroll = useRef<ScrollView>(null);
  const [visitScroll] = useState(createVisitReversalScroll);

  const loadOverview = useCallback(async () => {
    const request = ++overviewRequest.current;
    setOverviewLoading(true);
    setOverviewError(false);
    try {
      const result = await insights.getOverview(merchantId);
      if (mounted.current && request === overviewRequest.current) setOverview(result);
    } catch {
      if (mounted.current && request === overviewRequest.current) setOverviewError(true);
    } finally {
      if (mounted.current && request === overviewRequest.current) setOverviewLoading(false);
    }
  }, [insights, merchantId]);
  const loadFeedback = useCallback(async () => {
    const request = ++feedbackRequest.current;
    setFeedbackLoading(true);
    setFeedbackError(false);
    try {
      const result = await insights.getVisitorFeedback(merchantId);
      if (mounted.current && request === feedbackRequest.current) setFeedback(result);
    } catch {
      if (mounted.current && request === feedbackRequest.current) setFeedbackError(true);
    } finally {
      if (mounted.current && request === feedbackRequest.current) setFeedbackLoading(false);
    }
  }, [insights, merchantId]);

  useEffect(() => {
    mounted.current = true;
    const frame = requestAnimationFrame(() => {
      void loadOverview();
      void loadFeedback();
      focusMerchantHeading(heading.current);
    });
    return () => {
      cancelAnimationFrame(frame);
      mounted.current = false;
      overviewRequest.current += 1;
      feedbackRequest.current += 1;
    };
  }, [loadOverview, loadFeedback]);

  const refresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    setReversalRefresh((value) => value + 1);
    await Promise.all([loadOverview(), loadFeedback()]);
    if (mounted.current) setRefreshing(false);
  }, [loadOverview, loadFeedback, refreshing]);

  const scrollToVisit = useCallback((y: number | undefined) => {
    if (y !== undefined) scroll.current?.scrollTo({ y, animated: true });
  }, []);
  const showPreselectedVisit = useCallback((offset: number | undefined) => scrollToVisit(visitScroll.select(offset)), [scrollToVisit, visitScroll]);

  const sections = feedback ? feedbackSections(feedback) : undefined;
  const bars = overview ? visitBars(overview) : undefined;

  return <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ gap: 18, padding: 20, paddingBottom: 36 }} refreshControl={<RefreshControl progressViewOffset={insets.top} refreshing={refreshing} onRefresh={() => void refresh()} />}>
    <View style={{ gap: 12 }}>
      <Text ref={heading} accessible accessibilityRole="header" style={{ color: colors.label, fontSize: 25, fontWeight: '900' }}>오늘·현황</Text>
      {overviewLoading && !overview ? <ActivityIndicator accessibilityLabel="현황 불러오는 중" color={colors.primary} /> : null}
      {overviewError ? <Retry label="현황을 불러오지 못했어요. 다시 시도" onPress={() => void loadOverview()} color={colors.primary} disabled={overviewLoading} /> : null}
      {overview ? <>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {overviewCards(overview).map((card) => <View key={card.id ?? card.label} style={{ width: fontScale >= 1.5 ? '100%' : '48%', minWidth: 135, flexGrow: 1, gap: 5, padding: 16, borderRadius: 18, backgroundColor: colors.surface }}>
            <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>{card.label}</Text>
            <Text selectable style={{ color: colors.label, fontSize: 24, fontWeight: '900', fontVariant: ['tabular-nums'] }}>{card.value}</Text>
            {card.comparison ? <Text selectable style={{ color: colors.secondaryLabel, fontSize: 12 }}>{card.comparison}</Text> : null}
          </View>)}
        </View>
        <View style={{ gap: 10, padding: 16, borderRadius: 18, backgroundColor: colors.surface }}>
          <Text accessibilityRole="header" style={{ color: colors.label, fontSize: 18, fontWeight: '900' }}>최근 7일 방문</Text>
          <Text selectable style={{ color: colors.secondaryLabel }}>{bars?.summary}</Text>
          <ScrollView horizontal contentContainerStyle={{ gap: 10, minWidth: '100%', justifyContent: 'space-between' }} showsHorizontalScrollIndicator={false}>
            {bars?.days.map((day) => <View key={day.date} style={{ width: fontScale >= 1.5 ? 76 : 44, alignItems: 'center', gap: 5 }}>
              <Text style={{ color: colors.label, fontSize: 12, fontWeight: '700' }}>{day.count}</Text>
              <View style={{ width: 28, height: 64, justifyContent: 'flex-end' }}>
                <View style={{ width: 28, height: `${day.heightPercent}%`, minHeight: day.count ? 3 : 0, borderRadius: 4, backgroundColor: colors.primary }} />
              </View>
              <Text style={{ color: colors.secondaryLabel, fontSize: 12 }}>{day.label}</Text>
            </View>)}
          </ScrollView>
        </View>
        <Text selectable style={{ color: colors.secondaryLabel }}>방문 인증 기준이며 매출과 다를 수 있어요</Text>
        {overview.weekDetailViews !== undefined ? <Text selectable style={{ color: colors.secondaryLabel }}>가게 상세 조회는 사람 수가 아니라 열람 횟수예요</Text> : null}
        <Text selectable style={{ color: colors.onPrimaryContainer, backgroundColor: colors.primaryContainer, padding: 14, borderRadius: 14, lineHeight: 21 }}>{overview.readiness.message}</Text>
      </> : null}
    </View>

    <View onLayout={({ nativeEvent }) => scrollToVisit(visitScroll.layout(nativeEvent.layout.y))}>
      <StaffReversalCards api={commerce} merchantId={merchantId} styles={reversalStyles} refreshSignal={reversalRefresh} selectedVisit={selectedVisit} onVisitPreselected={showPreselectedVisit} />
    </View>

    <View style={{ gap: 12, padding: 18, borderRadius: 20, backgroundColor: colors.surface }}>
      <Text accessibilityRole="header" style={{ color: colors.label, fontSize: 18, fontWeight: '900' }}>손님 의견</Text>
      {feedbackLoading && !feedback ? <ActivityIndicator accessibilityLabel="손님 의견 불러오는 중" color={colors.primary} /> : null}
      {feedbackError ? <Retry label="손님 의견을 불러오지 못했어요. 다시 시도" onPress={() => void loadFeedback()} color={colors.primary} disabled={feedbackLoading} /> : null}
      {sections?.empty ? <Text style={{ color: colors.secondaryLabel }}>아직 받은 의견이 없어요</Text> : null}
      {sections && !sections.empty ? <>
        <Text style={{ color: colors.label, fontSize: 15, fontWeight: '800' }}>가게 특징</Text>
        {sections.tags.length ? sections.tags.map((item) => <Text key={item.label} selectable style={{ color: colors.secondaryLabel }}>{item.label} · {item.count}명</Text>) : <Text style={{ color: colors.secondaryLabel }}>선택된 특징이 없어요</Text>}
        <Text style={{ color: colors.label, fontSize: 15, fontWeight: '800' }}>사장님께 바라는 점</Text>
        {sections.suggestions.length ? sections.suggestions.map((item) => <Text key={item.label} selectable style={{ color: colors.secondaryLabel }}>{item.label} · {item.count}명</Text>) : <Text style={{ color: colors.secondaryLabel }}>남긴 제안이 없어요</Text>}
        <Text style={{ color: colors.label, fontSize: 15, fontWeight: '800' }}>최근 의견</Text>
        {sections.notes.length ? sections.notes.map((note, index) => <View key={`${note.customerLabel}-${note.date}-${index}`} style={{ gap: 4, padding: 12, borderRadius: 12, backgroundColor: colors.background }}>
          <Text selectable style={{ color: colors.secondaryLabel, fontSize: 12 }}>{note.customerLabel} · {note.date}</Text>
          <Text selectable style={{ color: colors.label, lineHeight: 21 }}>{note.text}</Text>
        </View>) : <Text style={{ color: colors.secondaryLabel }}>남긴 글이 없어요</Text>}
      </> : null}
    </View>
  </ScrollView>;
}

function Retry({ label, onPress, color, disabled }: { label: string; onPress: () => void; color: string; disabled: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={{ minHeight: 48, justifyContent: 'center' }}>
    <Text accessibilityLiveRegion="polite" style={{ color, fontWeight: '800' }}>{label}</Text>
  </Pressable>;
}
