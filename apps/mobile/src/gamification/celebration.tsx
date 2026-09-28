import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, Ellipse, LinearGradient, Rect, Stop } from 'react-native-svg';

import { tierColors } from '@/theme/medal-colors';

import type { BadgeBook } from './badge-api';
import {
  celebrationStageSize,
  closestNextGoal,
  featuredRaisedMedal,
  medalTitle,
  rewardBoxName,
  type BadgeBookDiff,
  type ShareVariant,
} from './badge-rules';
import { ConfettiBurst } from './confetti';
import { CloseGlyph, GiftGlyph, MedalGlyph, mascotStamp } from './glyphs';
import { successHaptic } from './native-effects';
import { useBadgeShare } from './share-card';
import { useGamificationTheme, type GamificationTheme } from './theme';

export type CelebrationContent = {
  merchantName: string;
  progressCounted: boolean;
  diff: BadgeBookDiff;
  after?: BadgeBook;
};

type Props = {
  content: CelebrationContent | undefined;
  variant: ShareVariant;
  onClose: () => void;
  /** focusRewards: a box became openable, so land on the reward section. */
  onOpenCollection: (focusRewards: boolean) => void;
};

const impactAt = 420;

/** "도장 쾅!" — full-screen celebration after a confirmed visit. Static under reduced motion. */
export function Celebration({ content, variant, onClose, onOpenCollection }: Props) {
  return (
    <Modal
      visible={content !== undefined}
      animationType="fade"
      transparent
      statusBarTranslucent
      onRequestClose={onClose}
    >
      {/* Modal is its own window: measure its insets instead of the app root's. */}
      <SafeAreaProvider>
        {content ? <CelebrationBody content={content} variant={variant} onClose={onClose} onOpenCollection={onOpenCollection} /> : null}
      </SafeAreaProvider>
    </Modal>
  );
}

function CelebrationBody({ content, variant, onClose, onOpenCollection }: Props & { content: CelebrationContent }) {
  const theme = useGamificationTheme();
  const { styles, palette, medal } = theme;
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const title = useRef<Text>(null);
  const { host, share, sharing } = useBadgeShare(variant);
  const [shareError, setShareError] = useState<string>();
  const [stageCenterY, setStageCenterY] = useState<number>();
  const stage = celebrationStageSize(width, height);
  const featured = featuredRaisedMedal(content.diff);
  const openable = content.diff.newlyReady.length > 0;
  const hint = content.diff.raisedMedals.length === 0 && !openable
    ? closestNextGoal(content.after)
    : null;

  useEffect(() => {
    const haptic = setTimeout(() => void successHaptic(), reduceMotion ? 0 : impactAt);
    const focus = setTimeout(() => {
      if (title.current) AccessibilityInfo.sendAccessibilityEvent(title.current, 'focus');
    }, reduceMotion ? 250 : 900);
    return () => {
      clearTimeout(haptic);
      clearTimeout(focus);
    };
  }, [reduceMotion]);

  async function shareFeatured() {
    if (!featured) return;
    setShareError(undefined);
    if ((await share(featured)) === 'failed') setShareError('공유 창을 열지 못했어요. 잠시 뒤 다시 시도해 주세요.');
  }

  return (
    <View style={styles.fullScreen} accessibilityViewIsModal>
      <SkyBackdrop theme={theme} />
      <ScrollView
        contentContainerStyle={[styles.celebrationScroll, { paddingTop: insets.top + 52, paddingBottom: insets.bottom + 16 }]}
      >
        <View onLayout={(event) => {
          const { y, height: stageHeight } = event.nativeEvent.layout;
          setStageCenterY(y + stageHeight / 2);
        }}>
          <StampStage theme={theme} reduceMotion={reduceMotion} size={stage} />
        </View>

        <Text ref={title} accessibilityRole="header" style={styles.celebrationTitle}>
          {content.merchantName} 도장 쾅!
        </Text>
        <Text accessibilityLiveRegion="polite" style={styles.celebrationBody}>
          {content.progressCounted
            ? '방문 도장이 도감에 찍혔어요.'
            : '방문은 기록됐어요. 같은 가게는 하루에 한 번만 배지에 세요.'}
          {hint ? `\n다음 목표 · ${hint}` : ''}
        </Text>

        {content.diff.raisedMedals.length > 0 || openable ? (
          <View style={styles.chipColumn}>
            {content.diff.raisedMedals.map(({ kind, toTier, medal: raised }) => {
              const colors = tierColors(medal, toTier as 1 | 2 | 3);
              return (
                <View key={kind} style={[styles.celebrationChip, { backgroundColor: colors.container }]}>
                  <MedalGlyph kind={kind} size={20} color={colors.onContainer} />
                  <Text style={[styles.celebrationChipText, { color: colors.onContainer }]}>{medalTitle(raised)} 달성!</Text>
                </View>
              );
            })}
            {content.diff.newlyReady.map((reward) => (
              <View key={reward.milestone} style={[styles.celebrationChip, { backgroundColor: palette.primaryContainer }]}>
                <GiftGlyph size={20} color={medal.giftGold} ribbon={medal.ribbon} />
                <Text style={[styles.celebrationChipText, { color: palette.onPrimaryContainer }]}>
                  {rewardBoxName(reward.milestone)}를 열 수 있어요
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.celebrationActions}>
          <Pressable
            accessibilityRole="button"
            onPress={() => onOpenCollection(openable)}
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
          >
            <Text style={styles.buttonText}>{openable ? '도감에서 상자 열기' : '도감에서 보기'}</Text>
          </Pressable>
          {featured ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${medalTitle(featured)} 배지 공유`}
              accessibilityState={{ busy: sharing, disabled: sharing }}
              disabled={sharing}
              onPress={() => void shareFeatured()}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed, sharing && styles.disabled]}
            >
              <Text style={styles.secondaryButtonText}>{sharing ? '카드 만드는 중…' : '배지 공유'}</Text>
            </Pressable>
          ) : null}
          {shareError ? <Text accessibilityLiveRegion="polite" style={styles.errorText}>{shareError}</Text> : null}
          <Pressable accessibilityRole="button" onPress={onClose} style={({ pressed }) => [styles.ghostButton, pressed && styles.pressed]}>
            <Text style={styles.ghostButtonText}>닫기</Text>
          </Pressable>
        </View>
      </ScrollView>

      {!reduceMotion && stageCenterY !== undefined ? (
        <ConfettiBurst
          colors={medal.confetti}
          leafColor="#4CAF6A"
          originX={width / 2}
          originY={stageCenterY}
          width={width}
          height={height}
          count={32}
          delay={impactAt - 40}
          duration={1600}
        />
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="축하 화면 닫기"
        onPress={onClose}
        hitSlop={8}
        style={[styles.closeButton, styles.celebrationClose, { top: insets.top + 6 }]}
      >
        <CloseGlyph size={22} color={medal.skyInk} />
      </Pressable>
      {host}
    </View>
  );
}

function SkyBackdrop({ theme }: { theme: GamificationTheme }) {
  const { medal, scheme } = theme;
  const cloud = scheme === 'dark' ? 0.06 : 0.55;
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <LinearGradient id="celebrationSky" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={medal.sky[0]} />
          <Stop offset="0.5" stopColor={medal.sky[1]} />
          <Stop offset="1" stopColor={medal.sky[2]} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#celebrationSky)" />
      <Ellipse cx="12%" cy="14%" rx="90" ry="34" fill="#FFFFFF" opacity={cloud} />
      <Ellipse cx="88%" cy="22%" rx="110" ry="40" fill="#FFFFFF" opacity={cloud * 0.8} />
      <Ellipse cx="78%" cy="92%" rx="140" ry="46" fill="#FFFFFF" opacity={cloud * 0.7} />
    </Svg>
  );
}

function StampStage({ theme, reduceMotion, size }: { theme: GamificationTheme; reduceMotion: boolean; size: number }) {
  const { styles, palette } = theme;
  const scale = useSharedValue(reduceMotion ? 1 : 2.3);
  const rotate = useSharedValue(reduceMotion ? -8 : -28);
  const lift = useSharedValue(reduceMotion ? 0 : -46);
  const opacity = useSharedValue(reduceMotion ? 1 : 0);
  const blot = useSharedValue(reduceMotion ? 1 : 0);
  const ring = useSharedValue(0);
  const shake = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) return;
    const spring = { damping: 11, stiffness: 210, mass: 0.9 };
    opacity.set(withDelay(180, withTiming(1, { duration: 110 })));
    scale.set(withDelay(180, withSpring(1, spring)));
    rotate.set(withDelay(180, withSpring(-8, spring)));
    lift.set(withDelay(180, withSpring(0, spring)));
    blot.set(withDelay(impactAt - 20, withTiming(1, { duration: 480, easing: Easing.out(Easing.cubic) })));
    ring.set(withDelay(impactAt - 20, withTiming(1, { duration: 950, easing: Easing.out(Easing.quad) })));
    shake.set(withDelay(impactAt - 20, withSequence(
      withTiming(6, { duration: 45 }),
      withTiming(-5, { duration: 70 }),
      withTiming(3, { duration: 60 }),
      withTiming(0, { duration: 60 }),
    )));
  }, [reduceMotion, opacity, scale, rotate, lift, blot, ring, shake]);

  const stageStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.get() }] }));
  const stampStyle = useAnimatedStyle(() => ({
    opacity: opacity.get(),
    transform: [{ translateY: lift.get() }, { scale: scale.get() }, { rotate: `${rotate.get()}deg` }],
  }));
  const blotStyle = useAnimatedStyle(() => ({
    opacity: 0.18 * blot.get(),
    transform: [{ scale: 0.55 + blot.get() * 0.6 }],
  }));

  const paper = Math.round(size * 0.84);
  const ink = Math.round(size * 0.78);
  const stamp = Math.round(size * 0.68);
  return (
    <Animated.View
      style={[styles.stage, { width: size, height: size }, stageStyle]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      {/* Ink-pad paper: tinted so the gap around the stamp reads as ink, not a hole. */}
      <View style={[styles.stagePaper, { width: paper, height: paper, borderRadius: paper / 2, backgroundColor: palette.primaryContainer }]} />
      <Animated.View style={[styles.inkBlot, { width: ink, height: ink, borderRadius: ink / 2 }, blotStyle]} />
      {reduceMotion ? null : (
        <>
          <InkRing progress={ring} delay={0} theme={theme} size={ink} />
          <InkRing progress={ring} delay={0.18} theme={theme} size={ink} />
        </>
      )}
      <Animated.View style={stampStyle}>
        <Image source={mascotStamp} style={{ width: stamp, height: stamp, borderRadius: stamp / 2 }} />
      </Animated.View>
    </Animated.View>
  );
}

function InkRing({ progress, delay, theme, size }: { progress: SharedValue<number>; delay: number; theme: GamificationTheme; size: number }) {
  const style = useAnimatedStyle(() => {
    const local = Math.min(1, Math.max(0, (progress.get() - delay) / (1 - delay)));
    return {
      opacity: local === 0 || local === 1 ? 0 : 0.55 * (1 - local),
      transform: [{ scale: 0.85 + local * 0.75 }],
    };
  });
  return <Animated.View style={[theme.styles.inkRing, { width: size, height: size, borderRadius: size / 2 }, style]} />;
}
