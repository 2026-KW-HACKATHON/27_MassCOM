import { useEffect } from 'react';
import { Image, StyleSheet, View, type ImageSourcePropType, type StyleProp, type ViewStyle } from 'react-native';

export type StampVideoProps = {
  source: ImageSourcePropType;
  posterSource: ImageSourcePropType;
  playing: boolean;
  loop: boolean;
  muted: boolean;
  volume: number;
  style?: StyleProp<ViewStyle>;
  onReady?: () => void;
  onEnded?: () => void;
  onError?: (error: unknown) => void;
};

export function StampVideo({ posterSource, playing, loop, style, onReady, onError }: StampVideoProps) {
  useEffect(() => {
    onReady?.();
    if (playing && !loop) onError?.(new Error('STAMP_VIDEO_UNSUPPORTED_PLATFORM'));
  }, [loop, onError, onReady, playing]);

  return <View style={[styles.frame, style]}><Image source={posterSource} resizeMode="contain" style={styles.poster} /></View>;
}

const styles = StyleSheet.create({
  frame: { width: '100%', height: '100%', backgroundColor: '#000000' },
  poster: { width: '100%', height: '100%' },
});
