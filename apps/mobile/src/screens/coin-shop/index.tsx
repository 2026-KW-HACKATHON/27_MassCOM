import * as Crypto from 'expo-crypto';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Image, Pressable, RefreshControl, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AccountCredential } from '@/auth/account-credential';
import { parseCollectibleArtwork } from '@/commerce/collectible-artwork';
import { getAppPackageId } from '@/config/app-identity';
import { CoinApiError, coinProbabilityText, createCoinApiClient, coinErrorMessage, type CoinPool, type CoinShop, type OwnedCoin } from '@/shop/coin-api';
import { clearCoinPending, coinPendingKey, readCoinPending, writeCoinPending, type CoinPending } from '@/shop/coin-pending';
import { colorsForScheme } from '@/theme/palette';
import { BackHeader } from '@/ui/back-header';
import { FloatingCard } from '@/ui/floating-card';
import { Fold } from '@/ui/fold';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';
import { StateScene } from '@/ui/state-scene';

const gradeName = { BRONZE: '브론즈', SILVER: '실버', GOLD: '골드', PLATINUM: '플래티넘' } as const;
const dateText = (value: string) => new Date(value).toLocaleString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const rejectedPurchase = (error: unknown) => error instanceof CoinApiError && [
  'COIN_POOL_UNAVAILABLE', 'COIN_POOL_EXPIRED', 'COIN_POOL_LIMIT_REACHED', 'COIN_INSUFFICIENT_MILEAGE',
  'COIN_PUBLICATION_UNAVAILABLE', 'COIN_REQUEST_CONFLICT', 'INVALID_REQUEST',
].includes(error.code);

export function CoinShopScreen({ apiUrl, accountId, credential, onSessionInvalid }: {
  apiUrl: string; accountId: string; credential: AccountCredential; onSessionInvalid: () => Promise<void>;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const palette = colorsForScheme(useColorScheme());
  const api = useMemo(() => createCoinApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const pendingKey = useMemo(() => coinPendingKey(accountId, apiUrl, getAppPackageId() ?? 'app'), [accountId, apiUrl]);
  const [shop, setShop] = useState<CoinShop>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<CoinPending>();
  const [message, setMessage] = useState<string>();
  const [result, setResult] = useState<OwnedCoin>();
  const [now, setNow] = useState(() => Date.now());
  const current = useRef(true);
  const inFlight = useRef(false);

  const load = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try { const next = await api.getShop(); if (current.current) { setShop(next); setNow(Date.now()); } }
    catch (error) { if (current.current) setMessage(coinErrorMessage(error)); }
    finally { if (current.current) setLoading(false); }
  }, [api]);

  const recover = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const saved = await readCoinPending(pendingKey);
      if (!current.current) return;
      setPending(saved ?? undefined);
      if (!saved) return;
      const purchased = await api.purchase(saved.poolId, saved.requestId);
      if (!current.current) return;
      await clearCoinPending(pendingKey);
      if (!current.current) return;
      setPending(undefined);
      setMessage('가게 뽑기권 한 장을 받았어요. 사용하면 코인 한 개가 나와요.');
      setShop((old) => old && { ...old, mileage: { ...old.mileage, balance: purchased.balance },
        tickets: [purchased.ticket, ...old.tickets.filter((ticket) => ticket.id !== purchased.ticket.id)] });
      void load();
    } catch (error) {
      if (!current.current) return;
      if (rejectedPurchase(error)) { await clearCoinPending(pendingKey).catch(() => undefined); setPending(undefined); void load(); }
      setMessage(coinErrorMessage(error));
    }
    finally { inFlight.current = false; if (current.current) setBusy(false); }
  }, [api, load, pendingKey]);

  useFocusEffect(useCallback(() => {
    current.current = true;
    void load(true).then(() => recover());
    return () => { current.current = false; };
  }, [load, recover]));

  async function buy(pool: CoinPool) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage(undefined);
    try {
      const saved = await readCoinPending(pendingKey);
      if (!current.current) return;
      if (saved && saved.poolId !== pool.id) { setPending(saved); setMessage('이전 구매 결과부터 확인해 주세요.'); return; }
      const attempt = saved ?? { poolId: pool.id, requestId: Crypto.randomUUID() };
      if (!saved) await writeCoinPending(pendingKey, attempt);
      if (!current.current) return;
      setPending(attempt);
      const purchased = await api.purchase(attempt.poolId, attempt.requestId);
      if (!current.current) return;
      await clearCoinPending(pendingKey);
      if (!current.current) return;
      setPending(undefined);
      setShop((old) => old && { ...old, mileage: { ...old.mileage, balance: purchased.balance },
        tickets: [purchased.ticket, ...old.tickets.filter((ticket) => ticket.id !== purchased.ticket.id)] });
      setMessage('가게 뽑기권 한 장을 받았어요. 아래에서 사용할 수 있어요.');
      void load();
    } catch (error) {
      if (!current.current) return;
      if (rejectedPurchase(error)) { await clearCoinPending(pendingKey).catch(() => undefined); setPending(undefined); void load(); }
      setMessage(coinErrorMessage(error));
    }
    finally { inFlight.current = false; if (current.current) setBusy(false); }
  }

  async function openCoinTicket(ticketId: string) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage(undefined);
    try {
      const used = await api.useTicket(ticketId);
      if (!current.current) return;
      setShop((old) => old && { ...old, tickets: old.tickets.map((ticket) => ticket.id === ticketId ? used.ticket : ticket) });
      setResult(used.coin);
    } catch (error) { if (current.current) setMessage(coinErrorMessage(error)); }
    finally { inFlight.current = false; if (current.current) setBusy(false); }
  }

  return <SkyBackdrop><SkyScrollView header={<BackHeader title="가게 코인 뽑기권" />}
    contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} progressViewOffset={insets.top} onRefresh={() => {
      setRefreshing(true); void load().then(() => recover()).finally(() => { if (current.current) setRefreshing(false); });
    }} />}>
    <Text style={[styles.intro, { color: palette.secondaryLabel }]}>가게·이벤트·등급이 정해진 권리를 구매한 뒤, 사용해 코인을 받아요. 중복 코인은 수량으로 남아요.</Text>
    {shop ? <Text accessibilityRole="header" style={[styles.heading, { color: palette.label }]}>마일리지 {shop.mileage.balance.toLocaleString()}P</Text> : null}
    {message ? <Text accessibilityLiveRegion="polite" style={[styles.message, { color: palette.label, backgroundColor: palette.primaryContainer }]}>{message}</Text> : null}
    {pending ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => void recover()} style={[styles.button, { backgroundColor: palette.primaryContainer }]}>
      <Text style={[styles.buttonText, { color: palette.onPrimaryContainer }]}>이전 구매 결과 다시 확인</Text>
    </Pressable> : null}
    {result ? <FloatingCard style={styles.card}><Text accessibilityRole="header" style={[styles.heading, { color: palette.label }]}>코인을 받았어요</Text>
      {parseCollectibleArtwork(result.summary) ? <Image source={{ uri: parseCollectibleArtwork(result.summary)!.thumbnailDataUrl }}
        accessibilityLabel={`${result.name} 코인 그림`} style={styles.coinImage} resizeMode="contain" /> : null}
      <Text style={{ color: palette.label }}>{result.name} · 총 {result.quantity}개{result.quantity > 1 ? ' · 중복 수집' : ''}</Text>
      <Text style={{ color: palette.secondaryLabel }}>방문 {result.visitQuantity}개 · 뽑기 {result.drawQuantity}개</Text>
      <Pressable accessibilityRole="button" onPress={() => { setResult(undefined); void load(); }} style={[styles.button, { backgroundColor: palette.primary }]}>
        <Text style={[styles.buttonText, { color: palette.onPrimary }]}>확인하고 다음으로</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => { setResult(undefined); router.push('/coin-collection'); }} style={styles.link}>
        <Text style={{ color: palette.primary }}>시리즈 진척 보기 ›</Text>
      </Pressable>
    </FloatingCard> : null}
    {loading && !shop ? <StateScene kind="loading" title="가게 뽑기권을 확인하는 중" /> : null}
    {!loading && !shop ? <StateScene kind="error" title="가게 뽑기권을 불러오지 못했어요" body={message}
      action={{ label: '다시 불러오기', onPress: () => void load(true) }} /> : null}
    {shop ? <>
      <Text accessibilityRole="header" style={[styles.heading, { color: palette.label }]}>받은 뽑기권</Text>
      {shop.tickets.filter((ticket) => ticket.status === 'UNUSED').length === 0 ? <Text style={{ color: palette.secondaryLabel }}>아직 사용할 뽑기권이 없어요.</Text> :
        shop.tickets.filter((ticket) => ticket.status === 'UNUSED').map((ticket) => {
          const pool = shop.pools.find((candidate) => candidate.id === ticket.poolId);
          const totalWeight = pool?.entries.reduce((sum, item) => sum + item.weight, 0) ?? 0;
          const merchantName = pool?.merchantName ?? '가게 확인 필요';
          const canUse = Boolean(pool) && pool?.unavailableReason !== 'MEDIA_REMOVED' && Date.parse(ticket.expiresAt) > now;
          return <Fold key={ticket.id} title={`${merchantName} · ${ticket.eventName} · ${gradeName[ticket.grade]}`}
            summary={`사용 기한 ${dateText(ticket.expiresAt)} · 코인 확률 보기`}>
            <FloatingCard style={styles.card}>
              <Text style={{ color: palette.secondaryLabel }}>이 권리는 {merchantName}의 {gradeName[ticket.grade]} 풀에서 코인 한 개를 뽑아요.</Text>
              {pool ? <>
                {pool.entries.map((entry) => <View key={`${entry.publicationId}:${entry.gradeId}`} style={styles.entryRow}>
                  {parseCollectibleArtwork(entry.summary) ? <Image source={{ uri: parseCollectibleArtwork(entry.summary)!.thumbnailDataUrl }}
                    accessibilityLabel={`${entry.name} 코인 그림`} style={styles.entryImage} resizeMode="contain" /> : null}
                  <Text style={{ color: palette.label, flex: 1 }}>{entry.name} · {coinProbabilityText(entry.weight, totalWeight)}</Text>
                </View>)}
              </> : <Text style={{ color: palette.error }}>이 티켓의 가게 정보를 확인하지 못했어요. 새로고침 후 사용해 주세요.</Text>}
              {pool?.unavailableReason === 'MEDIA_REMOVED' ? <Text style={{ color: palette.error }}>수집품 이미지가 내려가 이 티켓은 사용할 수 없어요.</Text> : null}
              <Pressable accessibilityRole="button" accessibilityLabel={`${merchantName} ${ticket.eventName} ${gradeName[ticket.grade]} 뽑기권 사용`}
                accessibilityState={{ disabled: busy || result !== undefined || !canUse }}
                disabled={busy || result !== undefined || !canUse}
                onPress={() => void openCoinTicket(ticket.id)} style={[styles.button, { backgroundColor: palette.primary }]}>
                <Text style={[styles.buttonText, { color: palette.onPrimary }]}>사용해 코인 뽑기</Text>
              </Pressable>
            </FloatingCard>
          </Fold>;
        })}
      <Text accessibilityRole="header" style={[styles.heading, { color: palette.label }]}>판매 중인 뽑기권</Text>
      {shop.pools.length === 0 ? <Text style={{ color: palette.secondaryLabel }}>현재 운영 중인 가게 뽑기권이 없어요. 실제 가게가 등록하면 여기서 확인할 수 있어요.</Text> :
        shop.pools.map((pool) => {
          const totalWeight = pool.entries.reduce((sum, item) => sum + item.weight, 0);
          const available = pool.status === 'ACTIVE' && !pool.unavailableReason && Date.parse(pool.purchaseStartsAt) <= now && Date.parse(pool.purchaseEndsAt) > now && pool.issuedCount < pool.issuanceCap;
          return <FloatingCard key={pool.id} style={styles.card}>
            <Text style={[styles.name, { color: palette.label }]}>{pool.merchantName} · {pool.eventName}</Text>
            <Text style={{ color: palette.label }}>{gradeName[pool.grade]} · {pool.price.toLocaleString()}P</Text>
            <Text style={{ color: palette.secondaryLabel }}>구매 {dateText(pool.purchaseStartsAt)} ~ {dateText(pool.purchaseEndsAt)}</Text>
            <Text style={{ color: palette.secondaryLabel }}>사용 기한 {dateText(pool.useExpiresAt)} · 1인 {pool.perAccountLimit}장 · 전체 {pool.issuanceCap}장</Text>
            {pool.entries.map((entry) => <Text key={`${entry.publicationId}:${entry.gradeId}`} style={{ color: palette.secondaryLabel }}>
              {entry.name} · {coinProbabilityText(entry.weight, totalWeight)}
            </Text>)}
            <Pressable accessibilityRole="button" accessibilityLabel={`${pool.merchantName} ${pool.eventName} ${gradeName[pool.grade]} 뽑기권 구매`}
              accessibilityState={{ disabled: busy || Boolean(pending) || !available || shop.mileage.balance < pool.price }}
              disabled={busy || Boolean(pending) || !available || shop.mileage.balance < pool.price}
              onPress={() => void buy(pool)} style={[styles.button, { backgroundColor: palette.primary }]}>
              <Text style={[styles.buttonText, { color: palette.onPrimary }]}>뽑기권 1장 구매</Text>
            </Pressable>
            {!available || shop.mileage.balance < pool.price ? <Text style={{ color: palette.secondaryLabel }}>
              {pool.unavailableReason === 'MEDIA_REMOVED' ? '수집품 이미지가 내려가 신규 발급을 멈췄어요.'
                : pool.unavailableReason === 'PUBLICATION_UNAVAILABLE' ? '수집품 발행이 중단되어 신규 발급을 멈췄어요.'
                  : !available ? '지금은 구매할 수 없어요.' : '마일리지가 부족해요.'}</Text> : null}
          </FloatingCard>;
        })}
    </> : null}
    <Pressable accessibilityRole="button" onPress={() => router.push('/coin-collection')} style={styles.link}>
      <Text style={{ color: palette.primary }}>내 코인과 시리즈 보기 ›</Text>
    </Pressable>
  </SkyScrollView></SkyBackdrop>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 48, gap: 14 },
  intro: { fontSize: 14, lineHeight: 21 }, heading: { fontSize: 20, fontWeight: '800', marginTop: 6 },
  card: { padding: 16, gap: 8 }, name: { fontSize: 17, fontWeight: '800' },
  message: { padding: 12, borderRadius: 10, lineHeight: 20 },
  button: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12, marginTop: 6, paddingHorizontal: 12 },
  buttonText: { fontSize: 15, fontWeight: '800', textAlign: 'center' }, link: { minHeight: 48, justifyContent: 'center', alignItems: 'center' },
  coinImage: { width: 152, height: 152, alignSelf: 'center' }, entryRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  entryImage: { width: 52, height: 52 },
});
