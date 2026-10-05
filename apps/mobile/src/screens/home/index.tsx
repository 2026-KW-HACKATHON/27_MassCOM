import { Link, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useColorScheme, useWindowDimensions, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AccountCredential } from '@/auth/account-credential';
import { createCommerceApiClient, type CollectionSnapshot } from '@/commerce/commerce-api';
import { createBadgeApiClient, type BadgeApiClient, type BadgeBook, type OpenedReward } from '@/gamification/badge-api';
import { shouldRefreshBadgesQuietly } from '@/gamification/badge-refresh';
import { couponExpiryNotice } from '@/gamification/coupon-expiry';
import { HomeRewardCard } from '@/gamification/home-reward-card';
import { RewardReveal } from '@/gamification/reward-reveal';
import { useTabBarClearance } from '@/navigation/use-tab-bar-clearance';
import { useShopAvatarAppearance } from '@/shop/use-shop-avatar-art';
import { createStoreTicketApiClient, type StoreTicket } from '@/store-tickets/store-ticket-api';
import { useDrawMusic } from '@/sound/ui-sounds';
import { colorsForScheme } from '@/theme/palette';
import { uiMetrics } from '@/theme/ui-metrics';
import { worldForScheme } from '@/theme/world';
import { AppHeader } from '@/ui/app-header';
import { FloatingCard } from '@/ui/floating-card';
import { Companion } from '@/ui/companion';
import { heroMascotSize } from '@/ui/large-text';
import { Mascot } from '@/ui/mascot';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { StateScene } from '@/ui/state-scene';
import { StatusBarScrim, useStatusBarScrim } from '@/ui/status-bar-scrim';

import { CollectibleReveal } from '../collection/collectible-reveal';
import { buildStoreSeries } from '../collection/store-series';

type Props = {
  apiUrl: string;
  accountId: string;
  credential: AccountCredential;
  onSessionInvalid: () => Promise<void>;
};

type TicketState =
  | { status: 'loading'; tickets: readonly StoreTicket[] }
  | { status: 'ready'; tickets: readonly StoreTicket[] }
  | { status: 'error'; tickets: readonly StoreTicket[]; message: string };

export function HomeScreen({ apiUrl, accountId, credential, onSessionInvalid }: Props) {
  const scheme = useColorScheme();
  const palette = colorsForScheme(scheme);
  const world = worldForScheme(scheme);
  const styles = useMemo(() => StyleSheet.create(makeHomeStyles(palette, world, StyleSheet.hairlineWidth)), [palette, world]);
  const insets = useSafeAreaInsets();
  const clearance = useTabBarClearance();
  const scrim = useStatusBarScrim();
  const { fontScale } = useWindowDimensions();
  const router = useRouter();
  const [avatarRefreshToken, setAvatarRefreshToken] = useState(0);
  const avatar = useShopAvatarAppearance(apiUrl, credential, avatarRefreshToken);
  const avatarArt = avatar?.art;
  const avatarClothing = avatar?.clothing ?? null;
  const ticketApi = useMemo(
    () => createStoreTicketApiClient({ apiUrl, credential, onSessionInvalid }),
    [apiUrl, credential, onSessionInvalid],
  );
  const commerceApi = useMemo(
    () => createCommerceApiClient({ apiUrl, credential, onSessionInvalid }),
    [apiUrl, credential, onSessionInvalid],
  );
  const badgeApi = useMemo(
    () => createBadgeApiClient({ apiUrl, credential, onSessionInvalid }),
    [apiUrl, credential, onSessionInvalid],
  );
  const [tickets, setTickets] = useState<TicketState>({ status: 'loading', tickets: [] });
  const [collection, setCollection] = useState<CollectionSnapshot>();
  const [refreshing, setRefreshing] = useState(false);
  const [opening, setOpening] = useState<StoreTicket>();
  const [ackError, setAckError] = useState<string>();
  const acknowledged = useRef(new Set<string>());
  const loadGeneration = useRef(0);
  useDrawMusic(opening !== undefined);

  const load = useCallback(async (refresh = false, generation = ++loadGeneration.current) => {
    if (refresh) setRefreshing(true);
    else setTickets((current) => ({ status: 'loading', tickets: current.tickets }));
    setAckError(undefined);
    try {
      const [nextTickets, nextCollection] = await Promise.all([
        ticketApi.listStoreTickets(),
        commerceApi.getCollection().catch(() => undefined),
      ]);
      if (generation !== loadGeneration.current) return;
      setTickets({ status: 'ready', tickets: nextTickets });
      if (nextCollection) setCollection(nextCollection);
    } catch {
      if (generation !== loadGeneration.current) return;
      setTickets((current) => ({ status: 'error', tickets: current.tickets, message: '가게권을 불러오지 못했어요. 다시 시도해 주세요.' }));
    } finally {
      if (generation === loadGeneration.current) setRefreshing(false);
    }
  }, [commerceApi, ticketApi]);

  useFocusEffect(useCallback(() => {
    const generation = ++loadGeneration.current;
    void load(false, generation);
    return () => {
      if (generation === loadGeneration.current) loadGeneration.current += 1;
    };
  }, [load]));

  const openTicket = useCallback((ticket: StoreTicket) => {
    acknowledged.current.delete(ticket.entitlementId);
    setAckError(undefined);
    setOpening(ticket);
  }, []);

  const acknowledgeShownTicket = useCallback((entitlementId: string) => {
    if (acknowledged.current.has(entitlementId)) return;
    acknowledged.current.add(entitlementId);
    void ticketApi.openStoreTicket(entitlementId)
      .then(() => {
        setTickets((current) => {
          const remaining = current.tickets.filter((ticket) => ticket.entitlementId !== entitlementId);
          return current.status === 'error'
            ? { status: 'error', tickets: remaining, message: current.message }
            : { status: 'ready', tickets: remaining };
        });
        void load(true);
      })
      .catch(() => {
        acknowledged.current.delete(entitlementId);
        setAckError('가게권 개봉 확인을 저장하지 못했어요. 같은 가게권을 다시 열면 이어서 저장합니다.');
      });
  }, [load, ticketApi]);

  const series = useMemo(() => {
    if (!collection) return [];
    return buildStoreSeries([], collection.collectibles);
  }, [collection]);

  return (
    <SkyBackdrop>
      <ScrollView
        onScroll={scrim.onScroll}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setAvatarRefreshToken((value) => value + 1); void load(true); }}
            tintColor={palette.primary}
            colors={[palette.primary]}
            progressBackgroundColor={world.card}
            progressViewOffset={insets.top}
          />
        }
        contentContainerStyle={[styles.content, { paddingBottom: clearance }]}
      >
        <AppHeader title="홈" subtitle="오늘 받은 가게권과 미션을 확인해요" avatarArt={avatarArt} avatarClothing={avatarClothing} showMailEntry>
          <View style={styles.heroRow}>
            <View style={styles.heroText}>
              <Text style={styles.heroTitle}>가게권을 열어 오늘의 도장을 확인해요</Text>
              <Text style={styles.heroBody}>방문해서 받은 가게권을 여기서 바로 열 수 있어요.</Text>
            </View>
            {avatarArt ? <Companion art={avatarArt} clothing={avatarClothing} interactive size={heroMascotSize(fontScale, 96)} /> : <Mascot interactive pose="stamp" size={heroMascotSize(fontScale, 96)} />}
          </View>
        </AppHeader>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>가게권</Text>
            <Text accessibilityLiveRegion="polite" style={styles.sectionCount}>{tickets.tickets.length}장</Text>
          </View>
          {tickets.status === 'loading' && tickets.tickets.length === 0 ? (
            <FloatingCard><StateScene kind="loading" title="가게권을 확인하는 중" /></FloatingCard>
          ) : tickets.tickets.length === 0 ? (
            <FloatingCard>
              <StateScene
                framed={false}
                kind="empty"
                title="아직 가게 뽑기권이 없어요"
                body="방문 인증으로 1·3·5회 목표를 달성하면 이곳에 열 수 있는 가게권이 나타나요."
                action={{ label: '방문 인증 열기', onPress: () => router.push('/claim') }}
              />
            </FloatingCard>
          ) : (
            <View style={styles.ticketList}>
              {tickets.tickets.map((ticket) => (
                <FloatingCard
                  key={ticket.entitlementId}
                  onPress={() => openTicket(ticket)}
                  accessibilityLabel={`${ticket.merchantName} ${ticket.displayName} 가게권`}
                  accessibilityHint="개봉 연출 보기"
                  style={styles.ticketCard}
                >
                  <View style={styles.ticketStub}>
                    <Text style={styles.ticketStubText}>{ticket.targetVisitCount}</Text>
                  </View>
                  <View style={styles.ticketBody}>
                    <Text style={styles.ticketName}>{ticket.merchantName}</Text>
                    <Text style={styles.ticketMeta}>{ticket.targetVisitCount}회 목표 · {ticket.displayName}</Text>
                    <Text style={styles.ticketHint}>연출이 실제로 표시된 뒤 개봉으로 저장돼요.</Text>
                  </View>
                </FloatingCard>
              ))}
            </View>
          )}
          {tickets.status === 'error' ? (
            <Pressable accessibilityRole="button" onPress={() => { void load(true); }} style={styles.inlineError}>
              <Text style={styles.inlineErrorText}>{tickets.message}</Text>
            </Pressable>
          ) : null}
          {ackError ? <Text accessibilityLiveRegion="polite" style={styles.inlineNotice}>{ackError}</Text> : null}
        </View>

        <View style={styles.quickActions}>
          <Link href="/claim" asChild>
            <Pressable accessibilityRole="button" style={StyleSheet.flatten([styles.quickAction, { backgroundColor: palette.primary }])}>
              <Text style={[styles.quickActionTitle, { color: palette.onPrimary }]}>방문 QR</Text>
              <Text style={[styles.quickActionBody, { color: palette.onPrimary }]}>가게에서 도장 받기</Text>
            </Pressable>
          </Link>
          <Link href="/friends" asChild>
            <Pressable accessibilityRole="button" style={StyleSheet.flatten([styles.quickAction, { backgroundColor: palette.primaryContainer }])}>
              <Text style={[styles.quickActionTitle, { color: palette.onPrimaryContainer }]}>친구</Text>
              <Text style={[styles.quickActionBody, { color: palette.onPrimaryContainer }]}>우정과 초대 확인</Text>
            </Pressable>
          </Link>
        </View>

        <HomeMissionsPanel badgeApi={badgeApi} companionArt={avatarArt} onOpenMissions={() => router.push('/home/missions')} />
      </ScrollView>
      {opening ? (
        <CollectibleReveal
          entitlementIds={[opening.entitlementId]}
          merchantName={opening.merchantName}
          load={commerceApi.getCollectible}
          collectibles={collection?.collectibles ?? tickets.tickets}
          series={series}
          onSkip={() => setOpening(undefined)}
          onCardShown={acknowledgeShownTicket}
          onOpenDetail={(entitlementId) => {
            setOpening(undefined);
            router.push({ pathname: '/collection', params: { focus: 'collectible', entitlement: entitlementId } });
          }}
        />
      ) : null}
      <StatusBarScrim scrollY={scrim.scrollY} />
    </SkyBackdrop>
  );
}

export function HomeMissionsScreen({ apiUrl, credential, onSessionInvalid }: Omit<Props, 'accountId'>) {
  const avatar = useShopAvatarAppearance(apiUrl, credential);
  const avatarArt = avatar?.art;
  const avatarClothing = avatar?.clothing ?? null;
  const badgeApi = useMemo(
    () => createBadgeApiClient({ apiUrl, credential, onSessionInvalid }),
    [apiUrl, credential, onSessionInvalid],
  );
  const palette = colorsForScheme(useColorScheme());
  const world = worldForScheme(useColorScheme());
  const styles = useMemo(() => StyleSheet.create(makeHomeStyles(palette, world, StyleSheet.hairlineWidth)), [palette, world]);
  return (
    <SkyBackdrop>
      <ScrollView contentContainerStyle={styles.content}>
        <AppHeader title="미션" subtitle="1·3·5회 방문 목표와 상자를 확인해요" avatarArt={avatarArt} avatarClothing={avatarClothing} />
        <HomeMissionsPanel badgeApi={badgeApi} companionArt={avatarArt} />
      </ScrollView>
    </SkyBackdrop>
  );
}

function HomeMissionsPanel({ badgeApi, companionArt, onOpenMissions }: {
  badgeApi: BadgeApiClient;
  companionArt?: Parameters<typeof RewardReveal>[0]['companionArt'];
  onOpenMissions?: () => void;
}) {
  const palette = colorsForScheme(useColorScheme());
  const world = worldForScheme(useColorScheme());
  const styles = useMemo(() => StyleSheet.create(makeHomeStyles(palette, world, StyleSheet.hairlineWidth)), [palette, world]);
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
        {onOpenMissions ? (
          <Pressable accessibilityRole="button" onPress={onOpenMissions} style={styles.textButton}>
            <Text style={styles.textButtonText}>전체 보기</Text>
          </Pressable>
        ) : null}
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

function makeHomeStyles(palette: ReturnType<typeof colorsForScheme>, world: ReturnType<typeof worldForScheme>, hairlineWidth: number) {
  return {
    content: { flexGrow: 1 },
    heroRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    heroText: { flex: 1, minWidth: 180, gap: 6 },
    heroTitle: { color: world.skyInk, fontSize: 18, lineHeight: 25, fontWeight: '900' },
    heroBody: { color: world.skyMuted, fontSize: 13, lineHeight: 20, fontWeight: '700' },
    section: { paddingHorizontal: uiMetrics.pageInset, gap: 12, marginBottom: 18 },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    sectionTitle: { color: world.skyInk, fontSize: 20, lineHeight: 28, fontWeight: '900' },
    sectionCount: { color: world.skyMuted, fontSize: 13, fontWeight: '800' },
    ticketList: { gap: 12 },
    ticketCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: world.card },
    ticketStub: {
      width: 60, minHeight: 76, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
      backgroundColor: palette.accentContainer, borderWidth: hairlineWidth, borderColor: palette.onAccentContainer,
    },
    ticketStubText: { color: palette.onAccentContainer, fontSize: 28, fontWeight: '900' },
    ticketBody: { flex: 1, minWidth: 0, gap: 5 },
    ticketName: { color: world.cardInk, fontSize: 17, lineHeight: 24, fontWeight: '900' },
    ticketMeta: { color: world.cardInk, fontSize: 13, lineHeight: 19, fontWeight: '800' },
    ticketHint: { color: world.cardMuted, fontSize: 12, lineHeight: 18 },
    inlineError: { minHeight: uiMetrics.minTouch, justifyContent: 'center', padding: 12, borderRadius: 12, backgroundColor: palette.errorContainer },
    inlineErrorText: { color: palette.onErrorContainer, fontSize: 13, lineHeight: 19, fontWeight: '700' },
    inlineNotice: { color: palette.onPrimaryContainer, backgroundColor: palette.primaryContainer, padding: 12, borderRadius: 12, fontSize: 13, lineHeight: 19, fontWeight: '700' },
    couponNotice: { color: palette.onAccentContainer, backgroundColor: palette.accentContainer, padding: 12, borderRadius: 12, fontSize: 13, lineHeight: 19, fontWeight: '800' },
    quickActions: { flexDirection: 'row', gap: 12, paddingHorizontal: uiMetrics.pageInset, marginBottom: 18 },
    quickAction: { flex: 1, minHeight: 82, borderRadius: 16, padding: 14, justifyContent: 'center', gap: 5 },
    quickActionTitle: { fontSize: 16, lineHeight: 23, fontWeight: '900' },
    quickActionBody: { fontSize: 12, lineHeight: 18, fontWeight: '700' },
    textButton: { minHeight: uiMetrics.minTouch, justifyContent: 'center', paddingHorizontal: 8 },
    textButtonText: { color: palette.primary, fontSize: 13, fontWeight: '900' },
    goalRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
    goalPill: { flex: 1, alignItems: 'center', gap: 3, paddingVertical: 10, borderRadius: 12, backgroundColor: palette.primaryContainer },
    goalNumber: { color: palette.onPrimaryContainer, fontSize: 18, lineHeight: 24, fontWeight: '900' },
    goalLabel: { color: palette.onPrimaryContainer, fontSize: 11, lineHeight: 15, fontWeight: '800' },
  } satisfies Record<string, ImageStyle | TextStyle | ViewStyle>;
}
