import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useColorScheme, useWindowDimensions, type TextStyle, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { createCommerceApiClient, type CollectionSnapshot } from '@/commerce/commerce-api';
import { createMerchantApiClient, type PublicMerchant } from '@/merchant/merchant-api';
import { createCoinApiClient, type CoinShop } from '@/shop/coin-api';
import { createStudioApiClient, displayStudioItems, type StudioSnapshot } from '@/studio/studio-api';
import { StudioScene } from '@/studio/studio-scene';
import { homeVisitGoal } from './visit-goal';
import type { AccountCredential } from '@/auth/account-credential';
import { createBadgeApiClient, type BadgeApiClient, type BadgeBook, type OpenedReward } from '@/gamification/badge-api';
import { useExperience } from '@/experience/use-experience';
import { shouldRefreshBadgesQuietly } from '@/gamification/badge-refresh';
import { couponExpiryNotice } from '@/gamification/coupon-expiry';
import { HomeRewardCard } from '@/gamification/home-reward-card';
import { RewardReveal } from '@/gamification/reward-reveal';
import { useTabBarClearance } from '@/navigation/use-tab-bar-clearance';
import { TabGlyph } from '@/navigation/tab-glyph';
import { createShopApiClient } from '@/shop/shop-api';
import { useShop } from '@/shop/use-shop';
import { useShopAvatarAppearance } from '@/shop/use-shop-avatar-art';
import { equippedClothingArt } from '@/shop/wardrobe';
import { createStoreTicketApiClient } from '@/store-tickets/store-ticket-api';
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

type HomeData = { loadedAt: number; studio?: StudioSnapshot; coinShop?: CoinShop; collection?: CollectionSnapshot;
  merchants?: readonly PublicMerchant[]; rewardCount?: number; errors: string[] };

export function HomeScreen({ apiUrl, credential, onSessionInvalid }: Props) {
  const scheme = useColorScheme();
  const palette = colorsForScheme(scheme);
  const world = worldForScheme(scheme);
  const insets = useSafeAreaInsets();
  const { width, height: viewportHeight, fontScale } = useWindowDimensions();
  const compactHome = viewportHeight < 740 || fontScale >= 1.5;
  const sceneWidth = Math.min(width - 32, 500);
  const sceneHeight = sceneWidth * (compactHome ? .60 : .72);
  const clearance = useTabBarClearance();
  const scrim = useStatusBarScrim();
  const experience = useExperience(apiUrl, credential, onSessionInvalid);
  const shopApi = useMemo(() => createShopApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const shop = useShop(shopApi);
  const clients = useMemo(() => {
    const options = { apiUrl, credential, onSessionInvalid };
    return { studio: createStudioApiClient(options), coins: createCoinApiClient(options), rewards: createStoreTicketApiClient(options),
      collection: createCommerceApiClient(options), merchants: createMerchantApiClient(apiUrl) };
  }, [apiUrl, credential, onSessionInvalid]);
  const [loaded, setLoaded] = useState<{ clients: typeof clients; value: HomeData }>();
  const [refreshing, setRefreshing] = useState(false);
  const generation = useRef(0);
  const load = useCallback(async (refresh = false) => {
    const request = ++generation.current;
    if (refresh) setRefreshing(true);
    const results = await Promise.allSettled([clients.studio.getMine(), clients.coins.getShop(), clients.rewards.listStoreTickets(),
      clients.collection.getCollection(), clients.merchants.listMerchants()]);
    if (request !== generation.current) return;
    const [studio, coins, rewards, collection, merchants] = results;
    setLoaded({ clients, value: { loadedAt: Date.now(),
      ...(studio.status === 'fulfilled' ? { studio: studio.value } : {}),
      ...(coins.status === 'fulfilled' ? { coinShop: coins.value } : {}),
      ...(rewards.status === 'fulfilled' ? { rewardCount: rewards.value.length } : {}),
      ...(collection.status === 'fulfilled' ? { collection: collection.value } : {}),
      ...(merchants.status === 'fulfilled' ? { merchants: merchants.value } : {}),
      errors: results.flatMap((result, index) => result.status === 'rejected' ? [['마이룸', '뽑기권', '방문 보상', '도감', '가게'][index]!] : []),
    } }); setRefreshing(false);
  }, [clients]);
  useFocusEffect(useCallback(() => { void load(); return () => { generation.current++; }; }, [load]));
  const data = loaded?.clients === clients ? loaded.value : undefined;
  const ticketGroups = new Map<string, { name: string; count: number; grade: string }>();
  for (const ticket of data?.coinShop?.tickets ?? []) {
    if (ticket.status !== 'UNUSED' || Date.parse(ticket.expiresAt) <= (data?.loadedAt ?? 0)) continue;
    const pool = data?.coinShop?.pools.find((pool) => pool.id === ticket.poolId);
    const group = ticketGroups.get(ticket.merchantId);
    if (group) group.count++;
    else ticketGroups.set(ticket.merchantId, { name: pool?.merchantName ?? ticket.eventName, count: 1, grade: ticket.grade });
  }
  const goal = data?.collection && data.merchants ? homeVisitGoal(data.merchants, data.collection, data.loadedAt) : undefined;
  const heading = { color: world.cardInk, fontSize: 21, fontWeight: '800' as const };
  const body = { color: world.cardMuted, fontSize: 13, lineHeight: 19 };
  const quick = { flex: 1, minHeight: 66, borderRadius: 20, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 4, backgroundColor: world.card };
  return <SkyBackdrop>
    <ScrollView onScroll={scrim.onScroll} scrollEventThrottle={16}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void load(true); void shop.refreshQuietly(); void experience.refresh(); }}
        tintColor={palette.primary} colors={[palette.primary]} progressBackgroundColor={world.card} progressViewOffset={insets.top} />}
      contentContainerStyle={{ paddingBottom: clearance + 8 }}>
      <AppHeader title="홈" showFriendsEntry showMailEntry compact />
      <View style={{ width: '100%', maxWidth: 540, alignSelf: 'center', gap: 10, paddingHorizontal: 16 }}>
        {data?.collection?.visits.length === 0 ? <Link href="/search" asChild><Pressable accessibilityRole="button" accessibilityLabel="가게 찾기"
          style={{ minHeight: 56, borderRadius: 18, backgroundColor: palette.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <TabGlyph name="explore" color={palette.onPrimary} size={24} />
          <Text style={{ color: palette.onPrimary, fontWeight: '800', fontSize: 16 }}>가게 찾기</Text>
        </Pressable></Link> : null}
        {compactHome ? <View style={{ flexDirection: 'row', gap: 12 }}>
          <Link href="/friends" asChild><Pressable accessibilityRole="button" style={StyleSheet.flatten(quick)}><TabGlyph name="friends" color={palette.primary} size={27} /><Text style={{ color: world.cardInk, fontWeight: '800' }}>친구</Text></Pressable></Link>
          <Link href="/claim" asChild><Pressable accessibilityRole="button" style={StyleSheet.flatten(quick)}><TabGlyph name="claim" color={palette.primary} size={27} /><Text style={{ color: world.cardInk, fontWeight: '800' }}>방문 인증</Text></Pressable></Link>
        </View> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text accessibilityRole="header" style={heading}>마이룸</Text>
          <Link href="/studio" asChild><Pressable accessibilityRole="button" style={StyleSheet.flatten({ minHeight: 44, paddingHorizontal: 16, borderRadius: 22, justifyContent: 'center', backgroundColor: world.card })}>
            <Text style={{ color: palette.primary, fontWeight: '800' }}>꾸미기</Text>
          </Pressable></Link>
        </View>
        {data?.studio ? <View style={{ alignItems: 'center' }}><StudioScene studio={data.studio.studio} items={displayStudioItems(data.studio)}
          furnitureItems={data.studio.furnitureItems} avatar={data.studio.avatar} clothing={equippedClothingArt(shop.snapshot)} apiUrl={apiUrl}
          width={sceneWidth} height={sceneHeight} experienceProfile={experience.snapshot?.profile} /></View>
          : <View style={{ height: sceneHeight, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <Text style={body}>{data ? '마이룸을 불러오지 못했어요.' : '마이룸을 불러오고 있어요.'}</Text>
            {data ? <Pressable accessibilityRole="button" onPress={() => void load()} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={{ color: palette.primary }}>다시 불러오기</Text></Pressable> : null}
          </View>}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text accessibilityRole="header" style={heading}>보유 뽑기권</Text>
          <Link href="/coin-shop" asChild><Pressable accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: palette.primary, fontSize: 13 }}>모두 보기</Text></Pressable></Link>
        </View>
        {ticketGroups.size ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingBottom: 6 }}>
          {[...ticketGroups].map(([id, ticket]) => <Link key={id} href="/coin-shop" asChild><Pressable accessibilityRole="button"
            accessibilityLabel={`${ticket.name} 뽑기권 ${ticket.count}장`} style={{ backgroundColor: world.card, borderRadius: 20, width: 154, padding: 12, alignItems: 'center', gap: 6 }}>
            <Image source={ticket.grade === 'SILVER' ? require('../../../assets/images/shop/ticket-silver.png') : ticket.grade === 'GOLD' || ticket.grade === 'PLATINUM'
              ? require('../../../assets/images/shop/ticket-gold.png') : require('../../../assets/images/shop/ticket-bronze.png')}
              accessible={false} style={{ width: 122, height: 65 }} resizeMode="contain" />
            <Text style={{ color: world.cardInk, fontWeight: '800' }}>{ticket.name}</Text>
            <Text style={{ color: palette.primary, fontWeight: '800' }}>{ticket.count}장</Text>
          </Pressable></Link>)}
        </ScrollView> : <FloatingCard><Text style={body}>{data?.coinShop ? '아직 뽑기권이 없어요. 가게를 둘러보고 열려 있는 뽑기를 확인해 보세요.' : data ? '뽑기권을 불러오지 못했어요.' : '뽑기권 확인 중'}</Text></FloatingCard>}
        <Link href="/home/missions" asChild><Pressable accessibilityRole="button" style={StyleSheet.flatten({ backgroundColor: world.card, padding: 16, borderRadius: 20, gap: 10 })}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <View><Text style={{ ...heading, fontSize: 17 }}>방문 목표</Text><Text style={body}>{goal ? `${goal.name} · ${goal.count}회 방문` : goal === null ? '첫 가게에서 시작해 보세요' : '방문 목표 확인 중'}</Text></View>
            <View style={{ flexDirection: 'row', gap: 12 }}>{(goal?.goals ?? []).map((count) => <View key={count} style={{ alignItems: 'center', gap: 4 }}>
              <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: (goal?.count ?? 0) >= count ? palette.primary : palette.primaryContainer }}>
                <Text style={{ color: (goal?.count ?? 0) >= count ? palette.onPrimary : palette.primary, fontWeight: '800' }}>{(goal?.count ?? 0) >= count ? '✓' : count}</Text>
              </View><Text style={body}>{count}회</Text>
            </View>)}</View>
          </View>
          {goal ? <Text style={{ ...body, color: palette.primary }}>{goal.next ? `${goal.next - goal.count}회 더 방문하면 다음 보상 목표예요` : '이 가게의 방문 목표를 달성했어요'}</Text> : null}
        </Pressable></Link>
        {data?.rewardCount ? <Link href="/home/tickets" asChild><Pressable accessibilityRole="button" style={StyleSheet.flatten({ backgroundColor: palette.primaryContainer, padding: 12, minHeight: 48, borderRadius: 16, justifyContent: 'center' })}>
          <Text style={{ color: palette.onPrimaryContainer, fontWeight: '800' }}>도착한 방문 보상 {data.rewardCount}개 열기</Text>
        </Pressable></Link> : null}
        {!compactHome ? <View style={{ flexDirection: 'row', gap: 12 }}>
          <Link href="/friends" asChild><Pressable accessibilityRole="button" style={StyleSheet.flatten(quick)}><TabGlyph name="friends" color={palette.primary} size={27} /><Text style={{ color: world.cardInk, fontWeight: '800' }}>친구</Text></Pressable></Link>
          <Link href="/claim" asChild><Pressable accessibilityRole="button" style={StyleSheet.flatten(quick)}><TabGlyph name="claim" color={palette.primary} size={27} /><Text style={{ color: world.cardInk, fontWeight: '800' }}>방문 인증</Text></Pressable></Link>
        </View> : null}
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Link href="/home/exhibit" asChild><Pressable accessibilityRole="button" style={StyleSheet.flatten({ ...quick, minHeight: 48 })}><Text style={body}>동행·코인 전시</Text></Pressable></Link>
          <Link href="/room-explore" asChild><Pressable accessibilityRole="button" style={StyleSheet.flatten({ ...quick, minHeight: 48 })}><Text style={body}>가게 이웃 만나기</Text></Pressable></Link>
        </View>
        {data?.errors.length ? <Pressable accessibilityRole="button" onPress={() => void load()} style={{ minHeight: 48, justifyContent: 'center' }}>
          <Text accessibilityLiveRegion="polite" style={{ ...body, color: palette.error }}>{data.errors.join('·')} 조회 실패 · 다시 시도</Text>
        </Pressable> : null}
      </View>
    </ScrollView><StatusBarScrim scrollY={scrim.scrollY} />
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
  const scheme = useColorScheme();
  const palette = colorsForScheme(scheme);
  const world = worldForScheme(scheme);
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
    homeBody: { flexGrow: 1, justifyContent: 'center', paddingTop: 12, paddingBottom: 12 },
    section: { paddingHorizontal: uiMetrics.pageInset, gap: 12, marginBottom: 18 },
    overview: { marginHorizontal: uiMetrics.pageInset, marginBottom: 12, padding: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 8, borderRadius: 14, borderWidth: 1, borderColor: palette.separator, backgroundColor: world.card },
    overviewItem: { flexGrow: 1, flexBasis: 88, minHeight: uiMetrics.minTouch, justifyContent: 'center', gap: 2 },
    overviewLabel: { color: world.cardMuted, fontSize: 12, fontWeight: '700' },
    overviewValue: { color: world.cardInk, fontSize: 17, fontWeight: '900' },
    actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: uiMetrics.pageInset, marginBottom: 12 },
    actionTile: { flexGrow: 1, flexBasis: '46%', minWidth: 0, minHeight: 154, borderRadius: 16, padding: 14, justifyContent: 'center', gap: 5 },
    exhibitTile: { backgroundColor: palette.primaryContainer },
    exploreLink: { alignSelf: 'center', minHeight: uiMetrics.minTouch, justifyContent: 'center', paddingHorizontal: 18, borderRadius: 24, backgroundColor: world.card },
    exploreLinkText: { color: palette.primary, fontSize: 14, fontWeight: '800' },
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
