import { Image, StyleSheet, Text, View, useColorScheme, useWindowDimensions, type ImageSourcePropType } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { uiMetrics } from '../theme/ui-metrics';
import { worldForScheme } from '../theme/world';
import { SEAM_FRACTION } from './sky-art';
import { useUiStyles } from './use-ui-styles';

type Props = {
  source: ImageSourcePropType;
  height: number;
  /** Caption drawn on a pill over the picture (the showcase disclosure). */
  note?: string;
  /** The picture failed to load (an API picture whose address no longer answers): the caller drops it and shows the sky instead. */
  onError?: () => void;
};

/**
 * A store's own picture as a header background, in place of the town sky: the picture, its bottom slice faded into the page
 * colour like the sky art, and an optional caption. Laid over the top of a positioned parent, so it scrolls with the header.
 */
export function StoreArt({ source, height, note, onError }: Props) {
  const styles = useUiStyles();
  const world = worldForScheme(useColorScheme());
  const { width } = useWindowDimensions();
  return (
    <View pointerEvents="none" style={[art.container, { height }]}>
      <Image source={source} onError={onError} accessible={false} accessibilityIgnoresInvertColors resizeMode="cover" style={{ width, height }} />
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="storeSeam" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={world.page} stopOpacity={0} />
            <Stop offset="1" stopColor={world.page} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect y={height * (1 - SEAM_FRACTION)} width={width} height={height * SEAM_FRACTION} fill="url(#storeSeam)" />
      </Svg>
      {note ? (
        <View style={[art.note, { left: uiMetrics.pageInset, bottom: Math.round(height * SEAM_FRACTION) + 4 }]}>
          <View style={styles.artNote}>
            <Text style={styles.artNoteText}>{note}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const art = StyleSheet.create({
  container: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden' },
  note: { position: 'absolute' },
});
