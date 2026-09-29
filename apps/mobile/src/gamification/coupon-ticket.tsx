import { useState } from 'react';
import { Pressable, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';

import type { Coupon } from './badge-api';
import { couponAccessibilityLabel, couponExpiryLabel, couponStatusLabel, rewardBoxName } from './badge-rules';
import { useGamificationTheme } from './theme';

const notch = 11;
const corner = 18;

/**
 * A paper coupon: title and shop above a perforation with side notches, status and expiry below.
 * Used coupons get a tilted ink stamp; expired ones fade. Meaning is always in text too.
 */
export function CouponTicket({ coupon, onUse }: { coupon: Coupon; onUse?: (coupon: Coupon) => void }) {
  const { styles, palette, medal, scheme } = useGamificationTheme();
  const [size, setSize] = useState<{ width: number; height: number }>();
  const [perforation, setPerforation] = useState<number>();
  const faded = coupon.status !== 'ISSUED';
  // Used/expired tickets read quieter through colour, not opacity, so the text keeps AA contrast.
  const muted = faded ? { color: medal.ticketMuted, opacity: 1 } : undefined;
  const stamped = coupon.status === 'REDEEMED';
  const statusStyle = coupon.status === 'ISSUED'
    ? { backgroundColor: palette.successContainer, color: palette.onSuccessContainer }
    : coupon.status === 'REDEEMED'
      ? { backgroundColor: palette.background, color: medal.stampInk }
      : { backgroundColor: palette.surface, color: palette.secondaryLabel };
  const gradientId = `ticket-${coupon.couponId.replace(/[^a-zA-Z0-9]/g, '')}`;
  const paperTop = scheme === 'dark' ? '#4D3E20' : '#FBF1DC';

  function onLayout(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    setSize((current) => (current?.width === width && current.height === height ? current : { width, height }));
  }

  return (
    <View onLayout={onLayout} style={styles.ticket}>
      {size && perforation ? (
        <Svg width={size.width} height={size.height} style={{ position: 'absolute' }}>
          <Defs>
            <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={paperTop} />
              <Stop offset="1" stopColor={palette.accentContainer} />
            </LinearGradient>
          </Defs>
          <Path d={ticketPath(size.width, size.height, perforation)} fill={`url(#${gradientId})`} stroke={medal.giftPaperShade} strokeWidth={1} />
          <Line
            x1={notch + 8}
            x2={size.width - notch - 8}
            y1={perforation}
            y2={perforation}
            stroke={palette.onAccentContainer}
            strokeOpacity={0.35}
            strokeWidth={1.5}
            strokeDasharray="6 6"
          />
        </Svg>
      ) : (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: corner, backgroundColor: palette.accentContainer }} />
      )}

      <View
        accessible
        accessibilityLabel={couponAccessibilityLabel(coupon)}
        onLayout={(event) => {
          const next = event.nativeEvent.layout.height;
          setPerforation((current) => (current === next ? current : next));
        }}
        style={[styles.ticketTop, stamped && styles.ticketStampRoom]}
      >
        <Text style={[styles.ticketEyebrow, muted]}>{rewardBoxName(coupon.milestone)} 쿠폰</Text>
        <Text style={[styles.ticketTitle, muted]}>{coupon.title}</Text>
        <Text style={[styles.ticketMerchant, muted]}>{coupon.merchantName}</Text>
        {/* Used or expired coupons drop the long detail so nothing sits under the stamp. */}
        {!faded && coupon.detail.trim() ? <Text style={styles.ticketDetail}>{coupon.detail}</Text> : null}
      </View>

      <View style={[styles.ticketBottom, stamped && styles.ticketStampRoom]}>
        <View style={styles.ticketMetaRow}>
          <View style={[styles.chip, { backgroundColor: statusStyle.backgroundColor }]}>
            <Text style={[styles.chipText, { color: statusStyle.color }]}>{couponStatusLabel(coupon.status)}</Text>
          </View>
          <Text style={[styles.ticketExpiry, muted]}>{couponExpiryLabel(coupon.expiresAt)}</Text>
        </View>
        {coupon.status === 'ISSUED' && onUse ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${coupon.title} 매장에서 사용하기`}
            accessibilityHint="직원에게 보여줄 QR을 열어요."
            onPress={() => onUse(coupon)}
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
          >
            <Text style={styles.buttonText}>매장에서 사용하기</Text>
          </Pressable>
        ) : null}
      </View>

      {coupon.status === 'REDEEMED' ? <InkStamp label="사용 완료" /> : null}
    </View>
  );
}

export function InkStamp({ label, big = false }: { label: string; big?: boolean }) {
  const { styles } = useGamificationTheme();
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[big ? styles.bigInkStamp : styles.inkStamp, { transform: [{ rotate: '-14deg' }], opacity: 0.92 }]}
    >
      <View style={big ? styles.bigInkStampInner : styles.inkStampInner}>
        <Text maxFontSizeMultiplier={1.2} style={big ? styles.bigInkStampText : styles.inkStampText}>{label}</Text>
      </View>
    </View>
  );
}

function ticketPath(width: number, height: number, notchY: number): string {
  const r = Math.min(corner, height / 4);
  const y = Math.min(Math.max(notchY, r + notch), height - r - notch);
  return [
    `M${r} 0`,
    `H${width - r}`,
    `A${r} ${r} 0 0 1 ${width} ${r}`,
    `V${y - notch}`,
    `A${notch} ${notch} 0 0 0 ${width} ${y + notch}`,
    `V${height - r}`,
    `A${r} ${r} 0 0 1 ${width - r} ${height}`,
    `H${r}`,
    `A${r} ${r} 0 0 1 0 ${height - r}`,
    `V${y + notch}`,
    `A${notch} ${notch} 0 0 0 0 ${y - notch}`,
    `V${r}`,
    `A${r} ${r} 0 0 1 ${r} 0`,
    'Z',
  ].join(' ');
}
