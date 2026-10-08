import { useId, useMemo } from 'react';
import Animated, { useAnimatedProps, useDerivedValue, type SharedValue } from 'react-native-reanimated';
import Svg, { Defs, G, LinearGradient, Mask, Path, Rect, Stop } from 'react-native-svg';

import type { CollectibleEffect } from '../../commerce/collectible-artwork';

import { collectibleFlameAnchors, collectibleFlameFrameForAnchors, collectibleFlamePath, effectSpeedValue, effectStrengthValue, type FlameTongue } from './collectible-aura';
import { CollectibleFaceOutline } from './collectible-default-back';

const AnimatedGradient = Animated.createAnimatedComponent(LinearGradient);
const AnimatedPath = Animated.createAnimatedComponent(Path);

type Props = {
  effects?: readonly CollectibleEffect[];
  shape: string;
  size: number;
  faceSize: number;
  horizontal: number;
  angle: SharedValue<number>;
  clock: SharedValue<number>;
};

type FlameVisual = FlameTongue & { d: string };

function Flame({ index, frame, color }: { index: number; frame: SharedValue<FlameVisual[]>; color: string }) {
  const gradientId = `flame-${useId().replace(/:/g, '')}`;
  const gradientProps = useAnimatedProps(() => {
    const tongue = frame.get()[index];
    if (!tongue) return { x1: 0, y1: 0, x2: 0, y2: -1 };
    return { x1: tongue.x, y1: tongue.y, x2: tongue.tipX, y2: tongue.tipY };
  });
  const pathProps = useAnimatedProps(() => {
    const tongue = frame.get()[index];
    if (!tongue) return { d: '', opacity: 0 };
    return { d: tongue.d, opacity: tongue.alpha };
  });
  return <>
    <Defs><AnimatedGradient id={gradientId} animatedProps={gradientProps} gradientUnits="userSpaceOnUse">
      <Stop offset={0} stopColor={color} stopOpacity={0} />
      <Stop offset={.42} stopColor={color} />
      <Stop offset={1} stopColor="white" stopOpacity={.85} />
    </AnimatedGradient></Defs>
    <AnimatedPath animatedProps={pathProps} fill={`url(#${gradientId})`} />
  </>;
}

function FlameAura({ effect, shape, faceSize, angle, clock }: Pick<Props, 'shape' | 'faceSize' | 'angle' | 'clock'> & { effect: CollectibleEffect }) {
  const anchors = useMemo(() => collectibleFlameAnchors(shape, faceSize), [shape, faceSize]);
  const strength = effectStrengthValue(effect);
  const speed = effectSpeedValue(effect);
  const color = effect.color || '#5dd8ff';
  // Derive geometry and SVG paths once on the UI thread; animated props only read shared frame data.
  const frame = useDerivedValue(() => collectibleFlameFrameForAnchors(anchors, faceSize, angle.get(), clock.get(), speed, strength)
    .map(tongue => ({ ...tongue, d: collectibleFlamePath(tongue) })));
  return <>
    {/* Soft concentric strokes provide a glow without another raster asset or a filter dependency. */}
    <G scale={faceSize * 1.03 / 100} x={-faceSize * .515} y={-faceSize * .515}>
      <G opacity={.08 * strength / 100}><CollectibleFaceOutline shape={shape} fill="none" stroke={color} strokeWidth={5.6} /></G>
      <G opacity={.22 * strength / 100}><CollectibleFaceOutline shape={shape} fill="none" stroke={color} strokeWidth={2.8} /></G>
    </G>
    {anchors.map((anchor, index) => <Flame key={anchor.slot} index={index} frame={frame} color={color} />)}
  </>;
}

/** Only runtime aura is layered; the other saved material effects are already baked into the face. */
export function CollectibleAuraLayer({ effects, shape, size, faceSize, horizontal, angle, clock }: Props) {
  const maskId = `aura-outline-${useId().replace(/:/g, '')}`;
  const flames = effects?.filter(effect => effect.type === 'flame' && effect.target === 'aura' && effectStrengthValue(effect) > 0) ?? [];
  if (!flames.length) return null;
  const center = size / 2;
  return <Svg pointerEvents="none" accessible={false} width={size} height={size} style={{ position: 'absolute', left: 0, top: 0 }}>
    <Defs><Mask id={maskId} maskType="luminance" x={0} y={0} width={size} height={size} maskUnits="userSpaceOnUse">
      <Rect width={size} height={size} fill="white" />
      <G matrix={[horizontal, 0, 0, 1, center, center]}>
        <G scale={faceSize / 100} x={-faceSize / 2} y={-faceSize / 2}>
          <CollectibleFaceOutline shape={shape} fill="black" />
        </G>
      </G>
    </Mask></Defs>
    <G mask={`url(#${maskId})`}>
      <G matrix={[horizontal, 0, 0, 1, center, center]}>
        {flames.map((effect, index) => <FlameAura key={index} effect={effect} shape={shape} faceSize={faceSize} angle={angle} clock={clock} />)}
      </G>
    </G>
  </Svg>;
}
