import { Pressable, Text } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { lightHaptic } from '../gamification/native-effects';
import { motion } from '../motion/timing';
import { useMotionEnabled } from '../motion/use-motion';
import { useUiStyles } from './use-ui-styles';

type Props = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
};

// Same dimmed look the other screens use for inactive controls.
const disabledLook = { opacity: 0.45 } as const;

export function BounceButton({ label, onPress, variant = 'primary', disabled }: Props) {
  const styles = useUiStyles();
  const enabled = useMotionEnabled();
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const button = variant === 'primary' ? styles.primaryButton : styles.secondaryButton;
  const text = variant === 'primary' ? styles.primaryButtonText : styles.secondaryButtonText;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPressIn={() => { if (enabled) scale.set(withSpring(motion.pressScale, motion.spring)); }}
      onPressOut={() => { if (enabled) scale.set(withSpring(1, motion.spring)); }}
      onPress={() => { void lightHaptic(); onPress(); }}
    >
      <Animated.View style={[button, disabled ? disabledLook : null, animated]}>
        <Text maxFontSizeMultiplier={1.6} style={text}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}
