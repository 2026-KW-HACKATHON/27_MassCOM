import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect, useIsFocused } from 'expo-router';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { CustomerIdentity } from '@/commerce/commerce-api';
import { ClaimQr } from '@/commerce/claim-qr';
import { createIdentityRequestGate, customerIdentityCode } from '@/commerce/customer-identity';
import type { CoinSeries } from '@/shop/coin-api';
import { colorsForScheme } from '@/theme/palette';
import { FullScreenModal } from '@/gamification/full-screen-modal';

export function CoinCouponUse({ series, load, createIdentity, revokeIdentity, onClose }: {
  series: CoinSeries; load: () => Promise<CoinSeries | undefined>; createIdentity: () => Promise<CustomerIdentity>;
  revokeIdentity: (token: string) => Promise<void>; onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const palette = colorsForScheme(useColorScheme());
  const [fresh, setFresh] = useState<CoinSeries>();
  const [identity, setIdentity] = useState<CustomerIdentity>();
  const [message, setMessage] = useState<string>();
  const [now, setNow] = useState(() => Date.now());
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const focused = useIsFocused();
  const active = foreground && focused;
  const activeRef = useRef(active);
  const gate = useMemo(() => createIdentityRequestGate(), []);
  const latestToken = useRef<string | undefined>(undefined);
  const latestExpiresAt = useRef<string | undefined>(undefined);

  const hideIdentity = useCallback(() => {
    activeRef.current = false;
    gate.cancel();
    setFresh(undefined);
    setIdentity(undefined);
    const token = latestToken.current;
    latestToken.current = undefined;
    latestExpiresAt.current = undefined;
    if (token) void revokeIdentity(token).catch(() => undefined);
  }, [gate, revokeIdentity]);

  useFocusEffect(useCallback(() => () => hideIdentity(), [hideIdentity]));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      const isActive = state === 'active';
      if (!isActive) hideIdentity();
      setForeground(isActive);
    });
    return () => subscription.remove();
  }, [hideIdentity]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!active) return;
    activeRef.current = true;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function check() {
      const request = gate.start();
      try {
        const current = await load();
        if (cancelled || !activeRef.current || !gate.isCurrent(request)) return;
        if (!current?.coupon || current.coupon.id !== series.coupon?.id) throw new Error('COUPON_MISSING');
        setFresh(current);
        setNow(Date.now());
        const active = current.coupon.status === 'ISSUED' && Date.parse(current.coupon.expiresAt) > Date.now();
        if (!active) {
          const token = latestToken.current;
          latestToken.current = undefined;
          latestExpiresAt.current = undefined;
          setIdentity(undefined);
          if (token) void revokeIdentity(token).catch(() => undefined);
        } else if (!latestToken.current || !latestExpiresAt.current || Date.parse(latestExpiresAt.current) <= Date.now()) {
          const next = await createIdentity();
          if (cancelled || !activeRef.current || !gate.isCurrent(request)) {
            void revokeIdentity(next.token).catch(() => undefined);
            return;
          }
          const previous = latestToken.current;
          latestToken.current = next.token;
          latestExpiresAt.current = next.expiresAt;
          if (previous) void revokeIdentity(previous).catch(() => undefined);
          setIdentity(next);
          setNow(Date.now());
        }
        setMessage(undefined);
      } catch {
        if (!cancelled && activeRef.current && gate.isCurrent(request)) {
          setFresh(undefined); setIdentity(undefined);
          const token = latestToken.current;
          latestToken.current = undefined;
          latestExpiresAt.current = undefined;
          if (token) void revokeIdentity(token).catch(() => undefined);
          setMessage('쿠폰 상태를 확인하지 못했어요. QR은 잠시 숨겼어요.');
        }
      }
      if (!cancelled && activeRef.current && gate.isCurrent(request)) timer = setTimeout(() => void check(), 3_000);
    }
    void check();
    return () => {
      cancelled = true; clearTimeout(timer); hideIdentity();
    };
  }, [active, createIdentity, gate, hideIdentity, load, revokeIdentity, series.coupon?.id]);

  const coupon = fresh?.coupon;
  const usable = coupon?.status === 'ISSUED' && Date.parse(coupon.expiresAt) > now;
  const identityValid = identity && Date.parse(identity.expiresAt) > now;
  return <FullScreenModal visible={focused} animationType="slide" onRequestClose={onClose}>
    <View style={[styles.root, { backgroundColor: palette.background, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
      <Pressable accessibilityRole="button" onPress={onClose} style={styles.close}><Text style={{ color: palette.primary }}>닫기</Text></Pressable>
      <ScrollView contentContainerStyle={styles.body}>
        <Text accessibilityRole="header" style={[styles.heading, { color: palette.label }]}>{series.title} 쿠폰 사용</Text>
        <Text style={{ color: palette.secondaryLabel }}>매장 직원에게 고객 신원 QR을 보여주세요. 쿠폰은 직원이 사용 처리합니다.</Text>
        {coupon ? <>
          <Text style={[styles.title, { color: palette.label }]}>{coupon.title}</Text>
          <Text style={{ color: palette.secondaryLabel }}>{coupon.detail}</Text>
          <Text style={{ color: palette.secondaryLabel }}>사용 기한 {new Date(coupon.expiresAt).toLocaleString('ko-KR')}</Text>
          {coupon.status === 'REDEEMED' ? <Text style={{ color: palette.success }}>사용 완료</Text> : null}
          {coupon.status === 'EXPIRED' ? <Text style={{ color: palette.error }}>사용 기한이 지났어요.</Text> : null}
        </> : null}
        {active && usable && identityValid ? <View style={styles.qr}>
          <ClaimQr code={identity.token} size={240} accessibilityLabel="매장 직원에게 보여줄 1회 고객 신원 QR" />
          <Text selectable style={{ color: palette.label }}>{customerIdentityCode(identity.token)}</Text>
          <Text style={{ color: palette.secondaryLabel }}>QR 만료 {new Date(identity.expiresAt).toLocaleTimeString('ko-KR')}</Text>
        </View> : usable ? <Text style={{ color: palette.secondaryLabel }}>고객 신원을 확인하는 중…</Text> : null}
        {message ? <Text accessibilityLiveRegion="polite" style={{ color: palette.error }}>{message}</Text> : null}
      </ScrollView>
    </View>
  </FullScreenModal>;
}

const styles = StyleSheet.create({
  root: { flex: 1 }, close: { minHeight: 48, paddingHorizontal: 20, alignItems: 'flex-end', justifyContent: 'center' },
  body: { paddingHorizontal: 24, paddingBottom: 32, gap: 12 }, heading: { fontSize: 22, fontWeight: '800' },
  title: { fontSize: 18, fontWeight: '800', marginTop: 8 }, qr: { alignItems: 'center', gap: 12, paddingTop: 18 },
});
