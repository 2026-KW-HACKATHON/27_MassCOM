import { View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

/** Hand-drawn mascot leaf emblem for the envelope seal — not any reference game's logo or card frame. */
export function LeafSealGlyph({ size, color, ringColor }: { size: number; color: string; ringColor: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={12} cy={12} r={10.5} fill="none" stroke={ringColor} strokeWidth={1.4} />
      <Path d="M12 5c3.8 0 6.6 2.7 6.6 6.4 0 .5-.4 1-1 1-3.6 0-6.4-2.8-6.4-6.4 0-.5.4-1 .8-1z" fill={color} />
      <Path d="M12 5c-3.8 0-6.6 2.7-6.6 6.4 0 .5.4 1 1 1 3.6 0 6.4-2.8 6.4-6.4 0-.5-.4-1-.8-1z" fill={color} opacity={0.75} />
      <Path d="M12 6.6V18" stroke={ringColor} strokeWidth={1.3} strokeLinecap="round" />
    </Svg>
  );
}

/**
 * A plain sealed envelope, drawn flat for this app — not any reference game's pack art: a body, a triangular flap,
 * and the leaf seal where the two meet. `flapOpen` lifts the flap away (used right after the tear completes).
 */
export function EnvelopeBody({ width, height, bodyColor, flapColor, seamColor }: {
  width: number; height: number; bodyColor: string; flapColor: string; seamColor: string;
}) {
  return (
    <Svg width={width} height={height} viewBox="0 0 160 110">
      <Path d="M6 14 h148 a6 6 0 0 1 6 6 v70 a6 6 0 0 1 -6 6 h-148 a6 6 0 0 1 -6 -6 v-70 a6 6 0 0 1 6 -6 z" fill={bodyColor} />
      <Path d="M4 16 a8 8 0 0 1 6 -8 h140 a8 8 0 0 1 6 8 L80 72 Z" fill={flapColor} />
      <Path d="M6 14 L80 70 L154 14" stroke={seamColor} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** The flap alone, peeled back and tilted — laid over EnvelopeBody (rendered without its own flap) once torn. */
export function EnvelopeFlapTorn({ width, height, flapColor }: { width: number; height: number; flapColor: string }) {
  return (
    <View style={{ width, height: height * 0.7, transform: [{ translateY: -height * 0.28 }, { rotate: '-10deg' }], opacity: 0.95 }}>
      <Svg width={width} height={height * 0.6} viewBox="0 0 160 66">
        <Path d="M4 50 a8 8 0 0 1 6 -8 h140 a8 8 0 0 1 6 8 L80 2 Z" fill={flapColor} />
      </Svg>
    </View>
  );
}
