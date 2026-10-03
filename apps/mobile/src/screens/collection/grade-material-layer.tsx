import { useEffect, useId, useState, type ReactNode } from 'react';
import { AppState, View } from 'react-native';
import Animated, { useAnimatedProps, useDerivedValue, useFrameCallback, useSharedValue, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle, Defs, G, Image as SvgImage, Line, LinearGradient, Mask, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { useMotionEnabled } from '@/motion/use-motion';

import { CollectibleFaceOutline } from './collectible-default-back';
import { gradeMaterialPresets, reflectionAt, type GradeMaterial, type ReflectionFrame } from './grade-material';

const AnimatedGradient = Animated.createAnimatedComponent(LinearGradient);
const AnimatedRadialGradient = Animated.createAnimatedComponent(RadialGradient);
const AnimatedGroup = Animated.createAnimatedComponent(G);
const STATIC_TILT = { x: 0, y: 0 };
const STAR_POINTS = [
  [.22, .17], [.78, .2], [.86, .48], [.74, .82], [.29, .84], [.13, .54], [.49, .13], [.48, .89], [.67, .34], [.34, .68],
] as const;

type Props = {
  material: GradeMaterial;
  size: number;
  faceUri?: string;
  /** 각도별 스프라이트를 쓸 때 현재 칸의 알파를 얼굴과 같은 위치로 잘라 전달한다. */
  faceMask?: ReactNode;
  shape: string;
  tilt?: SharedValue<{ x: number; y: number }>;
  clock?: SharedValue<number>;
  variant: 'detail' | 'card' | 'envelope';
  active: boolean;
  intensityScale?: number;
};

type VisualProps = Props & { clock: SharedValue<number>; moving: boolean };

/** 화면에 보이는 카드들이 하나의 UI 스레드 시계를 공유한다. */
export function useGradeMaterialClock(active: boolean): SharedValue<number> {
  const motionEnabled = useMotionEnabled();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const clock = useSharedValue(0);
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => listener.remove();
  }, []);
  const frameCallback = useFrameCallback((frame) => {
    'worklet';
    clock.set((value) => value + Math.min(frame.timeSincePreviousFrame ?? 0, 50));
  }, false);
  useEffect(() => {
    frameCallback.setActive(active && motionEnabled && foreground);
    return () => frameCallback.setActive(false);
  }, [active, motionEnabled, foreground, frameCallback]);
  return clock;
}

function Glint({ index, size, color, material, reflection, opacityScale }: {
  index: number; size: number; color: string; material: GradeMaterial;
  reflection: SharedValue<ReflectionFrame>; opacityScale: number;
}) {
  const [x, y] = STAR_POINTS[index];
  const radius = size * (material === 'prism' ? .029 : .023);
  const animatedProps = useAnimatedProps(() => {
    return { opacity: (reflection.get().glintOpacities[index] ?? 0) * opacityScale };
  });
  const px = x * size;
  const py = y * size;
  return <AnimatedGroup animatedProps={animatedProps}>
    <Path d={`M ${px} ${py - radius * 1.7} Q ${px + radius * .14} ${py - radius * .13} ${px + radius} ${py} Q ${px + radius * .14} ${py + radius * .13} ${px} ${py + radius * 1.7} Q ${px - radius * .14} ${py + radius * .13} ${px - radius} ${py} Q ${px - radius * .14} ${py - radius * .13} ${px} ${py - radius * 1.7} Z`} fill={color} />
    <Circle cx={px} cy={py} r={radius * .25} fill="white" />
  </AnimatedGroup>;
}

function MaterialVisual({ material, size, faceUri, faceMask, shape, tilt, clock, variant, moving, intensityScale = 1 }: VisualProps) {
  const preset = gradeMaterialPresets[material];
  const key = useId().replace(/:/g, '');
  const maskId = `${key}mask`;
  const bandId = `${key}band`;
  const rainbowId = `${key}rainbow`;
  const hotspotId = `${key}hotspot`;
  const lightScale = Math.min(1.4, Math.max(0, intensityScale));
  const variantScale = variant === 'card' ? .72 : variant === 'envelope' ? 1.1 : 1;
  const alpha = Math.min(.56, preset.baseOpacity * variantScale * lightScale);
  const isPrism = material === 'prism';
  const isGold = material === 'gold';
  const vivid = isGold || isPrism;
  const reflection = useDerivedValue(() => {
    const t = moving ? tilt?.get() ?? STATIC_TILT : STATIC_TILT;
    return reflectionAt({ tiltX: t.x, tiltY: t.y, timeMs: moving ? clock.get() : 0, active: moving }, preset);
  });
  const bandProps = useAnimatedProps(() => {
    const light = reflection.get();
    const centerX = light.bandOffset * size;
    const centerY = size * .5;
    const angle = light.bandAngle * Math.PI / 180;
    const nx = Math.cos(angle);
    const ny = Math.sin(angle);
    const half = Math.max(size * .02, preset.bandWidth * size * .5);
    return { x1: centerX - half * nx, y1: centerY - half * ny,
      x2: centerX + half * nx, y2: centerY + half * ny };
  });
  const rainbowProps = useAnimatedProps(() => {
    const start = (reflection.get().rainbowPhase - 1) * size * 1.3;
    return { x1: start, y1: 0, x2: start + size * 2.6, y2: size };
  });
  const hotspotProps = useAnimatedProps(() => {
    const light = reflection.get();
    const cx = light.highlightX * size;
    const cy = light.highlightY * size;
    return { cx, cy, fx: cx, fy: cy };
  });
  const linesProps = useAnimatedProps(() => {
    return { opacity: .08 + .065 * Math.sin(reflection.get().rainbowPhase * Math.PI * 2) };
  });
  const rainbowStops = preset.rainbowStops.length > 0 ? preset.rainbowStops : preset.colors;
  const rainbowColors = [...rainbowStops, ...rainbowStops.slice(1)];
  return <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants"
    style={{ position: 'absolute', width: size, height: size, left: 0, top: 0 }}>
    <Svg pointerEvents="none" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Defs>
        <Mask id={maskId} maskType="alpha">
          {faceMask ?? (faceUri ? <SvgImage href={{ uri: faceUri }} width={size} height={size} preserveAspectRatio="xMidYMid meet" />
            : <G scale={size / 100}><CollectibleFaceOutline shape={shape} fill="white" /></G>)}
        </Mask>
        <AnimatedGradient id={bandId} animatedProps={bandProps} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={isPrism ? '#76dff9' : preset.tint} stopOpacity="0" />
          <Stop offset=".29" stopColor={isGold ? '#d59431' : '#cdeafb'} stopOpacity={isGold ? .17 : .11} />
          <Stop offset=".46" stopColor="white" stopOpacity={vivid ? .02 : .0} />
          <Stop offset=".5" stopColor="white" stopOpacity={vivid ? .89 : .54} />
          <Stop offset=".54" stopColor="white" stopOpacity={vivid ? .14 : .04} />
          <Stop offset=".72" stopColor={isGold ? '#ffcc57' : '#a4d7ec'} stopOpacity={isGold ? .27 : .14} />
          <Stop offset="1" stopColor={preset.tint} stopOpacity="0" />
        </AnimatedGradient>
        <AnimatedGradient id={rainbowId} animatedProps={rainbowProps} gradientUnits="userSpaceOnUse">
          {rainbowColors.map((color, index) => <Stop key={index} offset={index / (rainbowColors.length - 1)} stopColor={color} />)}
        </AnimatedGradient>
        <AnimatedRadialGradient id={hotspotId} animatedProps={hotspotProps} r={size * .52} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={isGold ? '#fff6c2' : '#ffffff'} stopOpacity={vivid ? .36 : .16} />
          <Stop offset="1" stopColor={preset.tint} stopOpacity="0" />
        </AnimatedRadialGradient>
      </Defs>
      <G mask={`url(#${maskId})`}>
        <Rect width={size} height={size} fill={preset.tint} opacity={alpha * (isPrism ? .1 : isGold ? .45 : .05)} />
        {isPrism ? <Rect width={size} height={size} fill={`url(#${rainbowId})`} opacity={alpha * .95} /> : null}
        {vivid ? <Rect width={size} height={size} fill={`url(#${hotspotId})`} opacity={alpha} /> : null}
        {isPrism ? <AnimatedGroup animatedProps={linesProps}>
          {Array.from({ length: 28 }, (_, index) => <Line key={index} x1={-size + index * size / 16} y1={0}
            x2={index * size / 16} y2={size} stroke={index % 2 ? '#e9fcff' : '#f9e5ff'} strokeWidth={size * .003} />)}
        </AnimatedGroup> : null}
        <Rect width={size} height={size} fill={`url(#${bandId})`} opacity={Math.min(.75, alpha * (isGold ? 1.8 : isPrism ? 1.3 : .85))} />
        {vivid && variant !== 'card' ? Array.from({ length: Math.min(preset.glintCount, STAR_POINTS.length) }, (_, index) =>
          <Glint key={index} index={index} size={size} color={isGold ? '#fff2b9' : index % 2 ? '#fff1ff' : '#dcffff'}
            material={material} reflection={reflection} opacityScale={lightScale * variantScale} />) : null}
      </G>
    </Svg>
  </View>;
}

function AutonomousLayer(props: Props & { moving: boolean }) {
  const clock = useGradeMaterialClock(props.moving);
  return <MaterialVisual {...props} clock={clock} />;
}

function StaticLayer(props: Props & { moving: boolean }) {
  const clock = useSharedValue(0);
  return <MaterialVisual {...props} clock={clock} />;
}

/** 사진 알파 또는 수집품 윤곽 안에서만 등급별 반사광을 그린다. */
export function GradeMaterialLayer(props: Props) {
  const motionEnabled = useMotionEnabled();
  const moving = props.active && motionEnabled && (props.material === 'gold' || props.material === 'prism' || props.variant === 'detail');
  // 비활성 카드는 목록 시계를 worklet에 캡처하지 않는다. 조건부 읽기만으로는 구독이 해제되지 않는다.
  if (!moving) return <StaticLayer {...props} tilt={undefined} moving={false} />;
  if (props.clock) return <MaterialVisual {...props} clock={props.clock} moving={moving} />;
  return <AutonomousLayer {...props} moving />;
}
