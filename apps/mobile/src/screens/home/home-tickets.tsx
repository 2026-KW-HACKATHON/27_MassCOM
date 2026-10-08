import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AccountCredential } from '@/auth/account-credential';
import { publicDataDemoStoreName } from '@/merchant/public-data-demo-store';
import { createCommerceApiClient, type CollectionSnapshot } from '@/commerce/commerce-api';
import { colorsForScheme } from '@/theme/palette';
import { worldForScheme } from '@/theme/world';
import { createStoreTicketApiClient, type StoreTicket } from '@/store-tickets/store-ticket-api';
import { useDrawMusic } from '@/sound/ui-sounds';
import { BackHeader } from '@/ui/back-header';
import { FloatingCard } from '@/ui/floating-card';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';
import { StateScene } from '@/ui/state-scene';
import { uiMetrics } from '@/theme/ui-metrics';
import { CollectibleReveal } from '../collection/collectible-reveal';
import { buildStoreSeries } from '../collection/store-series';

type TicketState =
  | { status: 'loading'; tickets: readonly StoreTicket[] }
  | { status: 'ready'; tickets: readonly StoreTicket[] }
  | { status: 'error'; tickets: readonly StoreTicket[]; message: string };

export function HomeTicketsScreen({ apiUrl, credential, onSessionInvalid }: {
  apiUrl: string;
  credential: AccountCredential;
  onSessionInvalid: () => Promise<void>;
}) {
  const router = useRouter();
  const scheme = useColorScheme();
  const palette = colorsForScheme(scheme);
  const world = worldForScheme(scheme);
  const styles = useMemo(() => makeStyles(palette, world), [palette, world]);
  const insets = useSafeAreaInsets();
  const ticketApi = useMemo(() => createStoreTicketApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const commerceApi = useMemo(() => createCommerceApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
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

  const series = useMemo(() => collection ? buildStoreSeries([], collection.collectibles) : [], [collection]);

  return <SkyBackdrop>
    <SkyScrollView
      header={<BackHeader title="받은 가게권" />}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void load(true); }} tintColor={palette.primary}
        colors={[palette.primary]} progressBackgroundColor={world.card} progressViewOffset={insets.top} />}
    >
      <View style={styles.section}>
        <FloatingCard onPress={() => router.push('/coin-shop')} accessibilityLabel="구매한 가게 코인 뽑기권 보기"
          accessibilityHint="구매하거나 선물받은 코인 뽑기권을 사용합니다">
          <Text style={styles.ticketName}>코인 뽑기권은 여기서 확인 ›</Text>
        </FloatingCard>
        <Text accessibilityRole="header" style={styles.heading}>열 수 있는 가게권 · {tickets.status === 'ready' ? `${tickets.tickets.length}장` : tickets.status === 'loading' ? '확인 중' : '조회 실패'}</Text>
        {tickets.status === 'loading' && tickets.tickets.length === 0 ? (
          <FloatingCard><StateScene kind="loading" title="가게권을 확인하는 중" /></FloatingCard>
        ) : tickets.tickets.length === 0 && tickets.status !== 'error' ? (
          <FloatingCard>
            <StateScene framed={false} kind="empty" title="아직 방문 보상 가게권이 없어요"
              body="방문 인증으로 1·3·5회 목표를 달성하면 열 수 있는 가게권이 나타나요."
              action={{ label: '방문 인증 열기', onPress: () => router.push('/claim') }} />
          </FloatingCard>
        ) : (
          tickets.tickets.map((ticket) => (
            <FloatingCard key={ticket.entitlementId} onPress={() => openTicket(ticket)}
              accessibilityLabel={`${publicDataDemoStoreName(ticket.merchantId, ticket.merchantName)} ${ticket.displayName} 가게권`}
              accessibilityHint="개봉 연출 보기" style={styles.ticketCard}>
              <View style={styles.ticketStub}><Text style={styles.ticketStubText}>{ticket.targetVisitCount}</Text></View>
              <View style={styles.ticketBody}>
                <Text style={styles.ticketName}>{publicDataDemoStoreName(ticket.merchantId, ticket.merchantName)}</Text>
                <Text style={styles.ticketMeta}>{ticket.targetVisitCount}회 목표 · {ticket.displayName}</Text>
                <Text style={styles.ticketHint}>가게권 열기 ›</Text>
              </View>
            </FloatingCard>
          ))
        )}
        {tickets.status === 'error' ? (
          <Pressable accessibilityRole="button" onPress={() => { void load(true); }} style={styles.inlineError}>
            <Text style={styles.inlineErrorText}>{tickets.message}</Text>
          </Pressable>
        ) : null}
        {ackError ? <Text accessibilityLiveRegion="polite" style={styles.inlineNotice}>{ackError}</Text> : null}
      </View>
    </SkyScrollView>
    {opening ? (
      <CollectibleReveal
        entitlementIds={[opening.entitlementId]}
        merchantId={opening.merchantId}
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
  </SkyBackdrop>;
}

const makeStyles = (palette: ReturnType<typeof colorsForScheme>, world: ReturnType<typeof worldForScheme>) => StyleSheet.create({
  section: { paddingHorizontal: uiMetrics.pageInset, gap: 12, paddingBottom: 20 },
  heading: { color: world.skyInk, fontSize: 20, lineHeight: 28, fontWeight: '900' },
  ticketCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: world.card },
  ticketStub: { width: 60, minHeight: 76, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.accentContainer, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.onAccentContainer },
  ticketStubText: { color: palette.onAccentContainer, fontSize: 28, fontWeight: '900' },
  ticketBody: { flex: 1, minWidth: 0, gap: 5 },
  ticketName: { color: world.cardInk, fontSize: 17, lineHeight: 24, fontWeight: '900' },
  ticketMeta: { color: world.cardInk, fontSize: 13, lineHeight: 19, fontWeight: '800' },
  ticketHint: { color: world.cardMuted, fontSize: 12, lineHeight: 18 },
  inlineError: { minHeight: uiMetrics.minTouch, justifyContent: 'center', padding: 12, borderRadius: 12, backgroundColor: palette.errorContainer },
  inlineErrorText: { color: palette.onErrorContainer, fontSize: 13, lineHeight: 19, fontWeight: '700' },
  inlineNotice: { color: palette.onPrimaryContainer, backgroundColor: palette.primaryContainer, padding: 12, borderRadius: 12, fontSize: 13, lineHeight: 19, fontWeight: '700' },
});
