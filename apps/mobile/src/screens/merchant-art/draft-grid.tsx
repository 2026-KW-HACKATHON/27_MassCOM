import { useEffect } from 'react';
import { Image, Pressable, Text, View, useColorScheme } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { draftAccessibilityLabel } from '@/merchant-art/art-state';
import type { ArtDraft } from '@/merchant-art/owner-art-api';
import { motion } from '@/motion/timing';
import { useMotionEnabled } from '@/motion/use-motion';
import { colorsForScheme } from '@/theme/palette';

import { useMerchantArtStyles } from './use-merchant-art-styles';

/** The check drawn on a chosen draft: selection is a thick border, this glyph and the word "선택됨", never colour alone. */
function CheckGlyph({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 12 12" fill="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Path d="M2.5 6.5 5 9l4.5-5.5" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

type Props = {
  drafts: readonly ArtDraft[];
  size: number;
  selected: number | null;
  disabled: boolean;
  onSelect: (index: number) => void;
};

/** The four drafts as a 2x2 grid of radio buttons; each reads "AI 시안 N, <스타일> 스타일" with its selected state. */
export function DraftGrid({ drafts, size, selected, disabled, onSelect }: Props) {
  const styles = useMerchantArtStyles();
  return (
    <View accessibilityRole="radiogroup" style={styles.grid}>
      {drafts.map((draft) => (
        <DraftTile key={draft.index} draft={draft} size={size} selected={selected === draft.index} disabled={disabled} onPress={() => onSelect(draft.index)} />
      ))}
    </View>
  );
}

function DraftTile({ draft, size, selected, disabled, onPress }: {
  draft: ArtDraft; size: number; selected: boolean; disabled: boolean; onPress: () => void;
}) {
  const styles = useMerchantArtStyles();
  const palette = colorsForScheme(useColorScheme());
  const enabled = useMotionEnabled();
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  // The chosen draft grows a little; with reduced motion it only gets the border, check and word.
  useEffect(() => {
    scale.set(enabled ? withSpring(selected ? 1.03 : 1, motion.spring) : 1);
  }, [enabled, selected, scale]);

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={draftAccessibilityLabel(draft)}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{ width: size }}
    >
      <Animated.View style={[styles.tile, selected ? styles.tileSelected : null, animated]}>
        <Image
          source={{ uri: draft.imageDataUrl }}
          accessible={false}
          accessibilityIgnoresInvertColors
          resizeMode="cover"
          style={styles.tileImage}
        />
        {selected ? (
          <View accessible={false} style={styles.check}>
            <CheckGlyph color={palette.onPrimary} />
          </View>
        ) : null}
        <View accessible={false} style={styles.tileLabelRow}>
          <Text maxFontSizeMultiplier={1.4} numberOfLines={2} textBreakStrategy="simple" style={[styles.tileLabel, selected ? styles.tileLabelSelected : null]}>
            {selected ? `${draft.label} · 선택됨` : draft.label}
          </Text>
        </View>
      </Animated.View>
    </Pressable>
  );
}
