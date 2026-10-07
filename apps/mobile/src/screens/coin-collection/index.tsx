import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Image, Pressable, RefreshControl, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AccountCredential } from '@/auth/account-credential';
import { createCommerceApiClient } from '@/commerce/commerce-api';
import { parseCollectibleArtwork } from '@/commerce/collectible-artwork';
import { coinErrorMessage, createCoinApiClient, type CoinCollection, type CoinSeries, type SeriesTier } from '@/shop/coin-api';
import { colorsForScheme } from '@/theme/palette';
import { BackHeader } from '@/ui/back-header';
import { FloatingCard } from '@/ui/floating-card';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';
import { StateScene } from '@/ui/state-scene';
import { CoinCouponUse } from './coupon-use';

export function CoinCollectionScreen({ apiUrl, credential, onSessionInvalid }: {
  apiUrl: string; credential: AccountCredential; onSessionInvalid: () => Promise<void>;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const palette = colorsForScheme(useColorScheme());
  const api = useMemo(() => createCoinApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const identityApi = useMemo(() => createCommerceApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const [collection, setCollection] = useState<CoinCollection>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [usingCoupon, setUsingCoupon] = useState<CoinSeries>();
  const current = useRef(true);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    try { const value = await api.getCollection(); if (current.current) { setCollection(value); setMessage(undefined); } }
    catch (error) { if (current.current) setMessage(coinErrorMessage(error)); }
    finally { if (current.current) { setLoading(false); setRefreshing(false); } }
  }, [api]);
  const loadCoupon = useCallback(async () => {
    const fresh = await api.getCollection();
    if (current.current) setCollection(fresh);
    return fresh.series.find((series) => series.id === usingCoupon?.id);
  }, [api, usingCoupon?.id]);
  useFocusEffect(useCallback(() => {
    current.current = true; void load();
    return () => { current.current = false; };
  }, [load]));

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

  return <SkyBackdrop><SkyScrollView header={<BackHeader title="내 코인·시리즈" />}
    contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} progressViewOffset={insets.top} onRefresh={() => { setRefreshing(true); void load(); }} />}>
    <Text style={[styles.intro, { color: palette.secondaryLabel }]}>방문으로 얻은 코인과 뽑기로 얻은 코인을 함께 모아요. 쿠폰을 받아도 코인은 사라지지 않아요.</Text>
    {message ? <Text accessibilityLiveRegion="polite" style={[styles.message, { color: palette.label, backgroundColor: palette.primaryContainer }]}>{message}</Text> : null}
    {loading && !collection ? <StateScene kind="loading" title="코인 도감을 펼치는 중" /> : null}
    {!loading && !collection ? <StateScene kind="error" title="코인을 불러오지 못했어요" body={message}
      action={{ label: '다시 불러오기', onPress: () => { setLoading(true); void load(); } }} /> : null}
    {collection ? <>
      <Text accessibilityRole="header" style={[styles.heading, { color: palette.label }]}>내 코인</Text>
      {collection.coins.length === 0 ? <Text style={{ color: palette.secondaryLabel }}>아직 모은 코인이 없어요. 가게 방문이나 뽑기권으로 수집해 보세요.</Text> :
        collection.coins.map((coin) => <FloatingCard key={`${coin.publicationId}:${coin.gradeId}`} style={styles.card}>
          {parseCollectibleArtwork(coin.summary) ? <Image source={{ uri: parseCollectibleArtwork(coin.summary)!.thumbnailDataUrl }}
            accessibilityLabel={`${coin.name} 코인 그림`} style={styles.coinImage} resizeMode="contain" /> : null}
          <Text style={[styles.name, { color: palette.label }]}>{coin.name} ×{coin.quantity}</Text>
          <Text style={{ color: palette.secondaryLabel }}>방문 {coin.visitQuantity} · 뽑기 {coin.drawQuantity}</Text>
        </FloatingCard>)}
      <Text accessibilityRole="header" style={[styles.heading, { color: palette.label }]}>코인 시리즈</Text>
      {collection.series.length === 0 ? <Text style={{ color: palette.secondaryLabel }}>지금 진행 중인 시리즈가 없어요. 실제 가게의 쿠폰 조건이 정해지면 표시돼요.</Text> :
        collection.series.map((series) => <SeriesCard key={series.id} series={series} busy={Boolean(busyId)}
          onClaim={() => void claim(series.id)} onUse={() => setUsingCoupon(series)} palette={palette} />)}
      <Pressable accessibilityRole="button" onPress={() => router.push('/coin-shop')} style={styles.link}>
        <Text style={{ color: palette.primary }}>가게 뽑기권 보러 가기 ›</Text>
      </Pressable>
    </> : null}
  </SkyScrollView>
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
      <Text style={{ color: palette.onAccentContainer }}>사용 기한 {new Date(series.coupon.expiresAt).toLocaleDateString('ko-KR')} · {series.coupon.status === 'ISSUED' ? '미사용' : series.coupon.status === 'REDEEMED' ? '사용 완료' : '만료'}</Text>
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
});
