import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Image, Pressable, type ImageSourcePropType } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';

import { lightHaptic } from '@/gamification/native-effects';
import { useMotionEnabled } from '@/motion/use-motion';
import { playUiSound } from '@/sound/ui-sounds';
import { Mascot } from './mascot';

export function Companion({ art, size = 120, celebrate = false, interactive = false }: {
  art?: ImageSourcePropType;
  size?: number;
  celebrate?: boolean;
  interactive?: boolean;
}) {
  const motion = useMotionEnabled();
  const lift = useSharedValue(0);
  const scale = useSharedValue(1);
  useFocusEffect(useCallback(() => {
    if (motion && art) {
      lift.set(withRepeat(withSequence(withTiming(-4, { duration: 1200 }), withTiming(0, { duration: 1200 })), -1));
      if (celebrate) scale.set(withSequence(withSpring(1.08), withSpring(1)));
    }
    return () => { cancelAnimation(lift); cancelAnimation(scale); lift.set(0); scale.set(1); };
  }, [art, celebrate, lift, motion, scale]));
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: lift.get() }, { scale: scale.get() }] }));
  if (!art) return <Mascot pose={celebrate ? 'cheer' : 'wave'} size={size} interactive={interactive} />;
  const character = <Animated.View style={[{ width: size, height: size }, style]}>
    <Image source={art} style={{ width: size, height: size }} resizeMode="contain" accessible={false} />
  </Animated.View>;
  if (!interactive) return character;
  return <Pressable accessibilityRole="button" accessibilityLabel="내 동행과 인사하기" onPress={() => {
    if (motion) scale.set(withSequence(withSpring(1.13), withSpring(1)));
    void lightHaptic();
    playUiSound('tap');
  }}>{character}</Pressable>;
}
