import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ClaimQr } from '@/commerce/claim-qr';
import type { CustomerIdentity } from '@/commerce/commerce-api';
import { createIdentityRequestGate, customerIdentityCode, isCustomerIdentityExpired } from '@/commerce/customer-identity';

import type { BadgeBook, Coupon } from './badge-api';
import { couponExpiryLabel, couponQrSize, findCoupon, remainingLabel, type ShareVariant } from './badge-rules';
import { InkStamp } from './coupon-ticket';
import { CloseGlyph, GiftGlyph } from './glyphs';
import { successHaptic } from './native-effects';
import { useGamificationTheme } from './theme';

type Props = {
  coupon: Coupon | undefined;
  variant: ShareVariant;
  createIdentity: () => Promise<CustomerIdentity>;
  revokeIdentity: (token: string) => Promise<void>;
  loadBadgeBook: () => Promise<BadgeBook>;
  onBadgeBook: (book: BadgeBook) => void;
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
    <Modal visible={props.coupon !== undefined} transparent animationType="slide" statusBarTranslucent onRequestClose={props.onClose}>
      <SafeAreaProvider>
        {props.coupon ? <SheetBody {...props} coupon={props.coupon} /> : null}
      </SafeAreaProvider>
    </Modal>
  );
}

function SheetBody({ coupon: initial, variant, createIdentity, revokeIdentity, loadBadgeBook, onBadgeBook, onClose }: Props & { coupon: Coupon }) {
  const { styles, palette, medal } = useGamificationTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const qrSize = couponQrSize(width, height);
  const [coupon, setCoupon] = useState(initial);
  const [identity, setIdentity] = useState<CustomerIdentity>();
  const [identityBusy, setIdentityBusy] = useState(true);
  const [identityError, setIdentityError] = useState<string>();
  const [now, setNow] = useState(() => Date.now());
  const gate = useRef(createIdentityRequestGate()).current;
  const latestToken = useRef<string | undefined>(undefined);
  const heading = useRef<Text>(null);
  const done = coupon.status !== 'ISSUED';
  const identityValid = identity !== undefined && !isCustomerIdentityExpired(identity.expiresAt, now);

  // Only touches state after the request settles, so the mount effect can start it directly.
  async function requestIdentity(request: number) {
    try {
      const next = await createIdentity();
      if (!gate.isCurrent(request)) return;
      latestToken.current = next.token;
      setIdentity(next);
      setNow(Date.now());
    } catch {
      if (gate.isCurrent(request)) setIdentityError('QR을 만들지 못했어요. 연결을 확인하고 다시 시도해 주세요.');
    } finally {
      if (gate.isCurrent(request)) setIdentityBusy(false);
    }
  }

  function issueAgain() {
    const request = gate.start();
    setIdentityBusy(true);
    setIdentityError(undefined);
    setIdentity(undefined);
    void requestIdentity(request);
  }

  // Issue on open; revoke whatever is still live when the sheet goes away.
  useEffect(() => {
    void requestIdentity(gate.start());
    const focus = setTimeout(() => {
      if (heading.current) AccessibilityInfo.sendAccessibilityEvent(heading.current, 'focus');
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
    if (!identity || done) return;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (isCustomerIdentityExpired(identity.expiresAt, current)) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [identity, done]);

  useEffect(() => {
    if (done) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const book = await loadBadgeBook();
        if (!active) return;
        onBadgeBook(book);
        const next = findCoupon(book, initial.couponId);
        if (next && next.status !== 'ISSUED') {
          setCoupon(next);
          if (next.status === 'REDEEMED') void successHaptic();
          return;
        }
      } catch {
        // Keep polling quietly; the QR is still valid and the staff side decides.
      }
      if (active) timer = setTimeout(() => void poll(), pollMs);
    }
    timer = setTimeout(() => void poll(), pollMs);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [done, initial.couponId, loadBadgeBook, onBadgeBook]);

  return (
    <View style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessible={false} importantForAccessibility="no" />
      <View style={[styles.sheet, { maxHeight: height - insets.top - 12 }]} accessibilityViewIsModal>
        <View style={styles.sheetHandle} />
        <View style={styles.sheetHeader}>
          <Text ref={heading} accessibilityRole="header" style={styles.sheetTitle}>
            {coupon.status === 'REDEEMED' ? '사용 완료' : '매장에서 사용하기'}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="닫기" onPress={onClose} style={styles.closeButton}>
            <CloseGlyph size={20} color={palette.label} />
          </Pressable>
        </View>
        <ScrollView style={styles.sheetScroll} contentContainerStyle={[styles.sheetBody, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.couponSummary} accessible accessibilityLabel={`${coupon.merchantName} ${coupon.title}, ${couponExpiryLabel(coupon.expiresAt).replace('~', '')}`}>
            <GiftGlyph size={34} color={coupon.milestone === 3 ? medal.giftGold : medal.giftPaperShade} ribbon={medal.ribbon} />
            <View style={styles.couponSummaryCopy}>
              <Text style={styles.ticketMerchant}>{coupon.merchantName}</Text>
              <Text style={styles.ticketTitle}>{coupon.title}</Text>
              <Text style={styles.ticketExpiry}>{couponExpiryLabel(coupon.expiresAt)}</Text>
            </View>
          </View>

          {coupon.status === 'REDEEMED' ? (
            <RedeemedPanel merchantName={coupon.merchantName} onClose={onClose} />
          ) : coupon.status === 'EXPIRED' ? (
            <Text accessibilityLiveRegion="polite" style={styles.errorText}>이 쿠폰은 사용 기간이 끝났어요.</Text>
          ) : (
            <>
              <View style={styles.qrCard}>
                {identityValid && identity ? (
                  <>
                    <ClaimQr code={identity.token} size={qrSize} accessibilityLabel="직원에게 보여줄 쿠폰 사용 QR 코드" />
                    <Text style={styles.qrCodeLabel}>확인 코드</Text>
                    <Text selectable style={styles.qrCode}>{customerIdentityCode(identity.token)}</Text>
                    <Text accessibilityLiveRegion="polite" style={styles.qrTimer}>{remainingLabel(identity.expiresAt, now)}</Text>
                  </>
                ) : identityBusy ? (
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
              {variant === 'showcase' ? <Text style={styles.showcaseLine}>가상 점포 체험 쿠폰 · 실제 매장 혜택 아님</Text> : null}
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
