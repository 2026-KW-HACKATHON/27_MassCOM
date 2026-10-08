import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, RefreshControl, StyleSheet, Text, View, useColorScheme, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RegistrationAlbum } from '@/acquisition/registration-album';
import type { AccountCredential } from '@/auth/account-credential';
import { publicDataDemoStoreName } from '@/merchant/public-data-demo-store';
import { parseCollectibleArtwork } from '@/commerce/collectible-artwork';
import { getAppPackageId } from '@/config/app-identity';
import { useExperience } from '@/experience/use-experience';
import { FullScreenModal } from '@/gamification/full-screen-modal';
import { useMotionEnabled } from '@/motion/use-motion';
import { classifyTicketCoinAcquisition, type CoinAcquisitionStatus } from '@/shop/coin-acquisition';
import { CoinApiError, coinEntryLabel, createCoinApiClient, coinErrorMessage, sortCoinEntries, type CoinPool, type CoinShop, type OwnedCoin } from '@/shop/coin-api';
import { clearCoinPending, coinPendingKey, readCoinPending, writeCoinPending, type CoinPending } from '@/shop/coin-pending';
import { pendingFocusSnapshot } from '@/shop/pending-focus';
import { colorsForScheme } from '@/theme/palette';
import { BackHeader } from '@/ui/back-header';
import { FloatingCard } from '@/ui/floating-card';
import { Fold } from '@/ui/fold';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';
import { StateScene } from '@/ui/state-scene';

const gradeName = { BRONZE: '브론즈', SILVER: '실버', GOLD: '골드', PLATINUM: '프리즘' } as const;
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
  const motionEnabled = useMotionEnabled();
  const api = useMemo(() => createCoinApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const experience = useExperience(apiUrl, credential, onSessionInvalid);
  const pendingKey = useMemo(() => coinPendingKey(accountId, apiUrl, getAppPackageId() ?? 'app'), [accountId, apiUrl]);
  const ticketUseKey = `${pendingKey}:ticket-use`;
  const [shop, setShop] = useState<CoinShop>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<CoinPending>();
  const [message, setMessage] = useState<string>();
  const [result, setResult] = useState<OwnedCoin>();
  const [resultTicketId, setResultTicketId] = useState<string>();
  const [resultStatus, setResultStatus] = useState<CoinAcquisitionStatus>('owned');
  const [resultSourceLabel, setResultSourceLabel] = useState('가게 뽑기권');
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [settledRegistrationReceiptId, setSettledRegistrationReceiptId] = useState<string>();
  const [confirmTicket, setConfirmTicket] = useState<CoinShop['tickets'][number]>();
  const [pendingTicketId, setPendingTicketId] = useState<string>();
  const [now, setNow] = useState(() => Date.now());
  const current = useRef(true);
  const inFlight = useRef(false);
  const focusEpoch = useRef(0);
  const loadGeneration = useRef(0);
  const scrollView = useRef<ScrollView>(null);

  useEffect(() => {
    if (!confirmTicket && !result) return;
    const frame = requestAnimationFrame(() => scrollView.current?.scrollTo({ y: 0, animated: true }));
    return () => cancelAnimationFrame(frame);
  }, [confirmTicket, result]);

  useEffect(() => {
    const nextExpiry = shop?.tickets.filter((ticket) => ticket.status === 'UNUSED' && Date.parse(ticket.expiresAt) > now)
      .reduce((next, ticket) => Math.min(next, Date.parse(ticket.expiresAt)), Infinity);
    if (nextExpiry === undefined || !Number.isFinite(nextExpiry)) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, nextExpiry - Date.now()));
    return () => clearTimeout(timer);
  }, [shop, now]);

  const load = useCallback(async (showLoading = false) => {
    const generation = ++loadGeneration.current;
    if (showLoading) setLoading(true);
    try { const next = await api.getShop(); if (current.current && loadGeneration.current === generation) { setShop(next); setNow(Date.now()); } }
    catch (error) { if (current.current && loadGeneration.current === generation) setMessage(coinErrorMessage(error)); }
    finally { if (current.current && loadGeneration.current === generation) setLoading(false); }
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
      loadGeneration.current += 1;
      setLoading(false);
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
    const epoch = ++focusEpoch.current;
    current.current = true;
    if (!inFlight.current) setBusy(false);
    void load(true).then(async () => {
      await recover();
      const state = await pendingFocusSnapshot(() => AsyncStorage.getItem(ticketUseKey), () => inFlight.current);
      if (current.current && focusEpoch.current === epoch) {
        setPendingTicketId(state.pending);
        if (!state.busy) setBusy(false);
      }
    }).catch(() => { if (current.current && focusEpoch.current === epoch) setMessage('이전 뽑기권 사용 결과를 확인하지 못했어요. 다시 시도해 주세요.'); });
    return () => { current.current = false; focusEpoch.current += 1; };
  }, [load, recover, ticketUseKey]));

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
      loadGeneration.current += 1;
      setLoading(false);
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
    const epoch = focusEpoch.current;
    const stillCurrent = () => current.current && focusEpoch.current === epoch;
    inFlight.current = true; setBusy(true); setMessage(undefined);
    try {
      const ticket = shop?.tickets.find((item) => item.id === ticketId);
      const pool = shop?.pools.find((item) => item.id === ticket?.poolId);
      const sourceLabel = pool
        ? `${publicDataDemoStoreName(pool.merchantId, pool.merchantName)} · ${ticket?.eventName ?? pool.eventName}`
        : ticket ? `${publicDataDemoStoreName(ticket.merchantId, '가게 확인 필요')} · ${ticket.eventName}` : '가게 뽑기권';
      await AsyncStorage.setItem(ticketUseKey, ticketId);
      if (!stillCurrent()) return;
      setPendingTicketId(ticketId);
      const used = await api.useTicket(ticketId);
      if (!stillCurrent()) return;
      loadGeneration.current += 1;
      setLoading(false);
      setShop((old) => old && { ...old, pools: old.pools.map((pool) => pool.id === used.ticket.poolId ? { ...pool, entries: [] } : pool), tickets: old.tickets.map((ticket) => ticket.id === ticketId ? used.ticket : ticket) });
      setResultStatus(classifyTicketCoinAcquisition({ coin: used.coin, replayed: used.replayed }));
      setResultSourceLabel(sourceLabel);
      setResult(used.coin);
      setResultTicketId(used.ticket.id);
      // Keep the replay marker until this focus has received the authoritative result.
      await AsyncStorage.removeItem(ticketUseKey);
      if (stillCurrent()) setPendingTicketId(undefined);
      void load();
    } catch (error) {
      if (error instanceof CoinApiError && error.status >= 400 && error.status < 500) {
        await AsyncStorage.removeItem(ticketUseKey).catch(() => undefined);
        if (!stillCurrent()) return;
        setPendingTicketId(undefined); await load();
      }
      if (stillCurrent()) setMessage(coinErrorMessage(error));
    }
    // This shared lock also blocks a refocused screen; release it without exposing the stale result.
    finally { inFlight.current = false; if (current.current) setBusy(false); }
  }

  const resultReceiptId = result ? resultTicketId ?? `${result.publicationId}:${result.gradeId}` : undefined;
  const resultRegistrationStatus = resultReceiptId && settledRegistrationReceiptId === resultReceiptId ? 'owned' : resultStatus;

  return <SkyBackdrop><SkyScrollView ref={scrollView} header={<BackHeader title="가게 코인 뽑기권" />}
    contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} progressViewOffset={insets.top} onRefresh={() => {
      setRefreshing(true); void load().then(() => recover()).finally(() => { if (current.current) setRefreshing(false); });
    }} />}>
    <Text style={[styles.intro, { color: palette.secondaryLabel }]}>가게·이벤트·등급이 정해진 권리를 구매한 뒤, 사용해 코인을 받아요. 중복 코인은 수량으로 남아요.</Text>
    {shop ? <Text accessibilityRole="header" style={[styles.heading, { color: palette.label }]}>마일리지 {shop.mileage.balance.toLocaleString()}P</Text> : null}
    {message ? <Text accessibilityLiveRegion="polite" style={[styles.message, { color: palette.label, backgroundColor: palette.primaryContainer }]}>{message}</Text> : null}
    {pending ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => void recover()} style={[styles.button, { backgroundColor: palette.primaryContainer }]}>
      <Text style={[styles.buttonText, { color: palette.onPrimaryContainer }]}>이전 구매 결과 다시 확인</Text>
    </Pressable> : null}
    {pendingTicketId ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => void openCoinTicket(pendingTicketId)} style={[styles.button, { backgroundColor: palette.primaryContainer }]}>
      <Text style={[styles.buttonText, { color: palette.onPrimaryContainer }]}>이전 뽑기 결과 다시 확인</Text>
    </Pressable> : null}
    {result ? <FloatingCard style={styles.card}><Text accessibilityRole="header" style={[styles.heading, { color: palette.label }]}>코인을 받았어요</Text>
      {parseCollectibleArtwork(result.summary) ? <Image source={{ uri: parseCollectibleArtwork(result.summary)!.thumbnailDataUrl }}
        accessibilityLabel={`${result.name} 코인 그림`} style={styles.coinImage} resizeMode="contain" /> : null}
      <Text style={{ color: palette.label }}>{result.name} · 총 {result.quantity}개{resultStatus === 'new' ? ' · 신규' : resultStatus === 'duplicate' ? ' · 중복 수집' : ' · 확인됨'}</Text>
      <Text style={{ color: palette.secondaryLabel }}>{resultSourceLabel}</Text>
      <Text style={{ color: palette.secondaryLabel }}>방문 {result.visitQuantity}개 · 뽑기 {result.drawQuantity}개</Text>
      {resultTicketId ? <Pressable accessibilityRole="button" disabled={experience.saving} onPress={() => {
        void experience.save({ coinSource: { sourceKind: 'STORE_DRAW', sourceId: resultTicketId } }).then((saved) => {
          if (saved) setMessage('이 코인을 대표로 설정했어요.');
        });
      }} style={styles.link}>
        <Text style={{ color: palette.primary }}>{experience.saving ? '설정 중…' : '대표 코인으로 설정 ›'}</Text>
      </Pressable> : null}
      {experience.error ? <Text style={{ color: palette.error }}>{experience.error}</Text> : null}
      <Pressable accessibilityRole="button" onPress={() => setRegistrationOpen(true)} style={[styles.button, { backgroundColor: palette.primary }]}>
        <Text style={[styles.buttonText, { color: palette.onPrimary }]}>도감 등록 확인</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => { setResult(undefined); setRegistrationOpen(false); void load(); }} style={[styles.button, { backgroundColor: palette.primaryContainer }]}>
        <Text style={[styles.buttonText, { color: palette.onPrimaryContainer }]}>확인하고 다음으로</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => { setResult(undefined);
        router.push({ pathname: '/coin-collection', params: { publicationId: result.publicationId, gradeId: result.gradeId, receiptId: resultTicketId ?? '' } });
      }} style={styles.link}>
        <Text style={{ color: palette.primary }}>도감에서 보기 ›</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => { setResult(undefined);
        router.push(resultTicketId ? { pathname: '/studio', params: { sourceKind: 'STORE_DRAW', sourceId: resultTicketId } } : '/studio');
      }} style={styles.link}>
        <Text style={{ color: palette.primary }}>마이룸 전시하기 ›</Text>
      </Pressable>
    </FloatingCard> : null}
    {confirmTicket ? <FloatingCard style={styles.card}>
      <Text accessibilityRole="header" style={[styles.heading, { color: palette.label }]}>뽑기권을 사용할까요?</Text>
      <Text style={{ color: palette.label }}>{publicDataDemoStoreName(shop?.pools.find((pool) => pool.id === confirmTicket.poolId)?.merchantId, shop?.pools.find((pool) => pool.id === confirmTicket.poolId)?.merchantName ?? '가게')} · {confirmTicket.eventName}</Text>
      <Text style={{ color: palette.secondaryLabel }}>뽑기권 1장으로 새 코인을 받아요. 기존 보유 코인은 그대로 유지돼요.</Text>
      <View style={styles.confirmRow}>
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => setConfirmTicket(undefined)} style={[styles.confirmButton, { backgroundColor: palette.surface }]}><Text style={{ color: palette.label }}>취소</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => { const id = confirmTicket.id; setConfirmTicket(undefined); void openCoinTicket(id); }} style={[styles.confirmButton, { backgroundColor: palette.primary }]}><Text style={{ color: palette.onPrimary }}>{busy ? '처리 중…' : '1장 사용하기'}</Text></Pressable>
      </View>
    </FloatingCard> : null}
    {loading && !shop ? <StateScene kind="loading" title="가게 뽑기권을 확인하는 중" /> : null}
    {!loading && !shop ? <StateScene kind="error" title="가게 뽑기권을 불러오지 못했어요" body={message}
      action={{ label: '다시 불러오기', onPress: () => void load(true) }} /> : null}
    {shop ? <>
      <Text accessibilityRole="header" style={[styles.heading, { color: palette.label }]}>받은 뽑기권</Text>
      {shop.tickets.filter((ticket) => ticket.status === 'UNUSED' && Date.parse(ticket.expiresAt) > now).length === 0 ? <StateScene kind="empty" title="아직 사용할 뽑기권이 없어요" action={{ label: '가게 찾기', onPress: () => router.push('/search') }} /> :
        shop.tickets.filter((ticket) => ticket.status === 'UNUSED' && Date.parse(ticket.expiresAt) > now).map((ticket) => {
          const pool = shop.pools.find((candidate) => candidate.id === ticket.poolId);
          const merchantName = publicDataDemoStoreName(pool?.merchantId, pool?.merchantName ?? '가게 확인 필요');
          const canUse = Boolean(pool?.entries.length) && pool?.unavailableReason !== 'MEDIA_REMOVED' && Date.parse(ticket.expiresAt) > now;
          return <Fold key={ticket.id} title={`${merchantName} · ${ticket.eventName} · ${gradeName[ticket.grade]}`}
            summary={`사용 기한 ${dateText(ticket.expiresAt)} · 코인 확률 보기`}>
            <FloatingCard style={styles.card}>
              <Text style={{ color: palette.secondaryLabel }}>이 권리는 {merchantName}의 {gradeName[ticket.grade]} 풀에서 코인 한 개를 뽑아요.</Text>
              {pool?.remaining !== undefined ? <Text style={{ color: palette.secondaryLabel }}>현재 가게 공동 재고 {pool.remaining}개 · {pool.cycle}번째 회차</Text> : null}
              {pool ? <>
                {sortCoinEntries(pool.entries).map((entry) => <View key={`${entry.publicationId}:${entry.gradeId}`} style={styles.entryRow}>
                  {parseCollectibleArtwork(entry.summary) ? <Image source={{ uri: parseCollectibleArtwork(entry.summary)!.thumbnailDataUrl }}
                    accessibilityLabel={`${entry.name} 코인 그림`} style={styles.entryImage} resizeMode="contain" /> : null}
                  <Text style={{ color: palette.label, flex: 1 }}>{coinEntryLabel(entry)} · {(entry.probability * 100).toLocaleString('ko-KR', { maximumFractionDigits: 4 })}%{entry.remaining !== undefined ? ` · 남은 ${entry.remaining}개` : ''}</Text>
                </View>)}
                {pool.entries.length === 0 ? <Text style={{ color: palette.secondaryLabel }}>현재 확률을 확인하지 못했어요. 새로고침 후 사용해 주세요.</Text> : null}
              </> : <Text style={{ color: palette.error }}>이 티켓의 가게 정보를 확인하지 못했어요. 새로고침 후 사용해 주세요.</Text>}
              {pool?.unavailableReason === 'MEDIA_REMOVED' ? <Text style={{ color: palette.error }}>수집품 이미지가 내려가 이 티켓은 사용할 수 없어요.</Text> : null}
              <Pressable accessibilityRole="button" accessibilityLabel={`${merchantName} ${ticket.eventName} ${gradeName[ticket.grade]} 뽑기권 사용`}
                accessibilityState={{ disabled: busy || result !== undefined || Boolean(pendingTicketId) || !canUse }}
                disabled={busy || result !== undefined || Boolean(pendingTicketId) || !canUse}
                onPress={() => setConfirmTicket(ticket)} style={[styles.button, { backgroundColor: palette.primary }]}>
                <Text style={[styles.buttonText, { color: palette.onPrimary }]}>사용해 코인 뽑기</Text>
              </Pressable>
            </FloatingCard>
          </Fold>;
        })}
      {shop.tickets.some((ticket) => ticket.status !== 'UNUSED' || Date.parse(ticket.expiresAt) <= now) ?
        <Fold title="사용·만료된 뽑기권 기록">{shop.tickets.filter((ticket) => ticket.status !== 'UNUSED' || Date.parse(ticket.expiresAt) <= now)
          .map((ticket) => <Text key={ticket.id} style={{ color: palette.secondaryLabel }}>
            {ticket.eventName} · {gradeName[ticket.grade]} · {ticket.status === 'USED' ? '사용 완료' : '만료'} · {dateText(ticket.expiresAt)}
          </Text>)}</Fold> : null}
      <Text accessibilityRole="header" style={[styles.heading, { color: palette.label }]}>판매 중인 뽑기권</Text>
      {shop.pools.length === 0 ? <Text style={{ color: palette.secondaryLabel }}>현재 운영 중인 가게 뽑기권이 없어요. 실제 가게가 등록하면 여기서 확인할 수 있어요.</Text> :
        shop.pools.map((pool) => {
          const available = pool.status === 'ACTIVE' && !pool.unavailableReason && Date.parse(pool.purchaseStartsAt) <= now && Date.parse(pool.purchaseEndsAt) > now && pool.issuedCount < pool.issuanceCap;
          return <FloatingCard key={pool.id} style={styles.card}>
            <Text style={[styles.name, { color: palette.label }]}>{publicDataDemoStoreName(pool.merchantId, pool.merchantName)} · {pool.eventName}</Text>
            <Text style={{ color: palette.label }}>{gradeName[pool.grade]} · {pool.price.toLocaleString()}P</Text>
            <Text style={{ color: palette.secondaryLabel }}>구매 {dateText(pool.purchaseStartsAt)} ~ {dateText(pool.purchaseEndsAt)}</Text>
            <Text style={{ color: palette.secondaryLabel }}>구매 후 7일 안에 사용 · 1인 {pool.perAccountLimit}장 · 전체 {pool.issuanceCap}장</Text>
            <Text style={{ color: palette.secondaryLabel }}>코인별 현재 확률은 유효한 미사용 뽑기권을 보유한 동안 확인할 수 있어요.</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`${publicDataDemoStoreName(pool.merchantId, pool.merchantName)} ${pool.eventName} ${gradeName[pool.grade]} 뽑기권 구매`}
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
  </SkyScrollView>
    {result ? <FullScreenModal visible={registrationOpen} animationType={motionEnabled ? 'slide' : 'none'} onRequestClose={() => { if (resultReceiptId) setSettledRegistrationReceiptId(resultReceiptId); setRegistrationOpen(false); }}>
      <View style={[styles.modalRoot, { backgroundColor: palette.background, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16 }]}>
        <ScrollView contentContainerStyle={styles.modalContent}>
          <RegistrationAlbum
            receiptId={resultReceiptId ?? `${result.publicationId}:${result.gradeId}`}
            sourceLabel={resultSourceLabel}
            collectionLabel="코인 도감"
            items={[{
              id: `${result.publicationId}:${result.gradeId}`,
              name: result.name,
              kindLabel: '가게 코인',
              status: resultRegistrationStatus,
              detail: `${resultSourceLabel} · 총 ${result.quantity}개 · 방문 ${result.visitQuantity} · 뽑기 ${result.drawQuantity}`,
              artwork: parseCollectibleArtwork(result.summary)
                ? <Image source={{ uri: parseCollectibleArtwork(result.summary)!.thumbnailDataUrl }} accessibilityLabel={`${result.name} 코인 그림`} style={styles.albumArtwork} resizeMode="contain" />
                : <Text accessibilityLabel={`${result.name} 코인 그림`} style={styles.albumFallback}>🪙</Text>,
            }]}
            onDone={() => {
              if (resultReceiptId) setSettledRegistrationReceiptId(resultReceiptId);
              setRegistrationOpen(false); setResult(undefined);
              router.push({ pathname: '/coin-collection', params: { publicationId: result.publicationId, gradeId: result.gradeId, receiptId: resultTicketId ?? '' } });
            }}
            onOpenCollection={() => {
              if (resultReceiptId) setSettledRegistrationReceiptId(resultReceiptId);
              setRegistrationOpen(false); setResult(undefined);
              router.push({ pathname: '/coin-collection', params: { publicationId: result.publicationId, gradeId: result.gradeId, receiptId: resultTicketId ?? '' } });
            }}
          />
        </ScrollView>
      </View>
    </FullScreenModal> : null}
  </SkyBackdrop>;
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
  confirmRow: { flexDirection: 'row', gap: 10 }, confirmButton: { flex: 1, minHeight: 48, justifyContent: 'center', alignItems: 'center', borderRadius: 12 },
  modalRoot: { flex: 1 }, modalContent: { padding: 20, paddingBottom: 32 },
  albumArtwork: { width: 120, height: 120 }, albumFallback: { fontSize: 64, textAlign: 'center' },
});
