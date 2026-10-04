import { memo, useEffect, useId, useMemo } from 'react';
import { Text, View } from 'react-native';
import Animated, { Easing, useAnimatedProps, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, G, LinearGradient, Path, Stop } from 'react-native-svg';

import { tierColors, type MedalColors } from '@/theme/medal-colors';

import type { MedalKind, MedalTier } from './badge-api';
import { MedalGlyph } from './glyphs';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export const medallionSizes = { grid: 84, row: 72, detail: 168, share: 150, chip: 28 } as const;

type Props = {
  kind: MedalKind;
  tier: MedalTier;
  /** 0–1 progress toward the next tier; null hides the outer arc. */
  progress: number | null;
  size: number;
  colors: MedalColors;
  /** Progress arc and track colours (palette.primary / palette.separator). */
  arcColor: string;
  trackColor: string;
  /** Animate the progress arc from empty on mount (off under reduced motion). */
  animateArc?: boolean;
};

/**
 * Compass, rosette and shield silhouettes carry a large achievement mark and tier metal.
 * Unlocked progress stays visible independently of the decorative silhouette.
 * Decorative only — the caller supplies the accessible text.
 */
export const Medallion = memo(function Medallion({ kind, tier, progress, size, colors, arcColor, trackColor, animateArc = false }: Props) {
  const reduceMotion = useReducedMotion();
  const gradientId = `medal${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const earned = tier > 0;
  const metal = earned ? tierColors(colors, tier as 1 | 2 | 3) : null;

  const arcStroke = Math.max(3, size * 0.04);
  const arcRadius = size / 2 - arcStroke / 2;
  const circumference = 2 * Math.PI * arcRadius;
  const rim = size / 2 - arcStroke - size * 0.035;
  const coin = rim * 0.84;
  const window = rim * 0.7;
  const center = size / 2;
  const badgeRadius = Math.max(9, size * 0.13);
  const badgeOffset = rim * 0.74;
  const showStars = size >= 80;

  const scallop = useMemo(() => {
    if (kind === 'regular') return scallopPath(center, rim, size * 0.07, 8);
    if (kind === 'explorer') return `M${center} ${center - rim}L${center + rim * 0.45} ${center - rim * 0.45}L${center + rim} ${center}L${center + rim * 0.45} ${center + rim * 0.45}L${center} ${center + rim}L${center - rim * 0.45} ${center + rim * 0.45}L${center - rim} ${center}L${center - rim * 0.45} ${center - rim * 0.45}Z`;
    return `M${center} ${center - rim}Q${center + rim * 0.55} ${center - rim * 0.85} ${center + rim * 0.86} ${center - rim * 0.45}L${center + rim * 0.74} ${center + rim * 0.4}Q${center + rim * 0.5} ${center + rim * 0.85} ${center} ${center + rim}Q${center - rim * 0.5} ${center + rim * 0.85} ${center - rim * 0.74} ${center + rim * 0.4}L${center - rim * 0.86} ${center - rim * 0.45}Q${center - rim * 0.55} ${center - rim * 0.85} ${center} ${center - rim}Z`;
  }, [center, kind, rim, size]);

  const shown = useSharedValue(animateArc && !reduceMotion ? 0 : 1);
  useEffect(() => {
    if (!animateArc || reduceMotion) {
      shown.set(1);
      return;
    }
    shown.set(0);
    shown.set(withDelay(180, withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) })));
  }, [animateArc, reduceMotion, progress, shown]);

  const fraction = progress === null ? 0 : Math.min(1, Math.max(0, progress));
  const arcProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - fraction * shown.get()),
  }));
  const arcTint = tier === 3 && metal ? metal.base : arcColor;

  return (
    <View style={{ width: size, height: size }} accessible={false} importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Defs>
          {metal ? (
            <>
              <LinearGradient id={`${gradientId}rim`} x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor={metal.highlight} />
                <Stop offset="0.5" stopColor={metal.base} />
                <Stop offset="1" stopColor={metal.shade} />
              </LinearGradient>
              <LinearGradient id={`${gradientId}coin`} x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor={metal.shade} />
                <Stop offset="0.55" stopColor={metal.base} />
                <Stop offset="1" stopColor={metal.highlight} />
              </LinearGradient>
            </>
          ) : null}
        </Defs>

        {progress !== null ? (
          <G rotation={-90} origin={`${center}, ${center}`}>
            <Circle cx={center} cy={center} r={arcRadius} stroke={trackColor} strokeWidth={arcStroke} fill="none" />
            <AnimatedCircle
              cx={center}
              cy={center}
              r={arcRadius}
              stroke={arcTint}
              strokeWidth={arcStroke}
              strokeLinecap="round"
              strokeDasharray={`${circumference} ${circumference}`}
              animatedProps={arcProps}
              fill="none"
            />
          </G>
        ) : null}

        {metal ? (
          <>
            <Path d={scallop} fill={`url(#${gradientId}rim)`} stroke={metal.edge} strokeWidth={Math.max(1, size * 0.012)} />
            <Circle cx={center} cy={center} r={coin} fill={`url(#${gradientId}coin)`} />
            <Circle cx={center} cy={center} r={window + size * 0.012} fill="#FFFFFF" stroke={metal.edge} strokeWidth={Math.max(1, size * 0.01)} />
          </>
        ) : (
          <>
            <Circle cx={center} cy={center} r={rim - 1} fill={colors.lockedFill} stroke={colors.lockedEdge} strokeWidth={Math.max(1.5, size * 0.018)} strokeDasharray={`${size * 0.05} ${size * 0.035}`} />
            <Circle cx={center} cy={center} r={window + size * 0.012} fill="#FFFFFF" opacity={0.6} />
          </>
        )}

        {showStars ? [-1, 0, 1].map((slot) => {
          const angle = (-90 + slot * 22) * (Math.PI / 180);
          const radius = (rim + coin) / 2;
          const filled = earned && slot + 2 <= tier;
          return (
            <Path
              key={slot}
              d={starPath(center + Math.cos(angle) * radius, center + Math.sin(angle) * radius, size * 0.042)}
              fill={filled ? '#FFFFFF' : 'none'}
              stroke={metal ? metal.edge : colors.lockedEdge}
              strokeWidth={Math.max(0.8, size * 0.009)}
              opacity={earned ? 1 : 0.7}
            />
          );
        }) : null}
      </Svg>

      <View
        style={{
          position: 'absolute',
          left: center - window,
          top: center - window,
          width: window * 2,
          height: window * 2,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: earned ? 1 : 0.55,
        }}
      ><MedalGlyph kind={kind} size={window * 1.55} color={metal ? metal.shade : colors.lockedEdge} /></View>

      <View
        style={{
          position: 'absolute',
          left: center + badgeOffset - badgeRadius,
          top: center + badgeOffset - badgeRadius,
          width: badgeRadius * 2,
          height: badgeRadius * 2,
          borderRadius: badgeRadius,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: metal ? metal.shade : colors.lockedEdge,
          borderWidth: Math.max(1.5, size * 0.016),
          borderColor: '#FFFFFF',
        }}
      >
        <Text style={{ color: '#FFFFFF', fontWeight: '900', fontSize: badgeRadius * 1.2 }}>{earned ? tier : '?'}</Text>
      </View>
    </View>
  );
});

function scallopPath(center: number, radius: number, depth: number, bumps: number): string {
  const steps = bumps * 8;
  let d = '';
  for (let index = 0; index <= steps; index += 1) {
    const theta = (index / steps) * Math.PI * 2;
    const r = radius - depth * (1 - Math.abs(Math.cos((bumps * theta) / 2)));
    const x = center + r * Math.cos(theta);
    const y = center + r * Math.sin(theta);
    d += `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return `${d}Z`;
}

function starPath(cx: number, cy: number, radius: number): string {
  let d = '';
  for (let index = 0; index < 10; index += 1) {
    const r = index % 2 === 0 ? radius : radius * 0.45;
    const angle = (-90 + index * 36) * (Math.PI / 180);
    d += `${index === 0 ? 'M' : 'L'}${(cx + r * Math.cos(angle)).toFixed(2)} ${(cy + r * Math.sin(angle)).toFixed(2)}`;
  }
  return `${d}Z`;
}
