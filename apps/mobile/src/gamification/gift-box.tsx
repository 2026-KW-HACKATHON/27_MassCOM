import { useEffect, useId, useImperativeHandle, type Ref } from 'react';
import { View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import type { MedalColors } from '@/theme/medal-colors';

import type { RewardMilestone } from './badge-api';

export type GiftBoxMood = 'locked' | 'ready' | 'unavailable' | 'opened';

export type GiftBoxHandle = {
  /** Wobble while the server decides. */
  shake: () => void;
  /** Lid pops off; resolves once the pop reads on screen. */
  pop: () => Promise<void>;
  /** Back to rest after a failed open. */
  settle: () => void;
};

type Props = {
  milestone: RewardMilestone;
  mood: GiftBoxMood;
  size: number;
  colors: MedalColors;
  glowColor: string;
  ref?: Ref<GiftBoxHandle>;
};

/** Code-drawn gift box (100×100 art space). Decorative; the card around it carries the text. */
export function GiftBox({ milestone, mood, size, colors, glowColor, ref }: Props) {
  const reduceMotion = useReducedMotion();
  const id = `gift${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const pulse = useSharedValue(1);
  const glow = useSharedValue(mood === 'ready' ? 0.5 : 0);
  const tilt = useSharedValue(0);
  const lidLift = useSharedValue(0);
  const lidTilt = useSharedValue(0);

  useEffect(() => {
    lidLift.set(0);
    lidTilt.set(0);
    if (mood !== 'ready' || reduceMotion) {
      cancelAnimation(pulse);
      cancelAnimation(glow);
      pulse.set(1);
      glow.set(mood === 'ready' ? 0.55 : 0);
      return;
    }
    // Three gentle breaths, then a steady glow: no endless animation (battery, UI idle for tests).
    const ease = Easing.inOut(Easing.sin);
    pulse.set(withRepeat(withSequence(withTiming(1.05, { duration: 750, easing: ease }), withTiming(1, { duration: 750, easing: ease })), 3));
    glow.set(withSequence(
      withRepeat(withSequence(withTiming(0.85, { duration: 750, easing: ease }), withTiming(0.35, { duration: 750, easing: ease })), 3),
      withTiming(0.6, { duration: 400 }),
    ));
    return () => {
      cancelAnimation(pulse);
      cancelAnimation(glow);
    };
  }, [mood, reduceMotion, pulse, glow, lidLift, lidTilt]);

  useImperativeHandle(ref, () => ({
    shake() {
      if (reduceMotion) return;
      cancelAnimation(pulse);
      pulse.set(withTiming(1.06, { duration: 120 }));
      tilt.set(withRepeat(withSequence(
        withTiming(-8, { duration: 70 }),
        withTiming(8, { duration: 140 }),
        withTiming(0, { duration: 70 }),
      ), -1));
    },
    pop() {
      cancelAnimation(tilt);
      tilt.set(withTiming(0, { duration: 80 }));
      if (reduceMotion) return Promise.resolve();
      pulse.set(withSequence(withTiming(0.94, { duration: 90 }), withSpring(1, { damping: 8, stiffness: 220 })));
      lidLift.set(withSpring(-size * 0.42, { damping: 9, stiffness: 170 }));
      lidTilt.set(withSpring(-26, { damping: 10, stiffness: 160 }));
      glow.set(withSequence(withTiming(1, { duration: 120 }), withTiming(0.4, { duration: 500 })));
      return new Promise((resolve) => setTimeout(resolve, 520));
    },
    settle() {
      cancelAnimation(tilt);
      tilt.set(withTiming(0, { duration: 120 }));
      pulse.set(withTiming(1, { duration: 120 }));
    },
  }), [reduceMotion, pulse, tilt, lidLift, lidTilt, glow, size]);

  const boxStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.get() }, { rotate: `${tilt.get()}deg` }],
  }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.get() * 0.45, transform: [{ scale: 0.8 + glow.get() * 0.25 }] }));
  const lidStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: lidLift.get() }, { translateX: lidLift.get() * 0.25 }, { rotate: `${lidTilt.get()}deg` }],
  }));

  const locked = mood === 'locked';
  const opened = mood === 'opened';
  const golden = milestone === 3;
  const paper = locked ? colors.lockedFill : golden ? colors.giftGold : colors.giftPaper;
  const paperShade = locked ? colors.lockedEdge : golden ? colors.giftGoldShade : colors.giftPaperShade;
  const ribbon = locked ? colors.lockedEdge : colors.ribbon;
  const ribbonShade = locked ? colors.lockedEdge : colors.ribbonShade;

  return (
    <View style={{ width: size, height: size }} accessible={false} importantForAccessibility="no-hide-descendants">
      <Animated.View
        pointerEvents="none"
        style={[
          { position: 'absolute', left: size * 0.04, top: size * 0.08, width: size * 0.92, height: size * 0.92, borderRadius: size * 0.46, backgroundColor: glowColor },
          glowStyle,
        ]}
      />
      <Animated.View style={[{ width: size, height: size }, boxStyle]}>
        <Svg width={size} height={size} viewBox="0 0 100 100" style={{ position: 'absolute' }}>
          <Defs>
            <LinearGradient id={`${id}body`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={paper} />
              <Stop offset="1" stopColor={paperShade} stopOpacity={locked ? 0.35 : 1} />
            </LinearGradient>
          </Defs>
          <Ellipse cx={50} cy={93} rx={34} ry={4} fill="#000000" opacity={0.1} />
          {opened ? (
            <G>
              <Rect x={30} y={30} width={40} height={26} rx={3} fill="#FFFFFF" stroke={paperShade} strokeWidth={1.5} transform="rotate(-8 50 43)" />
              <Path d="M36 38h20M36 44h14" stroke={colors.ribbon} strokeWidth={2.4} strokeLinecap="round" transform="rotate(-8 50 43)" />
              <Circle cx={31} cy={43} r={3} fill={paper} transform="rotate(-8 50 43)" />
              <Circle cx={69} cy={43} r={3} fill={paper} transform="rotate(-8 50 43)" />
            </G>
          ) : null}
          <Rect x={16} y={46} width={68} height={44} rx={6} fill={`url(#${id}body)`} />
          <Rect x={16} y={46} width={68} height={7} fill={paperShade} opacity={0.35} />
          <Rect x={44} y={46} width={12} height={44} fill={ribbon} />
          <Rect x={44} y={46} width={3} height={44} fill={ribbonShade} opacity={0.5} />
          {locked ? (
            <G>
              <Rect x={40} y={62} width={20} height={16} rx={3} fill="#FFFFFF" stroke={colors.lockedEdge} strokeWidth={2} />
              <Path d="M44 62v-4a6 6 0 0 1 12 0v4" stroke="#FFFFFF" strokeWidth={5} fill="none" />
              <Path d="M44 62v-4a6 6 0 0 1 12 0v4" stroke={colors.lockedEdge} strokeWidth={2} fill="none" />
              <Circle cx={50} cy={69} r={2} fill={colors.lockedEdge} />
            </G>
          ) : null}
          {opened ? (
            <G>
              <Path d="M86 20l1.6 4 4 1.6-4 1.6-1.6 4-1.6-4-4-1.6 4-1.6z" fill={colors.giftGold} />
              <Path d="M12 26l1.2 3 3 1.2-3 1.2-1.2 3-1.2-3-3-1.2 3-1.2z" fill={colors.ribbon} />
            </G>
          ) : null}
        </Svg>
        <Animated.View style={[{ position: 'absolute', width: size, height: size, transformOrigin: '20% 40%' }, lidStyle]}>
          <Svg width={size} height={size} viewBox="0 0 100 100">
            <G transform={opened ? 'translate(-6 -14) rotate(-22 14 40)' : undefined}>
              <Path d="M50 32c-6-12-20-14-19-5 1 6 12 6 19 5z" fill={ribbon} />
              <Path d="M50 32c6-12 20-14 19-5-1 6-12 6-19 5z" fill={ribbon} />
              <Path d="M50 32c-4-7-12-9-13-5" stroke={ribbonShade} strokeWidth={1.5} fill="none" opacity={0.6} />
              <Rect x={10} y={32} width={80} height={17} rx={5} fill={paper} />
              <Rect x={10} y={44} width={80} height={5} rx={2} fill={paperShade} opacity={locked ? 0.25 : 0.5} />
              <Rect x={44} y={32} width={12} height={17} fill={ribbon} />
              <Circle cx={50} cy={32} r={5} fill={ribbonShade} />
            </G>
          </Svg>
        </Animated.View>
      </Animated.View>
    </View>
  );
}
