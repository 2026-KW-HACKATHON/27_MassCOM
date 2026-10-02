import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { focusForAccessibility } from '@/accessibility/focus-component';
import { Mascot } from '@/ui/mascot';

import type { Coupon, OpenedReward } from './badge-api';
import { rewardBoxName } from './badge-rules';
import { CouponTicket } from './coupon-ticket';
import { SparkleGlyph } from './glyphs';
import { successHaptic } from './native-effects';
import { FullScreenModal } from './full-screen-modal';
import { useGamificationTheme } from './theme';

/** The coupon that came out of a box, sliding up out of a burst of sparkles. */
export function RewardReveal({ result, onClose, onUse }: {
  result: OpenedReward | undefined;
  onClose: () => void;
  onUse: (coupon: Coupon) => void;
}) {
  return (
    <FullScreenModal visible={result !== undefined} animationType="fade" onRequestClose={onClose}>
        {result ? <RevealBody result={result} onClose={onClose} onUse={onUse} /> : null}
      </FullScreenModal>
  );
}

function RevealBody({ result, onClose, onUse }: { result: OpenedReward; onClose: () => void; onUse: (coupon: Coupon) => void }) {
  const { styles, medal } = useGamificationTheme();
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const title = useRef<Text>(null);
  const rise = useSharedValue(reduceMotion ? 1 : 0);
  const spin = useSharedValue(0);

  useEffect(() => {
    if (!result.replayed) void successHaptic();
    if (!reduceMotion) {
      rise.set(withDelay(80, withSpring(1, { damping: 13, stiffness: 150 })));
      spin.set(withTiming(1, { duration: 2400, easing: Easing.out(Easing.cubic) }));
    }
    const focus = setTimeout(() => {
      if (title.current) focusForAccessibility(title.current);
    }, 400);
    return () => clearTimeout(focus);
  }, [reduceMotion, result.replayed, rise, spin]);

  const ticketStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, rise.get() * 1.6),
    transform: [{ translateY: (1 - rise.get()) * 60 }, { scale: 0.88 + rise.get() * 0.12 }],
  }));
  const burstStyle = useAnimatedStyle(() => ({
    opacity: 0.4 + rise.get() * 0.6,
    transform: [{ rotate: `${spin.get() * 360}deg` }, { scale: 0.6 + rise.get() * 0.4 }],
  }));

  return (
    <View style={styles.backdrop} accessibilityViewIsModal>
      <ScrollView contentContainerStyle={[styles.revealCenter, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.revealCard}>
          <View style={{ alignItems: 'center', justifyContent: 'center', height: 56 }} importantForAccessibility="no-hide-descendants">
            <Animated.View style={[{ flexDirection: 'row', gap: 18, alignItems: 'center' }, burstStyle]}>
              <SparkleGlyph size={18} color={medal.giftGold} />
              <SparkleGlyph size={30} color={medal.ribbon} />
              <SparkleGlyph size={18} color={medal.giftGold} />
            </Animated.View>
          </View>
          <View style={{ alignItems: 'center' }}>
            <Mascot pose="gift" size={112} />
          </View>
          <Text ref={title} accessibilityRole="header" style={styles.revealTitle}>
            {result.replayed ? '이미 받은 쿠폰이에요' : '쿠폰이 나왔어요!'}
          </Text>
          <Text accessibilityLiveRegion="polite" style={styles.revealBody}>
            {rewardBoxName(result.coupon.milestone)}에서 나온 쿠폰은 도감의 ‘내 쿠폰’에 보관돼요.
          </Text>
          <Animated.View style={ticketStyle}>
            <CouponTicket coupon={result.coupon} onUse={onUse} />
          </Animated.View>
          <Pressable accessibilityRole="button" onPress={onClose} style={({ pressed }) => [styles.ghostButton, pressed && styles.pressed]}>
            <Text style={styles.ghostButtonText}>나중에 쓸게요</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
