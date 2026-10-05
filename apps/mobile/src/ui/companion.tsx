import { useFocusEffect } from 'expo-router';
import { useCallback, type ReactNode } from 'react';
import { Image, Pressable, View, type ImageSourcePropType } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';

import { lightHaptic } from '@/gamification/native-effects';
import { useMotionEnabled } from '@/motion/use-motion';
import { playUiSound } from '@/sound/ui-sounds';
import { Mascot } from './mascot';
import { friendArt } from '@/shop/shop-art';
import { AvatarPortrait } from '@/illustration/avatar-portrait';

type Props = {
  art?: ImageSourcePropType;
  size?: number;
  celebrate?: boolean;
  interactive?: boolean;
  characterId?: string | null;
  poseId?: string | null;
  children?: ReactNode;
};

export function Companion(props: Props) {
  const avatar = props.characterId ?? Object.keys(friendArt).find(id => friendArt[id] === props.art);
  const size = props.size ?? 120;
  return avatar ? <View style={{ width: size, height: size }}><AvatarPortrait avatar={avatar} size={size}
    reaction={props.celebrate || props.poseId === 'stack-cheer' ? 'cheer' : 'idle'} interactive={props.interactive} />{props.children}</View>
    : <LegacyCompanion {...props} />;
}

function LegacyCompanion({ art, size = 120, celebrate = false, interactive = false, characterId, poseId, children }: Props) {
  const motion = useMotionEnabled();
  const lift = useSharedValue(0);
  const scale = useSharedValue(1);
  const cheer = poseId === 'stack-cheer';
  const hop = characterId?.includes('rabbit') || characterId?.includes('squirrel');
  const sway = characterId?.includes('cat') || characterId?.includes('raccoon');
  useFocusEffect(useCallback(() => {
    if (motion && art) {
      const duration = cheer ? 650 : hop ? 950 : 1400;
      lift.set(withRepeat(withSequence(withTiming(cheer ? -12 : hop ? -6 : -3, { duration }), withTiming(0, { duration })), -1));
      if (celebrate) scale.set(withSequence(withSpring(1.08), withSpring(1)));
    }
    return () => { cancelAnimation(lift); cancelAnimation(scale); lift.set(0); scale.set(1); };
  }, [art, celebrate, cheer, hop, lift, motion, scale]));
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: lift.get() },
    { rotate: `${cheer ? -7 : sway ? lift.get() * 0.8 : 0}deg` }, { scale: scale.get() }] }));
  if (!art) return <Mascot pose={celebrate ? 'cheer' : 'wave'} size={size} interactive={interactive} />;
  const character = <Animated.View style={[{ width: size, height: size }, style]}>
    <Image source={art} style={{ width: size, height: size }} resizeMode="contain" accessible={false} />
    {children}
  </Animated.View>;
  if (!interactive) return character;
  return <Pressable accessibilityRole="button" accessibilityLabel="내 동행과 인사하기" onPress={() => {
    if (motion) scale.set(withSequence(withSpring(1.13), withSpring(1)));
    void lightHaptic();
    playUiSound('tap');
  }}>{character}</Pressable>;
}
