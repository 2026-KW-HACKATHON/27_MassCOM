import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { lightHaptic } from '../gamification/native-effects';
import { motion } from '../motion/timing';
import { useMotionEnabled } from '../motion/use-motion';
import { useUiStyles } from './use-ui-styles';

type Props = {
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
};

/** White card floating over the sky. Shrinks slightly and gives a light haptic when pressable. */
export function FloatingCard({ onPress, accessibilityLabel, style, children }: Props) {
  const styles = useUiStyles();
  const enabled = useMotionEnabled();
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  // Flatten so a Slot/Link parent never receives a style array (#216).
  const card = StyleSheet.flatten([styles.card, style]);

  if (!onPress) return <View style={card}>{children}</View>;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPressIn={() => { if (enabled) scale.set(withSpring(motion.pressScale, motion.spring)); }}
      onPressOut={() => { if (enabled) scale.set(withSpring(1, motion.spring)); }}
      onPress={() => { void lightHaptic(); onPress(); }}
    >
      <Animated.View style={[card, animated]}>{children}</Animated.View>
    </Pressable>
  );
}
