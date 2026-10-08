import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Platform, Pressable } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { motion } from '../motion/timing';
import { useMotionEnabled } from '../motion/use-motion';
import { mascotArt, type MascotPose } from './mascot-art';
import { mascotAccessibility } from './mascot-a11y';

type Props = {
  pose: MascotPose;
  size: number;
  breathe?: boolean;
  accessibilityLabel?: string;
  /** 웹에서만 라벨을 버리고 장식으로 둔다(탭 순서·접근성 트리에서 뺀다). 네이티브는 라벨과 "눌러서 흔들기" 버튼 그대로다. */
  decorativeOnWeb?: boolean;
  /** Wiggles when tapped. Only for a hero that stands on its own; a mascot inside a card stays a plain image. */
  interactive?: boolean;
};

export function Mascot({ pose, size, breathe = true, accessibilityLabel: labelProp, decorativeOnWeb = false, interactive = false }: Props) {
  const accessibilityLabel = Platform.OS === 'web' && decorativeOnWeb ? undefined : labelProp;
  const enabled = useMotionEnabled();
  const scale = useSharedValue(1);
  const rotate = useSharedValue(0);
  useFocusEffect(useCallback(() => {
    if (enabled && breathe) scale.set(withRepeat(withTiming(1.03, { duration: motion.breatheMs / 2, easing: Easing.inOut(Easing.sin) }), -1, true));
    return () => { cancelAnimation(scale); cancelAnimation(rotate); scale.set(1); rotate.set(0); };
  }, [enabled, breathe, scale, rotate]));
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }, { rotate: `${rotate.value}deg` }] }));
  const wiggle = () => {
    if (!enabled) return;
    rotate.set(withSequence(withTiming(-6, { duration: 90 }), withTiming(6, { duration: 120 }), withTiming(0, { duration: 90 })));
  };
  // 웹: react-native-web Pressable은 tabIndex 0이다. 라벨 없는 장식 마스코트는 탭 순서에서 빼고 접근성 트리에서도 숨긴다.
  const webDecoration = Platform.OS === 'web' && !accessibilityLabel ? ({ tabIndex: -1, 'aria-hidden': true } as const) : undefined;
  const a11y = { ...mascotAccessibility(accessibilityLabel, interactive), ...webDecoration };
  const picture = { source: mascotArt[pose], style: [{ width: size, height: size }, animated], resizeMode: 'contain' as const };
  // The accessibility props go on the outermost element so a wrapping Pressable and its picture read as one item.
  if (!interactive) return <Animated.Image {...picture} {...a11y} />;
  return <Pressable onPress={wiggle} {...a11y}><Animated.Image {...picture} /></Pressable>;
}
