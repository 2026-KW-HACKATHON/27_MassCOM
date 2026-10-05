import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Pressable, View } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import type { DisplayExperienceProfile } from '@/experience/experience-api';
import { AvatarEquipment } from '@/experience/avatar-equipment';
import { lightHaptic } from '@/gamification/native-effects';
import { useMotionEnabled } from '@/motion/use-motion';
import { playUiSound } from '@/sound/ui-sounds';
import { equippedFrame, type CharacterFrame } from './art-catalog';
import { CharacterArt } from './character-art';

type Props = { avatar: string | null; profile?: DisplayExperienceProfile; size: number; reaction?: CharacterFrame;
  interactive?: boolean; animated?: boolean; onLoad?: () => void; onError?: () => void };

function AvatarLayers({ avatar, profile, size, frame, onLoad, onError }: Props & { frame: 0 | 1 | 2 | 3 }) {
  const seen = useRef(new Set<string>());
  const required = ['character', ...(['hat', 'bag', 'prop'] as const).filter(slot => avatar && profile?.cosmetics[slot])];
  const loaded = (key: string) => {
    seen.current.add(key);
    if (required.every(entry => seen.current.has(entry))) onLoad?.();
  };
  return <>
    <AvatarEquipment avatar={avatar} equipment={profile} size={size} frame={frame} layer="back" onLoad={loaded} onError={onError} />
    <CharacterArt avatar={avatar} frame={frame} size={size} onLoad={() => loaded('character')} onError={onError} />
    <AvatarEquipment avatar={avatar} equipment={profile} size={size} frame={frame} layer="front" onLoad={loaded} onError={onError} />
  </>;
}

export function AvatarPortrait({ avatar, profile, size, reaction = 'idle', interactive = false,
  animated = true, onLoad, onError }: Props) {
  const motion = useMotionEnabled();
  const [greeting, setGreeting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const breathing = useSharedValue(1);
  const frame = equippedFrame(profile?.cosmetics.pose, greeting ? 'wave' : reaction);
  const figureSize = profile?.cosmetics.hat ? size * .90 : size;
  const assetKey = [avatar, profile?.cosmetics.hat, profile?.cosmetics.bag, profile?.cosmetics.prop].join(':');
  useFocusEffect(useCallback(() => {
    if (motion && animated) breathing.set(withRepeat(withSequence(withTiming(1.012, { duration: 2400 }), withTiming(1, { duration: 2400 })), -1));
    return () => { cancelAnimation(breathing); breathing.set(1); if (timer.current) clearTimeout(timer.current); setGreeting(false); };
  }, [animated, breathing, motion]));
  const style = useAnimatedStyle(() => ({ transform: [{ scale: breathing.get() }] }));
  const portrait = <Animated.View style={[{ width: size, height: size }, style]}>
    <View style={{ position: 'absolute', top: size - figureSize, left: (size - figureSize) / 2 }}>
      <AvatarLayers key={assetKey} avatar={avatar} profile={profile} size={figureSize} frame={frame} onLoad={onLoad} onError={onError} />
    </View>
  </Animated.View>;
  return interactive ? <Pressable accessibilityRole="button" accessibilityLabel="동행과 인사하기" onPress={() => {
    if (timer.current) clearTimeout(timer.current);
    setGreeting(true); timer.current = setTimeout(() => setGreeting(false), 1300);
    void lightHaptic(); playUiSound('tap');
  }}>{portrait}</Pressable> : <View accessibilityRole="image" accessibilityLabel={frame === 2 ? '기뻐하는 동행' : frame === 3 ? '다시 도전하는 동행' : frame === 1 ? '인사하는 동행' : '나의 동행'}>{portrait}</View>;
}
