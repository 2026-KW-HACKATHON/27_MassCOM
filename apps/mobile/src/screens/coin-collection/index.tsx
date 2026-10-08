import * as Crypto from 'expo-crypto';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, RefreshControl, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AccountCredential } from '@/auth/account-credential';
import { createCommerceApiClient } from '@/commerce/commerce-api';
import { parseCollectibleArtwork } from '@/commerce/collectible-artwork';
import { coinErrorMessage, createCoinApiClient, finalRerollFailure, maskRerollOdds, sameRerollOption, type CoinCollection, type CoinRerollOption, type CoinSource, type CoinSeries, type OwnedCoin, type SeriesTier } from '@/shop/coin-api';
import { clearCoinRerollPending, coinRerollPendingKey, readCoinRerollPending, startOrResumeCoinReroll, type CoinRerollPending } from '@/shop/coin-reroll-pending';
import { pendingFocusSnapshot } from '@/shop/pending-focus';
import { getAppPackageId } from '@/config/app-identity';
import { useExperience } from '@/experience/use-experience';
import { colorsForScheme } from '@/theme/palette';
import { BackHeader } from '@/ui/back-header';
import { FloatingCard } from '@/ui/floating-card';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';
import { StateScene } from '@/ui/state-scene';
import { CoinCouponUse } from './coupon-use';
import { CollectibleDetail } from '@/screens/collection/collectible-detail';

const rerollGradeName = { NORMAL: '일반', BRONZE: '브론즈', SILVER: '실버', GOLD: '골드' } as const;

export function coinCollectionDisplayState(coins: readonly Pick<OwnedCoin, 'quantity'>[], sources: readonly Pick<CoinSource, 'nftStatus'>[]) {
  const hasCoins = coins.some((coin) => coin.quantity > 0);
  const hasNftStatus = sources.some((source) => source.nftStatus === 'PENDING' || source.nftStatus === 'COMPLETED');
  return { showEmpty: !hasCoins && !hasNftStatus, showCollectionLink: hasCoins || hasNftStatus, showShopLink: hasCoins };
}

export function CoinCollectionScreen({ apiUrl, accountId, credential, onSessionInvalid }: {
  apiUrl: string; accountId: string; credential: AccountCredential; onSessionInvalid: () => Promise<void>;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const palette = colorsForScheme(useColorScheme());
  const api = useMemo(() => createCoinApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const experience = useExperience(apiUrl, credential, onSessionInvalid);
  const identityApi = useMemo(() => createCommerceApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const pendingKey = useMemo(() => coinRerollPendingKey(accountId, apiUrl, getAppPackageId() ?? 'app'), [accountId, apiUrl]);
  const [collection, setCollection] = useState<CoinCollection>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [usingCoupon, setUsingCoupon] = useState<CoinSeries>();
  const [coinDetail, setCoinDetail] = useState<{ publicationId: string; gradeId: string; merchantId: string; merchantName: string }>();
  const [selectedSource, setSelectedSource] = useState<CoinSource>();
  const [selectedOption, setSelectedOption] = useState<CoinRerollOption>();
  const [confirmReroll, setConfirmReroll] = useState(false);
  const [rerollPending, setRerollPending] = useState<CoinRerollPending>();
  const [rerollResult, setRerollResult] = useState<OwnedCoin>();
  const [rerollResultId, setRerollResultId] = useState<string>();
  const [rerollBefore, setRerollBefore] = useState<OwnedCoin>();
  const [filter, setFilter] = useState<'ALL' | 'ACTIVE' | 'COMPLETE'>('ALL');
  const [sort, setSort] = useState<'NAME' | 'PROGRESS'>('NAME');
  const current = useRef(true);
  const inFlight = useRef(false);
  const focusEpoch = useRef(0);
  const loadGeneration = useRef(0);

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    try { const value = await api.getCollection(); if (current.current && loadGeneration.current === generation) { setCollection({ ...value, reroll: { ...value.reroll,
      options: maskRerollOdds(value.reroll.options, Date.now()) } }); setMessage(undefined); } }
    catch (error) { if (current.current && loadGeneration.current === generation) setMessage(coinErrorMessage(error)); }
    finally { if (current.current && loadGeneration.current === generation) { setLoading(false); setRefreshing(false); } }
  }, [api]);
  const loadCoupon = useCallback(async () => {
    const generation = ++loadGeneration.current;
    const fresh = await api.getCollection();
    if (current.current && loadGeneration.current === generation) setCollection({ ...fresh, reroll: { ...fresh.reroll,
      options: maskRerollOdds(fresh.reroll.options, Date.now()) } });
    return fresh.series.find((series) => series.id === usingCoupon?.id);
  }, [api, usingCoupon?.id]);
  const loadCoinDetail = useCallback(() => api.getOwnedDetail(coinDetail!.publicationId, coinDetail!.gradeId),
    [api, coinDetail]);
  useEffect(() => {
    const nextExpiry = collection?.reroll.options.reduce((next, option) => option.entries.length && option.oddsExpiresAt
      ? Math.min(next, Date.parse(option.oddsExpiresAt)) : next, Infinity);
    if (nextExpiry === undefined || !Number.isFinite(nextExpiry)) return;
    const timer = setTimeout(() => {
      setCollection((old) => old && { ...old, reroll: { ...old.reroll,
        options: maskRerollOdds(old.reroll.options, Date.now()) } });
      setSelectedOption((old) => old && maskRerollOdds([old], Date.now())[0]);
      void load();
    }, Math.max(0, nextExpiry - Date.now()));
    return () => clearTimeout(timer);
  }, [collection, load]);
  useFocusEffect(useCallback(() => {
    const epoch = ++focusEpoch.current;
    current.current = true;
    setCollection((old) => old && { ...old, reroll: { ...old.reroll,
      options: maskRerollOdds(old.reroll.options, Date.now(), true) } });
    setSelectedOption((old) => old && maskRerollOdds([old], Date.now(), true)[0]);
    void load();
    if (!inFlight.current) setBusyId(undefined);
    void pendingFocusSnapshot(() => readCoinRerollPending(pendingKey), () => inFlight.current)
      .then(({ pending, busy }) => {
        if (!current.current || focusEpoch.current !== epoch) return;
        setRerollPending(pending);
        if (!busy) {
          setBusyId(undefined);
          if (!pending) setConfirmReroll(false);
        }
      })
      .catch(() => { if (current.current && focusEpoch.current === epoch) setMessage('이전 리롤 요청을 확인하지 못했어요. 다시 시도하지 말고 새로고침해 주세요.'); });
    return () => { current.current = false; focusEpoch.current += 1; };
  }, [load, pendingKey]));

  async function performReroll(saved?: CoinRerollPending) {
    if (inFlight.current) return;
    inFlight.current = true; setBusyId('reroll'); setMessage(undefined);
    try {
      const attempt = await startOrResumeCoinReroll(pendingKey, saved ? undefined : () => {
        const ticket = collection?.reroll.tickets.find((item) => item.status === 'UNUSED' && item.grade === selectedOption?.grade);
        return selectedSource && selectedOption && ticket
          ? { ticketId: ticket.id, source: selectedSource, poolId: selectedOption.poolId, requestId: Crypto.randomUUID() } : null;
      });
      if (!attempt) {
        if (saved) { setRerollPending(undefined); await load(); }
        return;
      }
      setRerollPending(attempt);
      const before = collection?.coins.find((coin) => coin.publicationId === attempt.source.publicationId && coin.gradeId === attempt.source.gradeId);
      setRerollBefore(before);
      const result = await api.reroll(attempt.ticketId, attempt.source, attempt.poolId, attempt.requestId);
      await clearCoinRerollPending(pendingKey);
      if (!current.current) return;
      setRerollPending(undefined); setRerollResult(result.coin); setRerollResultId(result.rerollId);
      setConfirmReroll(false); setSelectedSource(undefined); setSelectedOption(undefined);
      await load();
    } catch (error) {
      if (finalRerollFailure(error)) {
        await clearCoinRerollPending(pendingKey).catch(() => undefined);
        setRerollPending(undefined); setSelectedSource(undefined); setSelectedOption(undefined); setConfirmReroll(false);
        await load();
      } else setConfirmReroll(false);
      if (current.current) setMessage(coinErrorMessage(error));
    }
    finally { inFlight.current = false; if (current.current) setBusyId(undefined); }
  }

  const merchants = (collection?.catalog ?? []).filter((merchant) => {
    const count = merchant.types.flatMap((type) => type.grades).filter((grade) => grade.quantity > 0).length;
    const total = merchant.types.flatMap((type) => type.grades).length;
    return filter === 'ALL' || (filter === 'ACTIVE' ? count > 0 && count < total : total > 0 && count === total);
  }).sort((a, b) => sort === 'NAME' ? a.merchantName.localeCompare(b.merchantName, 'ko')
    : b.types.flatMap((type) => type.grades).filter((grade) => grade.quantity > 0).length
      - a.types.flatMap((type) => type.grades).filter((grade) => grade.quantity > 0).length);

  async function claim(seriesId: string) {
    if (inFlight.current) return;
    inFlight.current = true; setBusyId(seriesId); setMessage(undefined);
    try {
      const claimed = await api.claimSeries(seriesId);
      if (!current.current) return;
      setCollection((old) => old && { ...old, series: old.series.map((series) => series.id === seriesId ? claimed.series : series) });
      setMessage(claimed.series.coupon ? `${claimed.series.coupon.title} 쿠폰이 발급됐어요. 기한과 사용 조건을 확인해 주세요.` : '시리즈 결과를 확인했어요.');
    } catch (error) { if (current.current) setMessage(coinErrorMessage(error)); }
    finally { inFlight.current = false; if (current.current) setBusyId(undefined); }
  }

  const displayState = coinCollectionDisplayState(collection?.coins ?? [], collection?.reroll.sources ?? []);

  return <SkyBackdrop><SkyScrollView header={<BackHeader title="내 코인·시리즈" />}
    contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} progressViewOffset={insets.top} onRefresh={() => { setRefreshing(true); void load(); }} />}>
    <Text style={[styles.intro, { color: palette.secondaryLabel }]}>방문으로 얻은 코인과 뽑기로 얻은 코인을 함께 모아요. 쿠폰을 받아도 코인은 사라지지 않아요.</Text>
    {message ? <Text accessibilityLiveRegion="polite" style={[styles.message, { color: palette.label, backgroundColor: palette.primaryContainer }]}>{message}</Text> : null}
    {loading && !collection ? <StateScene kind="loading" title="코인 도감을 펼치는 중" /> : null}
    {!loading && !collection ? <StateScene kind="error" title="코인을 불러오지 못했어요" body={message}
      action={{ label: '다시 불러오기', onPress: () => { setLoading(true); void load(); } }} /> : null}
    {collection ? <>
      <Text accessibilityRole="header" style={[styles.heading, { color: palette.label }]}>가게별 도감</Text>
      <View style={styles.filterRow}>
        {(['ALL', 'ACTIVE', 'COMPLETE'] as const).map((value) => <Pressable key={value} accessibilityRole="button"
          accessibilityState={{ selected: filter === value }} onPress={() => setFilter(value)}
          style={[styles.filterButton, { backgroundColor: filter === value ? palette.primaryContainer : palette.surface }]}>
          <Text style={{ color: filter === value ? palette.onPrimaryContainer : palette.label }}>{value === 'ALL' ? '전체' : value === 'ACTIVE' ? '수집 중' : '완성'}</Text>
        </Pressable>)}
      </View>
      <Pressable accessibilityRole="button" onPress={() => setSort(sort === 'NAME' ? 'PROGRESS' : 'NAME')} style={styles.link}>
        <Text style={{ color: palette.primary }}>정렬: {sort === 'NAME' ? '가게 이름순' : '수집 등급순'} ▾</Text>
      </Pressable>
      {collection.catalog.length === 0 ? <Text style={{ color: palette.secondaryLabel }}>현재 공개된 코인 종류가 없어요. 가게가 코인을 발행하면 여기에 보여요.</Text> : null}
      {collection.catalog.length > 0 && merchants.length === 0 ? <Text style={{ color: palette.secondaryLabel }}>이 조건에 맞는 가게가 없어요.</Text> : null}
      {merchants.map((merchant) => {
        const grades = merchant.types.flatMap((type) => type.grades);
        const owned = grades.filter((grade) => grade.quantity > 0).length;
        return <FloatingCard key={merchant.merchantId} style={styles.card}>
          <Text accessibilityRole="header" style={[styles.name, { color: palette.label }]}>{merchant.merchantName} · {owned}/{grades.length}등급</Text>
          {merchant.types.map((type) => {
            const acquired = type.grades.filter((grade) => grade.quantity > 0).length;
            return <View key={type.publicationId} style={styles.tier}>
              <Text style={[styles.tierTitle, { color: palette.label }]}>{type.name} · 등급 수집 {acquired}/{type.grades.length}</Text>
              <View style={styles.gradeRow}>{type.grades.map((grade) => <View key={grade.gradeId} style={[styles.gradeCell,
                { backgroundColor: grade.quantity > 0 ? palette.primaryContainer : palette.surface }]}>
                {grade.quantity > 0 && parseCollectibleArtwork(grade.summary) ? <Image source={{ uri: parseCollectibleArtwork(grade.summary)!.thumbnailDataUrl }}
                  accessibilityLabel={`${grade.name} 코인`} style={styles.gradeImage} resizeMode="contain" /> : null}
                <Text style={{ color: palette.label, textAlign: 'center' }}>{grade.name}</Text>
                <Text style={{ color: palette.secondaryLabel, textAlign: 'center' }}>{grade.quantity > 0 ? `보유 ${grade.quantity}개` : '미보유'}</Text>
                {grade.quantity > 0 ? <Pressable accessibilityRole="button" onPress={() => setCoinDetail({ publicationId: grade.publicationId,
                  gradeId: grade.gradeId, merchantId: merchant.merchantId, merchantName: merchant.merchantName })} style={styles.link}>
                  <Text style={{ color: palette.primary, textAlign: 'center' }}>크게 보기 · 뒷면 · 3D ›</Text>
                </Pressable> : null}
                {grade.quantity > 0 ? <Text style={{ color: palette.secondaryLabel, textAlign: 'center' }}>
                  {[
                    ['VISIT', '방문'], ['STORE_DRAW', '가게권'], ['GRADE_DRAW', '등급 뽑기'], ['REROLL', '리롤'],
                  ].flatMap(([kind, label]) => {
                    const count = grade.sources.filter((source) => source.sourceKind === kind).length;
                    return count ? [`${label} ${count}`] : [];
                  }).join(' · ')}
                </Text> : null}
                {grade.quantity > 0 ? <Text style={{ color: palette.secondaryLabel, textAlign: 'center' }}>
                  {grade.sources.some((source) => source.nftStatus === 'COMPLETED') ? 'NFT 보유'
                    : grade.sources.some((source) => source.nftStatus === 'PENDING') ? 'NFT 발급 중'
                      : grade.sources.some((source) => source.rerollEligible) ? '리롤 가능' : '보유 중'}</Text> : null}
                {grade.sources[0] ? <Pressable accessibilityRole="button" disabled={experience.saving}
                  accessibilityLabel={`${grade.name} 대표 코인으로 설정`}
                  onPress={() => { const source = grade.sources[0]!;
                    void experience.save({ coinSource: { sourceKind: source.sourceKind, sourceId: source.sourceId } }).then((saved) => {
                      if (saved) setMessage('이 코인을 대표로 설정했어요.');
                    });
                  }} style={styles.link}>
                  <Text style={{ color: palette.primary, textAlign: 'center' }}>
                    {experience.snapshot?.profile.coinSource?.sourceKind === grade.sources[0].sourceKind
                      && experience.snapshot.profile.coinSource.sourceId === grade.sources[0].sourceId ? '대표 코인' : '대표 설정 ›'}
                  </Text>
                </Pressable> : null}
                {grade.sources[0] ? <Pressable accessibilityRole="button" onPress={() => {
                  const source = grade.sources[0]!;
                  router.push(source.sourceKind === 'VISIT'
                    ? { pathname: '/studio', params: { entitlement: source.sourceId } }
                    : { pathname: '/studio', params: { sourceKind: source.sourceKind, sourceId: source.sourceId } });
                }} style={styles.link}><Text style={{ color: palette.primary, textAlign: 'center' }}>마이룸 전시 ›</Text></Pressable> : null}
              </View>)}</View>
            </View>;
          })}
        </FloatingCard>;
      })}
      <Text accessibilityRole="header" style={[styles.heading, { color: palette.label }]}>내 코인 상세</Text>
      {displayState.showEmpty ? <StateScene kind="empty" title="아직 모은 코인이 없어요" action={{ label: '가게 찾기', onPress: () => router.push('/search') }} /> :
        collection.coins.map((coin) => <FloatingCard key={`${coin.publicationId}:${coin.gradeId}`} style={styles.card}>
          {parseCollectibleArtwork(coin.summary) ? <Image source={{ uri: parseCollectibleArtwork(coin.summary)!.thumbnailDataUrl }}
            accessibilityLabel={`${coin.name} 코인 그림`} style={styles.coinImage} resizeMode="contain" /> : null}
          <Text style={[styles.name, { color: palette.label }]}>{coin.name} ×{coin.quantity}</Text>
          <Text style={{ color: palette.secondaryLabel }}>방문 {coin.visitQuantity} · 뽑기 {coin.drawQuantity} · 리롤 {coin.rerollQuantity ?? 0}</Text>
        </FloatingCard>)}
      <Text accessibilityRole="header" style={[styles.heading, { color: palette.label }]}>코인 리롤</Text>
      <Text style={{ color: palette.secondaryLabel }}>기존 코인 1개를 회수하고 리롤권 1장을 사용해 같은 가게 풀에서 다시 뽑아요. 같은 코인이나 낮은 등급도 나올 수 있어요.</Text>
      <Text style={{ color: palette.secondaryLabel }}>NFT 받기를 완료하면 해당 코인은 회수하거나 리롤할 수 없어요. 발급이 진행 중일 때도 리롤은 잠시 잠겨요.</Text>
      <Text style={{ color: palette.label }}>{(['NORMAL', 'BRONZE', 'SILVER', 'GOLD'] as const).map((grade) =>
        `${rerollGradeName[grade]} ${collection.reroll.tickets.filter((ticket) => ticket.status === 'UNUSED' && ticket.grade === grade).length}장`).join(' · ')}</Text>
      {rerollPending ? <Pressable accessibilityRole="button" disabled={Boolean(busyId)} onPress={() => void performReroll(rerollPending)} style={[styles.button, { backgroundColor: palette.primary }]}>
        <Text style={[styles.buttonText, { color: palette.onPrimary }]}>이전 리롤 결과 다시 확인</Text>
      </Pressable> : null}
      {collection.reroll.tickets.filter((ticket) => ticket.status === 'UNUSED').length === 0 ?
        <Text style={{ color: palette.secondaryLabel }}>사용할 수 있는 리롤권이 없어요.</Text> : null}
      {collection.reroll.sources.filter((source) => source.rerollEligible).map((source) => {
        const coin = collection.coins.find((item) => item.publicationId === source.publicationId && item.gradeId === source.gradeId);
        const gradeName = collection.catalog.flatMap((merchant) => merchant.types).flatMap((type) => type.grades)
          .find((grade) => grade.publicationId === source.publicationId && grade.gradeId === source.gradeId)?.name;
        return <Pressable key={`${source.sourceKind}:${source.sourceId}`} accessibilityRole="button" disabled={Boolean(rerollPending)}
          accessibilityState={{ selected: selectedSource?.sourceId === source.sourceId }} onPress={() => { setSelectedSource(source); setSelectedOption(undefined); setConfirmReroll(false); }}
          style={[styles.sourceRow, { backgroundColor: selectedSource?.sourceId === source.sourceId ? palette.primaryContainer : palette.surface }]}>
          <Text style={{ color: palette.label }}>{coin?.name ?? '보유 코인'}{gradeName && gradeName !== coin?.name ? ` · ${gradeName}` : ''} · {source.sourceKind === 'VISIT' ? '방문' : source.sourceKind === 'REROLL' ? '리롤' : '뽑기'} 획득</Text>
        </Pressable>;
      })}
      {collection.reroll.sources.length > 0 && !collection.reroll.sources.some((source) => source.rerollEligible) ?
        <Text style={{ color: palette.secondaryLabel }}>현재 리롤할 수 있는 코인이 없어요. NFT 발급 중·완료 코인은 선택할 수 없어요.</Text> : null}
      {selectedSource ? <>
        <Text style={{ color: palette.label }}>사용할 리롤권과 가게 풀을 선택해 주세요.</Text>
        {!collection.reroll.options.some((option) => option.merchantId === selectedSource.merchantId &&
          collection.reroll.tickets.some((ticket) => ticket.status === 'UNUSED' && ticket.grade === option.grade)) ?
          <Text style={{ color: palette.secondaryLabel }}>이 가게에 지금 사용할 수 있는 리롤 풀과 권리가 없어요.</Text> : null}
        {collection.reroll.options.filter((option) => option.merchantId === selectedSource.merchantId &&
          collection.reroll.tickets.some((ticket) => ticket.status === 'UNUSED' && ticket.grade === option.grade)).map((option) =>
          <Pressable key={`${option.poolId}:${option.grade}`} accessibilityRole="button" accessibilityState={{ selected: sameRerollOption(selectedOption, option) }}
            onPress={() => { setSelectedOption(option); setConfirmReroll(false); }} style={[styles.sourceRow,
              { backgroundColor: sameRerollOption(selectedOption, option) ? palette.primaryContainer : palette.surface }]}>
            <Text style={{ color: palette.label }}>{rerollGradeName[option.grade]} 리롤권 · {option.eventName}</Text>
            <Text style={{ color: palette.secondaryLabel }}>{option.entries.length ? option.entries.map((entry) => `${entry.name} ${(entry.probability * 100).toLocaleString('ko-KR', { maximumFractionDigits: 4 })}%`).join(' · ')
              : '현재 확률은 해당 가게의 유효한 미사용 뽑기권 보유자에게만 공개돼요.'}</Text>
          </Pressable>)}
        {selectedOption && !confirmReroll ? <Pressable accessibilityRole="button" onPress={() => setConfirmReroll(true)} style={[styles.button, { backgroundColor: palette.primary }]}>
          <Text style={[styles.buttonText, { color: palette.onPrimary }]}>리롤 조건 확인</Text>
        </Pressable> : null}
        {selectedOption && confirmReroll ? <FloatingCard style={styles.card}>
          <Text accessibilityRole="header" style={[styles.name, { color: palette.label }]}>회수하고 다시 뽑을까요?</Text>
          <Text style={{ color: palette.secondaryLabel }}>선택한 코인 1개를 회수하고 {rerollGradeName[selectedOption.grade]} 리롤권 1장을 사용해요. 결과는 같거나 낮은 등급일 수 있어요.</Text>
          <Pressable accessibilityRole="button" disabled={Boolean(busyId) || Boolean(rerollPending)} onPress={() => void performReroll()} style={[styles.button, { backgroundColor: palette.primary }]}>
            <Text style={[styles.buttonText, { color: palette.onPrimary }]}>{busyId ? '처리 중…' : rerollPending ? '이전 결과를 먼저 확인해 주세요' : '회수하고 다시 뽑기'}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => setConfirmReroll(false)} style={styles.link}><Text style={{ color: palette.primary }}>취소</Text></Pressable>
        </FloatingCard> : null}
      </> : null}
      {rerollResult ? <FloatingCard style={styles.card}>
        <Text accessibilityRole="header" style={[styles.name, { color: palette.label }]}>새 코인을 획득했어요</Text>
        <View style={styles.gradeRow}>
          <View style={{ flex: 1, alignItems: 'center', gap: 5 }}>
            {rerollBefore && parseCollectibleArtwork(rerollBefore.summary) ? <Image source={{ uri: parseCollectibleArtwork(rerollBefore.summary)!.thumbnailDataUrl }}
              accessibilityLabel={`${rerollBefore.name} 회수한 코인`} style={styles.coinImage} resizeMode="contain" /> : null}
            <Text style={{ color: palette.secondaryLabel, textAlign: 'center' }}>회수 완료 · {rerollBefore?.name ?? '이전 코인'}</Text>
          </View>
          <Text style={{ color: palette.label, alignSelf: 'center' }}>→</Text>
          <View style={{ flex: 1, alignItems: 'center', gap: 5 }}>
            {parseCollectibleArtwork(rerollResult.summary) ? <Image source={{ uri: parseCollectibleArtwork(rerollResult.summary)!.thumbnailDataUrl }}
              accessibilityLabel={`${rerollResult.name} 새 코인`} style={styles.coinImage} resizeMode="contain" /> : null}
            <Text style={{ color: palette.label, textAlign: 'center' }}>획득 · {rerollResult.name}</Text>
          </View>
        </View>
        <Text style={{ color: palette.secondaryLabel }}>새 코인 보유 {rerollResult.quantity}개</Text>
        <Pressable accessibilityRole="button" onPress={() => setRerollResult(undefined)} style={styles.link}>
          <Text style={{ color: palette.primary }}>도감에서 보기 ›</Text>
        </Pressable>
        {rerollResultId ? <Pressable accessibilityRole="button" disabled={experience.saving} onPress={() => {
          void experience.save({ coinSource: { sourceKind: 'REROLL', sourceId: rerollResultId } }).then((saved) => {
            if (saved) setMessage('새 코인을 대표로 설정했어요.');
          });
        }} style={styles.link}><Text style={{ color: palette.primary }}>대표 코인으로 설정 ›</Text></Pressable> : null}
        <Pressable accessibilityRole="button" onPress={() => { setRerollResult(undefined);
          router.push(rerollResultId ? { pathname: '/studio', params: { sourceKind: 'REROLL', sourceId: rerollResultId } } : '/studio');
        }} style={styles.link}><Text style={{ color: palette.primary }}>마이룸 전시하기 ›</Text></Pressable>
      </FloatingCard> : null}
      {experience.error ? <Text style={{ color: palette.error }}>{experience.error}</Text> : null}
      {displayState.showCollectionLink ? <Pressable accessibilityRole="button" onPress={() => router.push('/(tabs)/collection')} style={styles.link}>
        <Text style={{ color: palette.primary }}>방문 수집품 NFT 발급·상태 확인 ›</Text>
      </Pressable> : null}
      <Text accessibilityRole="header" style={[styles.heading, { color: palette.label }]}>코인 시리즈</Text>
      {collection.series.length === 0 ? <Text style={{ color: palette.secondaryLabel }}>지금 진행 중인 시리즈가 없어요. 실제 가게의 쿠폰 조건이 정해지면 표시돼요.</Text> :
        collection.series.map((series) => <SeriesCard key={series.id} series={series} busy={Boolean(busyId)}
          onClaim={() => void claim(series.id)} onUse={() => setUsingCoupon(series)} palette={palette} />)}
      {displayState.showShopLink ? <Pressable accessibilityRole="button" onPress={() => router.push('/coin-shop')} style={styles.link}>
        <Text style={{ color: palette.primary }}>가게 뽑기권 보러 가기 ›</Text>
      </Pressable> : null}
    </> : null}
  </SkyScrollView>
    {coinDetail ? <CollectibleDetail key={`${coinDetail.publicationId}:${coinDetail.gradeId}`}
      entitlementId={`${coinDetail.publicationId}:${coinDetail.gradeId}`} merchantId={coinDetail.merchantId}
      merchantName={coinDetail.merchantName} load={loadCoinDetail} onClose={() => setCoinDetail(undefined)} onUnavailable={() => void load()} /> : null}
    {usingCoupon?.coupon ? <CoinCouponUse key={usingCoupon.coupon.id} series={usingCoupon}
      load={loadCoupon} createIdentity={identityApi.createCustomerIdentity} revokeIdentity={identityApi.revokeCustomerIdentity}
      onClose={() => { setUsingCoupon(undefined); void load(); }} /> : null}
  </SkyBackdrop>;
}

function Tier({ tier, palette }: { tier: SeriesTier; palette: ReturnType<typeof colorsForScheme> }) {
  return <View style={styles.tier}>
    <Text style={[styles.tierTitle, { color: palette.label }]}>{tier.title} · {tier.complete ? '완성' : '모으는 중'}</Text>
    <Text style={{ color: palette.secondaryLabel }}>{tier.detail}</Text>
    {tier.slots.map((slot) => <Text key={`${slot.publicationId}:${slot.gradeId}`} style={{ color: palette.secondaryLabel }}>
      {slot.name} · {slot.quantity > 0 ? '보유' : '미보유'} ({slot.quantity}개)
    </Text>)}
  </View>;
}

function SeriesCard({ series, busy, onClaim, onUse, palette }: { series: CoinSeries; busy: boolean; onClaim: () => void; onUse: () => void;
  palette: ReturnType<typeof colorsForScheme> }) {
  const [confirmingBaseFor, setConfirmingBaseFor] = useState<string>();
  const confirmingBase = confirmingBaseFor === series.id && series.claimable === 'BASE' && !series.coupon;
  return <FloatingCard style={styles.card}>
    <Text style={[styles.name, { color: palette.label }]}>{series.title} · {series.merchantName}</Text>
    <Text style={{ color: palette.secondaryLabel }}>진행 기한 {new Date(series.endsAt).toLocaleDateString('ko-KR')}</Text>
    <Tier tier={series.base} palette={palette} /><Tier tier={series.prism} palette={palette} />
    <Text style={{ color: palette.secondaryLabel }}>시리즈당 쿠폰 1회 · 기본 수령 후 프리즘으로 변경하거나 추가 발급할 수 없어요.</Text>
    {series.coupon ? <View style={[styles.coupon, { backgroundColor: palette.accentContainer }]}>
      <Text style={[styles.tierTitle, { color: palette.onAccentContainer }]}>{series.coupon.title} · {series.coupon.tier === 'PRISM' ? '프리즘' : '기본'}</Text>
      <Text style={{ color: palette.onAccentContainer }}>{series.coupon.detail}</Text>
      <Text style={{ color: palette.onAccentContainer }}>사용 기한 {new Date(series.coupon.expiresAt).toLocaleDateString('ko-KR')} · {series.coupon.status === 'ISSUED' ? '미사용' : series.coupon.status === 'REDEEMED' ? '사용 완료' : series.coupon.status === 'REVOKED' ? '방문 취소로 철회됨' : '만료'}</Text>
      {series.coupon.status === 'ISSUED' ? <Pressable accessibilityRole="button" onPress={onUse}
        style={[styles.button, { backgroundColor: palette.primary }]}>
        <Text style={[styles.buttonText, { color: palette.onPrimary }]}>매장에서 사용하기</Text>
      </Pressable> : null}
    </View> : null}
    {confirmingBase ? <View style={[styles.coupon, { backgroundColor: palette.primaryContainer }]}>
      <Text accessibilityRole="header" style={[styles.tierTitle, { color: palette.onPrimaryContainer }]}>기본 쿠폰을 지금 받을까요?</Text>
      <Text style={{ color: palette.onPrimaryContainer }}>이 시리즈는 한 번만 받을 수 있어요. 지금 기본 쿠폰을 받으면 이후 프리즘을 모아도 변경하거나 추가로 받을 수 없어요.</Text>
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy}
        onPress={() => setConfirmingBaseFor(undefined)} style={[styles.button, { backgroundColor: palette.surface }]}>
        <Text style={[styles.buttonText, { color: palette.label }]}>더 모으기</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy}
        onPress={onClaim} style={[styles.button, { backgroundColor: palette.primary }]}>
        <Text style={[styles.buttonText, { color: palette.onPrimary }]}>{busy ? '처리 중…' : '기본 쿠폰 받기'}</Text>
      </Pressable>
    </View> : series.claimable ? <Pressable accessibilityRole="button"
      accessibilityLabel={`${series.title} ${series.claimable === 'PRISM' ? '프리즘 쿠폰 받기' : '기본 쿠폰 조건 확인'}`}
      accessibilityState={{ disabled: busy }} disabled={busy}
      onPress={() => { if (series.claimable === 'BASE') setConfirmingBaseFor(series.id); else onClaim(); }}
      style={[styles.button, { backgroundColor: palette.primary }]}>
      <Text style={[styles.buttonText, { color: palette.onPrimary }]}>{busy ? '처리 중…' : `${series.claimable === 'PRISM' ? '프리즘 쿠폰 받기' : '기본 쿠폰 조건 확인'}`}</Text>
    </Pressable> : null}
  </FloatingCard>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 48, gap: 14 }, intro: { fontSize: 14, lineHeight: 21 },
  heading: { fontSize: 20, fontWeight: '800', marginTop: 6 }, card: { padding: 16, gap: 8 },
  name: { fontSize: 17, fontWeight: '800' }, tier: { gap: 4, paddingTop: 8 }, tierTitle: { fontWeight: '800', fontSize: 15 },
  coupon: { padding: 12, gap: 5, borderRadius: 10 }, message: { padding: 12, borderRadius: 10, lineHeight: 20 },
  button: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12, marginTop: 6, paddingHorizontal: 12 },
  buttonText: { fontSize: 15, fontWeight: '800' }, link: { minHeight: 48, justifyContent: 'center', alignItems: 'center' },
  coinImage: { width: 104, height: 104, alignSelf: 'center' },
  filterRow: { flexDirection: 'row', gap: 8 }, filterButton: { minHeight: 44, flex: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  gradeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, gradeCell: { width: '48%', minHeight: 92, borderRadius: 12, padding: 8, alignItems: 'center', justifyContent: 'center', gap: 3 },
  gradeImage: { width: 45, height: 45 }, sourceRow: { padding: 12, borderRadius: 12, gap: 5 },
});
