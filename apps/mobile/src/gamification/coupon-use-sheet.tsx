import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { focusForAccessibility } from '@/accessibility/focus-component';
import { publicDataDemoStoreName } from '@/merchant/public-data-demo-store';
import { ClaimQr } from '@/commerce/claim-qr';
import type { CustomerIdentity } from '@/commerce/commerce-api';
import { createIdentityRequestGate, customerIdentityCode, isCustomerIdentityExpired } from '@/commerce/customer-identity';

import type { BadgeBook, Coupon } from './badge-api';
import { couponExpiryLabel, couponForUse, couponQrSize, remainingLabel, type ShareVariant } from './badge-rules';
import { InkStamp } from './coupon-ticket';
import { CloseGlyph, GiftGlyph } from './glyphs';
import { successHaptic } from './native-effects';
import { FullScreenModal } from './full-screen-modal';
import { useGamificationTheme } from './theme';

type Props = {
  coupon: Coupon | undefined;
  variant: ShareVariant;
  createIdentity: () => Promise<CustomerIdentity>;
  revokeIdentity: (token: string) => Promise<void>;
  loadBadgeBook: () => Promise<BadgeBook>;
  loadCoupon?: () => Promise<Coupon | undefined>;
  onBadgeBook: (book: BadgeBook) => void;
  onCoupon?: (coupon: Coupon | undefined) => void;
  onClose: () => void;
};

const pollMs = 3_000;

/**
 * "매장에서 사용하기": the existing 2-minute customer identity QR, the coupon summary and a
 * countdown. Polls the badge book every 3 s and stamps "사용 완료" when staff redeem it.
 * The QR is revoked (best effort) when the sheet closes.
 */
export function CouponUseSheet(props: Props) {
  return (
    <FullScreenModal visible={props.coupon !== undefined} animationType="slide" onRequestClose={props.onClose}>
        {props.coupon ? <SheetBody {...props} coupon={props.coupon} /> : null}
      </FullScreenModal>
  );
}

function SheetBody({ coupon: initial, variant, createIdentity, revokeIdentity, loadBadgeBook, loadCoupon, onBadgeBook, onCoupon, onClose }: Props & { coupon: Coupon }) {
  const { styles, palette, medal } = useGamificationTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const qrSize = couponQrSize(width, height);
  const [coupon, setCoupon] = useState(initial);
  const [identity, setIdentity] = useState<CustomerIdentity>();
  const [identityBusy, setIdentityBusy] = useState(true);
  const [identityError, setIdentityError] = useState<string>();
  const [fresh, setFresh] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const gate = useRef(createIdentityRequestGate()).current;
  const latestToken = useRef<string | undefined>(undefined);
  const identityRequestPending = useRef(false);
  const reportedStatus = useRef<Coupon['status'] | undefined>(undefined);
  const heading = useRef<Text>(null);
  const notYetUsable = coupon.usableFrom !== undefined && Date.parse(coupon.usableFrom) > now;
  const done = coupon.status !== 'ISSUED' || Date.parse(coupon.expiresAt) <= now || notYetUsable;
  const identityValid = identity !== undefined && !isCustomerIdentityExpired(identity.expiresAt, now);

  // Only touches state after the request settles, so the mount effect can start it directly.
  async function requestIdentity(request: number) {
    identityRequestPending.current = true;
    try {
      const next = await createIdentity();
      if (!gate.isCurrent(request)) { void revokeIdentity(next.token).catch(() => undefined); return; }
      latestToken.current = next.token;
      setIdentity(next);
      setNow(Date.now());
    } catch {
      if (gate.isCurrent(request)) setIdentityError('QR을 만들지 못했어요. 연결을 확인하고 다시 시도해 주세요.');
    } finally {
      identityRequestPending.current = false;
      if (gate.isCurrent(request)) setIdentityBusy(false);
    }
  }

  function issueAgain() {
    if (!fresh || done) return;
    const request = gate.start();
    setIdentityBusy(true);
    setIdentityError(undefined);
    setIdentity(undefined);
    void requestIdentity(request);
  }

  // Only a fresh server coupon state can expose a customer QR.
  useEffect(() => {
    const focus = setTimeout(() => {
      if (heading.current) focusForAccessibility(heading.current);
    }, 350);
    return () => {
      clearTimeout(focus);
      gate.cancel();
      const token = latestToken.current;
      latestToken.current = undefined;
      if (token) void revokeIdentity(token).catch(() => undefined);
    };
    // Mount/unmount only: one identity per opened sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const book = loadCoupon ? undefined : await loadBadgeBook();
        const benefitCoupon = loadCoupon ? await loadCoupon() : undefined;
        if (!active) return;
        const current = book ? couponForUse(initial, book) : benefitCoupon?.merchantId === initial.merchantId
          ? benefitCoupon : { ...initial, status: 'VOIDED' as const };
        if (current.status !== 'ISSUED' || Date.parse(current.expiresAt) <= Date.now()) {
          gate.cancel();
          const token = latestToken.current;
          latestToken.current = undefined;
          if (token) void revokeIdentity(token).catch(() => undefined);
          setIdentity(undefined);
        }
        setCoupon(current);
        setFresh(true);
        setRefreshError(false);
        if (current.status !== 'ISSUED' && current.status !== reportedStatus.current) {
          reportedStatus.current = current.status;
          if (book) onBadgeBook(book);
          else onCoupon?.(benefitCoupon);
          if (current.status === 'REDEEMED') void successHaptic();
        }
        if (current.status === 'ISSUED' && Date.parse(current.expiresAt) > Date.now() &&
          (!current.usableFrom || Date.parse(current.usableFrom) <= Date.now()) && !latestToken.current && !identityRequestPending.current) {
          void requestIdentity(gate.start());
        }
      } catch {
        if (active) {
          gate.cancel();
          const token = latestToken.current;
          latestToken.current = undefined;
          if (token) void revokeIdentity(token).catch(() => undefined);
          setRefreshError(true); setFresh(false); setIdentity(undefined);
        }
      }
      if (active) timer = setTimeout(() => void poll(), pollMs);
    }
    void poll();
    return () => { active = false; clearTimeout(timer); };
    // Keep polling one coupon and one account while this sheet is mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if ((!identity && !notYetUsable) || (done && !notYetUsable)) return;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (identity && isCustomerIdentityExpired(identity.expiresAt, current)) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [identity, done, notYetUsable]);

  return (
    <View style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessible={false} importantForAccessibility="no" />
      <View style={[styles.sheet, { maxHeight: height - insets.top - 12 }]} accessibilityViewIsModal>
        <View style={styles.sheetHandle} />
        <View style={styles.sheetHeader}>
          <Text ref={heading} accessibilityRole="header" style={styles.sheetTitle}>
            {coupon.status === 'REDEEMED' ? '사용 완료' : coupon.status === 'VOIDED' ? '사용할 수 없는 쿠폰' : '매장에서 사용하기'}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="닫기" onPress={onClose} style={styles.closeButton}>
            <CloseGlyph size={20} color={palette.label} />
          </Pressable>
        </View>
        <ScrollView style={styles.sheetScroll} contentContainerStyle={[styles.sheetBody, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.couponSummary} accessible accessibilityLabel={coupon.status === 'VOIDED' ? `${publicDataDemoStoreName(coupon.merchantId, coupon.merchantName)} ${coupon.title}` : `${publicDataDemoStoreName(coupon.merchantId, coupon.merchantName)} ${coupon.title}, ${couponExpiryLabel(coupon.expiresAt).replace('~', '')}`}>
            <GiftGlyph size={34} color={coupon.milestone === 3 ? medal.giftGold : medal.giftPaperShade} ribbon={medal.ribbon} />
            <View style={styles.couponSummaryCopy}>
              <Text style={styles.ticketMerchant}>{publicDataDemoStoreName(coupon.merchantId, coupon.merchantName)}</Text>
              <Text style={styles.ticketTitle}>{coupon.title}</Text>
              {coupon.detail.trim() ? <Text style={styles.ticketExpiry}>사용 조건 · {coupon.detail}</Text> : null}
              {coupon.status === 'VOIDED' ? null : <Text style={styles.ticketExpiry}>{couponExpiryLabel(coupon.expiresAt)}</Text>}
            </View>
          </View>

          {coupon.status === 'REDEEMED' ? (
            <RedeemedPanel merchantName={publicDataDemoStoreName(coupon.merchantId, coupon.merchantName)} onClose={onClose} />
          ) : coupon.status === 'VOIDED' ? (
            <Text accessibilityLiveRegion="polite" style={styles.errorText}>이 쿠폰은 더 이상 사용할 수 없어요. 방문 기록이 바뀌었거나 운영팀이 무효로 했어요.</Text>
          ) : coupon.status === 'EXPIRED' || Date.parse(coupon.expiresAt) <= now ? (
            <Text accessibilityLiveRegion="polite" style={styles.errorText}>이 쿠폰은 사용 기간이 끝났어요.</Text>
          ) : notYetUsable ? (
            <Text accessibilityLiveRegion="polite" style={styles.qrHint}>이 쿠폰은 {new Date(coupon.usableFrom!).toLocaleDateString('ko-KR')}부터 사용할 수 있어요.</Text>
          ) : (
            <>
              {!fresh ? <Text accessibilityLiveRegion="polite" style={styles.qrHint}>{refreshError ? '최신 쿠폰 상태를 확인하지 못했습니다. 연결 후 다시 열어 주세요.' : '최신 쿠폰 상태 확인 중…'}</Text> : null}
              <View style={styles.qrCard}>
                {fresh && identityValid && identity ? (
                  <>
                    <ClaimQr code={identity.token} size={qrSize} accessibilityLabel="직원에게 보여줄 쿠폰 사용 QR 코드" />
                    <Text style={styles.qrCodeLabel}>확인 코드</Text>
                    <Text selectable style={styles.qrCode}>{customerIdentityCode(identity.token)}</Text>
                    <Text style={styles.qrTimer}>{remainingLabel(identity.expiresAt, now)}</Text>
                  </>
                ) : identityBusy || !fresh ? (
                  <View style={[styles.qrPlaceholder, { width: qrSize, height: qrSize }]}>
                    <ActivityIndicator color="#2456D6" />
                    <Text style={styles.qrCodeLabel}>QR을 만드는 중…</Text>
                  </View>
                ) : (
                  <View style={[styles.qrPlaceholder, { width: qrSize, height: qrSize }]}>
                    <Text accessibilityLiveRegion="polite" style={[styles.qrHint, { color: '#192331' }]}>
                      {identityError ?? 'QR 시간이 끝났어요. 새 QR을 받아 주세요.'}
                    </Text>
                    <Pressable accessibilityRole="button" onPress={issueAgain} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
                      <Text style={styles.buttonText}>새 QR 받기</Text>
                    </Pressable>
                  </View>
                )}
              </View>
              <Text style={styles.qrHint}>직원이 확인하면 자동으로 사용 완료로 바뀌어요.</Text>
              {variant === 'showcase' ? <Text style={styles.showcaseLine}>가상 체험 쿠폰 · 실제 매장 혜택 아님</Text> : null}
            </>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

function RedeemedPanel({ merchantName, onClose }: { merchantName: string; onClose: () => void }) {
  const { styles } = useGamificationTheme();
  const reduceMotion = useReducedMotion();
  const slam = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (!reduceMotion) slam.set(withSpring(1, { damping: 10, stiffness: 190 }));
  }, [reduceMotion, slam]);

  const stampStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, slam.get() * 2),
    transform: [{ scale: 2 - slam.get() }],
  }));

  return (
    <View style={styles.redeemedPanel}>
      <Animated.View style={stampStyle}>
        <InkStamp label="사용 완료!" big />
      </Animated.View>
      <Text accessibilityLiveRegion="assertive" style={styles.redeemedTitle}>맛있게 즐기세요!</Text>
      <Text style={styles.redeemedBody}>{merchantName} 쿠폰을 사용했어요.{'\n'}다음 가게도 탐험해 볼까요?</Text>
      <Pressable accessibilityRole="button" onPress={onClose} style={({ pressed }) => [styles.button, { alignSelf: 'stretch' }, pressed && styles.pressed]}>
        <Text style={styles.buttonText}>확인</Text>
      </Pressable>
    </View>
  );
}
