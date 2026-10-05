import { Image, View, type ImageSourcePropType, type StyleProp, type ViewStyle } from 'react-native';
export type ArtProps = { size: number; onLoad?: () => void; onError?: () => void; style?: StyleProp<ViewStyle> };
/** Clip each cell in the view while preserving the original illustrated alpha. */
export function AtlasImage({ source, columns, rows, frame, size, onLoad, onError, style }: ArtProps & {
  source: ImageSourcePropType; columns: number; rows: number; frame: number;
}) {
  return <View pointerEvents="none" style={[{ width: size, height: size, overflow: 'hidden' }, style]}>
    <Image source={source} resizeMode="stretch" accessible={false} onLoad={onLoad} onError={onError}
      style={{ position: 'absolute', width: size * columns, height: size * rows,
        left: -(frame % columns) * size, top: -Math.floor(frame / columns) * size }} />
  </View>;
}
