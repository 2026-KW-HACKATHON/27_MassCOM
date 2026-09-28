import { memo, useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

type Piece = {
  angle: number;
  speed: number;
  spin: number;
  delay: number;
  size: number;
  color: string;
  shape: 'strip' | 'dot' | 'triangle' | 'leaf';
};

const shapes: Piece['shape'][] = ['strip', 'dot', 'triangle', 'leaf'];

/** Deterministic pseudo-random pieces so re-renders never reshuffle the burst. */
function buildPieces(count: number, colors: readonly string[]): Piece[] {
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  return Array.from({ length: count }, (_, index) => ({
    angle: (-172 + random() * 164) * (Math.PI / 180),
    speed: 0.35 + random() * 0.55,
    spin: (random() > 0.5 ? 1 : -1) * (240 + random() * 480),
    delay: random() * 0.1,
    size: 8 + random() * 6,
    color: colors[index % colors.length]!,
    shape: shapes[index % shapes.length]!,
  }));
}

type Props = {
  colors: readonly string[];
  leafColor: string;
  /** Burst origin inside the overlay, in dp. */
  originX: number;
  originY: number;
  /** Overlay size: pieces spread across the width and fall past the bottom. */
  width: number;
  height: number;
  count?: number;
  delay?: number;
  duration?: number;
};

/**
 * Full-screen, non-interactive confetti burst. One shared progress value drives every piece,
 * so the JS thread stays idle; the animation is one-shot (no loops).
 */
export const ConfettiBurst = memo(function ConfettiBurst({
  colors, leafColor, originX, originY, width, height, count = 24, delay = 0, duration = 1600,
}: Props) {
  const progress = useSharedValue(0);
  const pieces = useMemo(() => buildPieces(count, colors), [count, colors]);

  useEffect(() => {
    progress.set(0);
    progress.set(withDelay(delay, withTiming(1, { duration, easing: Easing.linear })));
  }, [delay, duration, progress]);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} accessible={false} importantForAccessibility="no-hide-descendants">
      {pieces.map((piece, index) => (
        <ConfettiPiece
          key={index}
          piece={piece}
          progress={progress}
          leafColor={leafColor}
          originX={originX}
          originY={originY}
          reach={width * 0.62}
          fall={height * 0.95}
        />
      ))}
    </View>
  );
});

function ConfettiPiece({ piece, progress, leafColor, originX, originY, reach, fall }: {
  piece: Piece;
  progress: SharedValue<number>;
  leafColor: string;
  originX: number;
  originY: number;
  reach: number;
  fall: number;
}) {
  const style = useAnimatedStyle(() => {
    const local = Math.min(1, Math.max(0, (progress.get() - piece.delay) / (1 - piece.delay)));
    // Fast outward burst that slows down, then gravity takes over.
    const travel = 1 - (1 - local) * (1 - local);
    const x = Math.cos(piece.angle) * piece.speed * reach * travel;
    const y = Math.sin(piece.angle) * piece.speed * reach * 0.8 * travel + fall * local * local;
    return {
      opacity: local === 0 ? 0 : local > 0.8 ? (1 - local) / 0.2 : 1,
      transform: [
        { translateX: x },
        { translateY: y },
        { rotate: `${piece.spin * local}deg` },
        { scale: Math.min(1, local * 8) },
      ],
    };
  });
  const color = piece.shape === 'leaf' ? leafColor : piece.color;
  return (
    <Animated.View style={[{ position: 'absolute', left: originX - piece.size / 2, top: originY - piece.size / 2 }, style]}>
      {piece.shape === 'strip' ? (
        <View style={{ width: piece.size * 1.4, height: piece.size * 0.55, borderRadius: 2, backgroundColor: color }} />
      ) : piece.shape === 'dot' ? (
        <View style={{ width: piece.size * 0.8, height: piece.size * 0.8, borderRadius: piece.size, backgroundColor: color }} />
      ) : (
        <Svg width={piece.size * 1.2} height={piece.size * 1.2} viewBox="0 0 12 12">
          <Path
            d={piece.shape === 'triangle' ? 'M6 1 L11 11 L1 11 Z' : 'M1 11 C1 4 5 1 11 1 C11 7 8 11 1 11 Z'}
            fill={color}
          />
        </Svg>
      )}
    </Animated.View>
  );
}
