import { Image, StyleSheet, Text, View } from 'react-native';

import type { AppColors } from '@/theme/palette';

const mascotStamp = require('../../assets/images/mascot/mascot-stamp.png');

type Props = {
  name: string;
  visited: boolean;
  palette: AppColors;
  size?: number;
};

/**
 * Small circular mark shown next to a merchant name: the approved mascot
 * stamp (D-036) once visited, otherwise a soft initial-letter circle.
 * Purely decorative — the merchant name text next to it already carries
 * the accessible label.
 */
export function MerchantMark({ name, visited, palette, size = 40 }: Props) {
  const dimension = { width: size, height: size, borderRadius: size / 2 };
  if (visited) {
    return (
      <Image
        source={mascotStamp}
        accessible={false}
        accessibilityIgnoresInvertColors
        style={dimension}
      />
    );
  }
  const initial = name.trim().charAt(0) || '?';
  return (
    <View
      accessible={false}
      style={[
        styles.initialCircle,
        dimension,
        { backgroundColor: palette.primaryContainer, borderColor: palette.separator },
      ]}
    >
      <Text style={[styles.initialText, { color: palette.onPrimaryContainer }]}>{initial}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  initialCircle: { alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  initialText: { fontSize: 16, fontWeight: '800' },
});
