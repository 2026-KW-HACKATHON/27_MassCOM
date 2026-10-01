import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type AccessibilityState, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { lightHaptic } from '../gamification/native-effects';
import { motion } from '../motion/timing';
import { useMotionEnabled } from '../motion/use-motion';
import { splitCardStyle } from './card-style';
import { useUiStyles } from './use-ui-styles';

type Props = {
  onPress?: () => void;
  accessibilityLabel?: string;
  /** What a tap does ("자세히 보기"), kept out of the label so the label can read the card's own content. */
  accessibilityHint?: string;
  /** e.g. `{ expanded }` for a disclosure card (#296 review: expanded state must reach assistive tech, not just the label text). */
  accessibilityState?: AccessibilityState;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
};

// Fills the Pressable when it is taller than the card's content, as a static card would fill its own slot.
const fillWrapper = { flexGrow: 1 } as const;

/** White card floating over the sky. Shrinks slightly, tints while pressed and gives a light haptic when pressable. */
export function FloatingCard({ onPress, accessibilityLabel, accessibilityHint, accessibilityState, style, children }: Props) {
  const styles = useUiStyles();
  const enabled = useMotionEnabled();
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  // Flatten so a Slot/Link parent never receives a style array (#216).
  const flat = StyleSheet.flatten(style);

  // The dark card's top highlight is skipped for a card that draws its own border (the dashed claim panels).
  const edge = flat?.borderWidth === undefined && flat?.borderTopWidth === undefined ? styles.cardEdge : null;

  if (!onPress) return <View style={StyleSheet.flatten([styles.card, edge, flat])}>{children}</View>;

  // Where the card sits (margin, flex, width, position…) belongs on the Pressable so it lays out like the static card above.
  const { outer, inner } = splitCardStyle(flat);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={accessibilityState}
      onPressIn={() => { if (enabled) scale.set(withSpring(motion.pressScale, motion.spring)); }}
      onPressOut={() => { if (enabled) scale.set(withSpring(1, motion.spring)); }}
      onPress={() => { void lightHaptic(); onPress(); }}
      style={outer}
    >
      {({ pressed }) => (
        <Animated.View style={[styles.card, edge, inner, fillWrapper, pressed ? styles.cardPressed : null, animated]}>{children}</Animated.View>
      )}
    </Pressable>
  );
}
