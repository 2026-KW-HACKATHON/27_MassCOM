import type { Ref } from 'react';
import { Image, Pressable, Text, View, useColorScheme } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { lightHaptic } from '@/gamification/native-effects';
import { useArtFallback } from '@/merchant-art/use-art-fallback';
import { motion } from '@/motion/timing';
import { useMotionEnabled } from '@/motion/use-motion';
import { worldForScheme } from '@/theme/world';

import { merchantArtSource } from '../collection/merchant-art';
import { PIN_TOUCH } from './layout';
import type { TownPin } from './town-pins';
import { useTownMapStyles } from './use-town-map-styles';

/** The check drawn on the "stamp received" badge and in the legend. */
export function CheckMark({ color, size }: { color: string; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 12 12" fill="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Path d="M2.5 6.5 5 9l4.5-5.5" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

type Props = {
  pin: TownPin;
  /** Centre of the pin inside the drawn map, in dp. */
  x: number;
  y: number;
  selected: boolean;
  onPress: () => void;
  apiUrl: string;
  /** Lets the screen hand screen reader focus back to this pin when its card closes. */
  pressableRef?: Ref<View>;
};

/**
 * A shop on the map: a 44dp round mark inside a 48dp touch target. Visited shops get a solid double ring and a check badge (like
 * an ink stamp), the rest a dashed ring, so the state never depends on colour. The mark shows the shop's illustration in the demo
 * app or the owner's AI picture (both through the merchant-art bridge) or the same short glyph as its passport stamp.
 */
export function TownPinButton({ pin, x, y, selected, onPress, apiUrl, pressableRef }: Props) {
  const styles = useTownMapStyles();
  const world = worldForScheme(useColorScheme());
  const enabled = useMotionEnabled();
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  // A picture that fails to load (a stale catalog pointing at art that was reset) falls back to the glyph.
  const { source: art, onError } = useArtFallback(merchantArtSource({ id: pin.merchantId, artUrl: pin.artUrl }, apiUrl));
  const visited = pin.status === 'visited';
  return (
    <Pressable
      ref={pressableRef}
      accessibilityRole="button"
      accessibilityLabel={pin.label}
      accessibilityHint="가게 카드 열기"
      accessibilityState={{ selected }}
      onPressIn={() => { if (enabled) scale.set(withSpring(motion.pressScale, motion.spring)); }}
      onPressOut={() => { if (enabled) scale.set(withSpring(1, motion.spring)); }}
      onPress={() => { void lightHaptic(); onPress(); }}
      style={[styles.pinTouch, { left: x - PIN_TOUCH / 2, top: y - PIN_TOUCH / 2 }]}
    >
      {({ pressed }) => (
        <>
          {selected ? <View pointerEvents="none" accessible={false} style={styles.pinHalo} /> : null}
          <Animated.View
            accessible={false}
            style={[styles.pinDisc, visited ? styles.pinDiscVisited : styles.pinDiscNone, pressed ? styles.pinDiscPressed : null, animated]}
          >
            {visited ? (
              <View style={styles.pinInnerRing}>
                {art ? (
                  <Image source={art} onError={onError} accessible={false} accessibilityIgnoresInvertColors resizeMode="cover" style={styles.pinArt} />
                ) : (
                  <Text maxFontSizeMultiplier={1.2} style={styles.pinGlyphVisited}>{pin.glyph}</Text>
                )}
              </View>
            ) : art ? (
              <Image source={art} onError={onError} accessible={false} accessibilityIgnoresInvertColors resizeMode="cover" style={styles.pinArtNone} />
            ) : (
              <Text maxFontSizeMultiplier={1.2} style={styles.pinGlyphNone}>{pin.glyph}</Text>
            )}
          </Animated.View>
          {visited ? (
            <View accessible={false} style={styles.pinCheck}>
              <CheckMark color={world.paper} size={11} />
            </View>
          ) : null}
        </>
      )}
    </Pressable>
  );
}
