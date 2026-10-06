import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useColorScheme, type TextStyle, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AccountCredential } from '@/auth/account-credential';
import { createBadgeApiClient, type BadgeApiClient, type BadgeBook, type OpenedReward } from '@/gamification/badge-api';
import { useExperience } from '@/experience/use-experience';
import { shouldRefreshBadgesQuietly } from '@/gamification/badge-refresh';
import { couponExpiryNotice } from '@/gamification/coupon-expiry';
import { HomeRewardCard } from '@/gamification/home-reward-card';
import { RewardReveal } from '@/gamification/reward-reveal';
import { useTabBarClearance } from '@/navigation/use-tab-bar-clearance';
import { createShopApiClient } from '@/shop/shop-api';
import { useShop } from '@/shop/use-shop';
import { useShopAvatarAppearance } from '@/shop/use-shop-avatar-art';
import { equippedClothingArt } from '@/shop/wardrobe';
import { createStoreTicketApiClient } from '@/store-tickets/store-ticket-api';
import { CompanionScene } from '@/studio/studio-scene';
import { colorsForScheme } from '@/theme/palette';
import { uiMetrics } from '@/theme/ui-metrics';
import { worldForScheme } from '@/theme/world';
import { AppHeader } from '@/ui/app-header';
import { BackHeader } from '@/ui/back-header';
import { FloatingCard } from '@/ui/floating-card';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';
import { StateScene } from '@/ui/state-scene';
import { StatusBarScrim, useStatusBarScrim } from '@/ui/status-bar-scrim';

type Props = {
  apiUrl: string;
  accountId: string;
  credential: AccountCredential;
  onSessionInvalid: () => Promise<void>;
};

type TicketCount = { status: 'loading' | 'error' } | { status: 'ready'; count: number };

export function HomeScreen({ apiUrl, credential, onSessionInvalid }: Props) {
  const palette = colorsForScheme(useColorScheme());
  const world = worldForScheme(useColorScheme());
  const styles = useMemo(() => StyleSheet.create(makeHomeStyles(palette, world)), [palette, world]);
  const insets = useSafeAreaInsets();
  const clearance = useTabBarClearance();
  const scrim = useStatusBarScrim();
  const experience = useExperience(apiUrl, credential, onSessionInvalid);
  const shopApi = useMemo(() => createShopApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const shop = useShop(shopApi);
  const refreshShop = shop.refreshQuietly;
  const ticketApi = useMemo(() => createStoreTicketApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const [ticketCount, setTicketCount] = useState<TicketCount>({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const generation = useRef(0);

  const loadTickets = useCallback(async (refresh = false, request = ++generation.current) => {
    if (refresh) setRefreshing(true);
    setTicketCount({ status: 'loading' });
    try {
      const tickets = await ticketApi.listStoreTickets();
      if (request === generation.current) setTicketCount({ status: 'ready', count: tickets.length });
    } catch {
      if (request === generation.current) setTicketCount({ status: 'error' });
    } finally {
      if (request === generation.current) setRefreshing(false);
    }
  }, [ticketApi]);

  useFocusEffect(useCallback(() => {
    const request = ++generation.current;
    void loadTickets(false, request);
    void refreshShop();
    return () => { if (request === generation.current) generation.current += 1; };
  }, [loadTickets, refreshShop]));

  const ticketLabel = ticketCount.status === 'ready' ? `${ticketCount.count}장` : ticketCount.status === 'loading' ? '확인 중' : '조회 실패';
  const mileageLabel = shop.status === 'ready' && shop.snapshot ? `${shop.snapshot.mileage.balance.toLocaleString('ko-KR')}P` : shop.status === 'loading' ? '확인 중' : '조회 실패';
  const companionLabel = shop.status === 'ready' && shop.snapshot ? `${shop.snapshot.items.filter((item) => item.owned).length}명` : shop.status === 'loading' ? '확인 중' : '조회 실패';

  return <SkyBackdrop>
    <ScrollView
      onScroll={scrim.onScroll}
      scrollEventThrottle={16}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void loadTickets(true); void shop.refreshQuietly(); void experience.refresh(); }}
        tintColor={palette.primary} colors={[palette.primary]} progressBackgroundColor={world.card} progressViewOffset={insets.top} />}
      contentContainerStyle={[styles.content, { paddingBottom: clearance }]}
    >
      <AppHeader title="홈" subtitle="오늘의 탐험" showFriendsEntry showMailEntry compact />
      <View style={styles.overview}>
        <View style={styles.overviewItem}><Text style={styles.overviewLabel}>가게권</Text><Text style={styles.overviewValue}>{ticketLabel}</Text></View>
        <View style={styles.overviewItem}><Text style={styles.overviewLabel}>마일리지</Text><Text style={styles.overviewValue}>{mileageLabel}</Text></View>
        <View style={styles.overviewItem}><Text style={styles.overviewLabel}>보유 동행</Text><Text style={styles.overviewValue}>{companionLabel}</Text></View>
      </View>
      <View style={styles.actionGrid}>
        <Link href="/claim" asChild>
          <Pressable accessibilityRole="button" style={StyleSheet.flatten([styles.actionTile, { backgroundColor: palette.primary }])}>
            <Text style={[styles.actionTitle, { color: palette.onPrimary }]}>방문 QR</Text>
            <Text style={[styles.actionBody, { color: palette.onPrimary }]}>가게에서 도장 받기</Text>
          </Pressable>
        </Link>
        <Link href="/home/tickets" asChild>
          <Pressable accessibilityRole="button" style={StyleSheet.flatten([styles.actionTile, { backgroundColor: palette.primaryContainer }])}>
            <Text style={[styles.actionTitle, { color: palette.onPrimaryContainer }]}>받은 가게권</Text>
            <Text style={[styles.actionBody, { color: palette.onPrimaryContainer }]}>{ticketLabel} · 열어보기 ›</Text>
          </Pressable>
        </Link>
        <Link href="/home/missions" asChild>
          <Pressable accessibilityRole="button" style={StyleSheet.flatten([styles.actionTile, { backgroundColor: palette.primaryContainer }])}>
            <Text style={[styles.actionTitle, { color: palette.onPrimaryContainer }]}>미션</Text>
            <Text style={[styles.actionBody, { color: palette.onPrimaryContainer }]}>1·3·5회 방문 목표 ›</Text>
          </Pressable>
        </Link>
        <Link href="/home/exhibit" asChild>
          <Pressable accessibilityRole="button" style={StyleSheet.flatten([styles.actionTile, styles.exhibitTile])}>
            <View style={styles.exhibitRow}>
              <View style={styles.exhibitCopy}>
                <Text style={[styles.actionTitle, { color: palette.onPrimaryContainer }]}>나의 전시</Text>
                <Text style={[styles.actionBody, { color: palette.onPrimaryContainer }]}>동행·코인 꾸미기 ›</Text>
              </View>
              {shop.status === 'ready' && shop.snapshot ? <CompanionScene avatar={shop.snapshot.avatar} clothing={equippedClothingArt(shop.snapshot)}
                experienceProfile={experience.snapshot?.profile} size={64} /> : null}
            </View>
          </Pressable>
        </Link>
      </View>
      {experience.error ? <Text accessibilityLiveRegion="polite" style={styles.inlineNotice}>{experience.error}</Text> : null}
    </ScrollView>
    <StatusBarScrim scrollY={scrim.scrollY} />
  </SkyBackdrop>;
}

export function HomeMissionsScreen({ apiUrl, credential, onSessionInvalid }: Omit<Props, 'accountId'>) {
  const avatar = useShopAvatarAppearance(apiUrl, credential);
  const avatarArt = avatar?.art;
  const badgeApi = useMemo(
    () => createBadgeApiClient({ apiUrl, credential, onSessionInvalid }),
    [apiUrl, credential, onSessionInvalid],
  );
  return (
    <SkyBackdrop>
      <SkyScrollView header={<BackHeader title="미션" />}>
        <HomeMissionsPanel badgeApi={badgeApi} companionArt={avatarArt} />
      </SkyScrollView>
    </SkyBackdrop>
  );
}

function HomeMissionsPanel({ badgeApi, companionArt }: {
  badgeApi: BadgeApiClient;
  companionArt?: Parameters<typeof RewardReveal>[0]['companionArt'];
}) {
  const palette = colorsForScheme(useColorScheme());
  const world = worldForScheme(useColorScheme());
  const styles = useMemo(() => StyleSheet.create(makeHomeStyles(palette, world)), [palette, world]);
  const [book, setBook] = useState<BadgeBook>();
  const expiryNotice = couponExpiryNotice(book, new Date());
  const [error, setError] = useState<string>();
  const [revealed, setRevealed] = useState<OpenedReward>();

  const loadBook = useCallback(async () => {
    try {
      setBook(await badgeApi.getBadgeBook());
      setError(undefined);
    } catch {
      setError('미션 상자를 불러오지 못했어요.');
    }
  }, [badgeApi]);

  useFocusEffect(useCallback(() => {
    void loadBook();
  }, [loadBook]));

  const onOpenFailed = useCallback((code: string | undefined) => {
    if (shouldRefreshBadgesQuietly(code)) void loadBook();
  }, [loadBook]);
  const onRevealed = useCallback((result: OpenedReward) => {
    setRevealed(result);
    void loadBook();
  }, [loadBook]);

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>미션</Text>
      </View>
      <FloatingCard>
        <View style={styles.goalRow}>
          {[1, 3, 5].map((count) => (
            <View key={count} style={styles.goalPill}>
              <Text style={styles.goalNumber}>{count}</Text>
              <Text style={styles.goalLabel}>회 방문</Text>
            </View>
          ))}
        </View>
        {book ? (
          <>
            {expiryNotice ? (
              <Text accessibilityLiveRegion="polite" style={styles.couponNotice}>{expiryNotice}</Text>
            ) : null}
            <HomeRewardCard book={book} onOpen={badgeApi.openReward} onRevealed={onRevealed} onOpenFailed={onOpenFailed} />
          </>
        ) : error ? (
          <Pressable accessibilityRole="button" onPress={() => { void loadBook(); }} style={styles.inlineError}>
            <Text style={styles.inlineErrorText}>{error} 눌러서 다시 시도</Text>
          </Pressable>
        ) : (
          <StateScene kind="loading" title="미션 상자를 확인하는 중" />
        )}
      </FloatingCard>
      <RewardReveal
        result={revealed}
        companionArt={companionArt}
        onClose={() => setRevealed(undefined)}
        onUse={() => setRevealed(undefined)}
      />
    </View>
  );
}

function makeHomeStyles(palette: ReturnType<typeof colorsForScheme>, world: ReturnType<typeof worldForScheme>) {
  return {
    content: { flexGrow: 1 },
    section: { paddingHorizontal: uiMetrics.pageInset, gap: 12, marginBottom: 18 },
    overview: { marginHorizontal: uiMetrics.pageInset, marginBottom: 12, padding: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 8, borderRadius: 14, borderWidth: 1, borderColor: palette.separator, backgroundColor: world.card },
    overviewItem: { flexGrow: 1, flexBasis: 88, minHeight: uiMetrics.minTouch, justifyContent: 'center', gap: 2 },
    overviewLabel: { color: world.cardMuted, fontSize: 12, fontWeight: '700' },
    overviewValue: { color: world.cardInk, fontSize: 17, fontWeight: '900' },
    actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: uiMetrics.pageInset, marginBottom: 18 },
    actionTile: { flexGrow: 1, flexBasis: 140, minHeight: 98, borderRadius: 16, padding: 14, justifyContent: 'center', gap: 5 },
    exhibitTile: { backgroundColor: palette.primaryContainer },
    exhibitRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    exhibitCopy: { flex: 1, minWidth: 0, gap: 5 },
    actionTitle: { fontSize: 16, lineHeight: 23, fontWeight: '900' },
    actionBody: { fontSize: 12, lineHeight: 18, fontWeight: '700' },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    sectionTitle: { color: world.skyInk, fontSize: 20, lineHeight: 28, fontWeight: '900' },
    inlineError: { minHeight: uiMetrics.minTouch, justifyContent: 'center', padding: 12, borderRadius: 12, backgroundColor: palette.errorContainer },
    inlineErrorText: { color: palette.onErrorContainer, fontSize: 13, lineHeight: 19, fontWeight: '700' },
    inlineNotice: { color: palette.onPrimaryContainer, backgroundColor: palette.primaryContainer, padding: 12, borderRadius: 12, fontSize: 13, lineHeight: 19, fontWeight: '700', marginHorizontal: uiMetrics.pageInset },
    couponNotice: { color: palette.onAccentContainer, backgroundColor: palette.accentContainer, padding: 12, borderRadius: 12, fontSize: 13, lineHeight: 19, fontWeight: '800' },
    goalRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
    goalPill: { flex: 1, alignItems: 'center', gap: 3, paddingVertical: 10, borderRadius: 12, backgroundColor: palette.primaryContainer },
    goalNumber: { color: palette.onPrimaryContainer, fontSize: 18, lineHeight: 24, fontWeight: '900' },
    goalLabel: { color: palette.onPrimaryContainer, fontSize: 11, lineHeight: 15, fontWeight: '800' },
  } satisfies Record<string, TextStyle | ViewStyle>;
}
