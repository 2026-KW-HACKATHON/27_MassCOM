import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react';
import { AppState, Platform, View, type ViewStyle } from 'react-native';
import Animated, { useAnimatedProps, useDerivedValue, useFrameCallback, useSharedValue, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle, ClipPath, Defs, G, Image as SvgImage, Line, LinearGradient, Mask, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { useMotionEnabled } from '@/motion/use-motion';

import { CollectibleFaceOutline, collectibleWebClipPath } from './collectible-default-back';
import { GOLD_BAND_STOPS, GOLD_WARM_STOPS, gradeMaterialPresets, PRISM_FOIL_STOPS, RAINBOW_PERIODS, reflectionAt, type GradeMaterial, type ReflectionFrame } from './grade-material';

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
  webFaceMask?: string;
  shape: string;
  tilt?: SharedValue<{ x: number; y: number }>;
  clock?: SharedValue<number>;
  variant: 'detail' | 'card' | 'envelope';
  active: boolean;
  intensityScale?: number;
  showGlints?: boolean;
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
  const radius = size * (material === 'gold' ? .057 : .048);
  const glowId = `glint-${useId().replace(/:/g, '')}`;
  const animatedProps = useAnimatedProps(() => {
    const pulse = reflection.get().glintOpacities[index] ?? 0;
    const zoom = Math.sqrt(pulse);
    return { opacity: Math.min(1, pulse * opacityScale),
      matrix: [zoom, 0, 0, zoom, x * size, y * size] };
  });
  return <AnimatedGroup animatedProps={animatedProps}>
    <Defs><RadialGradient id={glowId}>
      <Stop offset={0} stopColor="white" stopOpacity={0.8} />
      <Stop offset={0.35} stopColor={color} stopOpacity={0.45} />
      <Stop offset={1} stopColor={color} stopOpacity={0} />
    </RadialGradient></Defs>
    <Circle r={radius * 2.2} fill={`url(#${glowId})`} />
    <Path d={`M 0 ${-radius * 1.7} Q ${radius * .14} ${-radius * .13} ${radius} 0 Q ${radius * .14} ${radius * .13} 0 ${radius * 1.7} Q ${-radius * .14} ${radius * .13} ${-radius} 0 Q ${-radius * .14} ${-radius * .13} 0 ${-radius * 1.7} Z`} fill={color} />
    <Circle r={radius * .25} fill="white" />
  </AnimatedGroup>;
}

function MaterialVisual({ material, size, faceUri, faceMask, webFaceMask, shape, tilt, clock, variant, moving, intensityScale = 1, showGlints = false }: VisualProps) {
  const basePreset = gradeMaterialPresets[material];
  const preset = variant === 'card' ? { ...basePreset, sweepPeriodMs: basePreset.cardPeriodMs } : basePreset;
  const key = useId().replace(/:/g, '');
  const clipId = `${key}outline`;
  const maskId = `${key}mask`;
  const lightMaskId = `${key}lightmask`;
  const rimMaskId = `${key}rimmask`;
  const warmId = `${key}warm`;
  const bandId = `${key}band`;
  const rimId = `${key}rim`;
  const rimLightId = `${key}rimlight`;
  const rainbowId = `${key}rainbow`;
  const hotspotId = `${key}hotspot`;
  const lightScale = Math.min(1.4, Math.max(0, intensityScale));
  const variantScale = variant === 'card' ? .8 : variant === 'envelope' ? 1.15 : 1;
  const scale = variantScale * lightScale;
  const alpha = Math.min(.55, preset.baseOpacity * scale);
  const coreAlpha = Math.min(.95, preset.intensity * scale);
  const isPrism = material === 'prism';
  const isGold = material === 'gold';
  const vivid = isGold || isPrism;
  const reflection = useDerivedValue(() => {
    const t = moving ? tilt?.get() ?? STATIC_TILT : STATIC_TILT;
    return reflectionAt({ tiltX: t.x, tiltY: t.y, timeMs: moving ? clock.get() : 0, active: moving, ambient: !tilt }, preset);
  });
  const bandProps = useAnimatedProps(() => {
    const light = reflection.get();
    const centerX = light.bandOffset * size;
    const centerY = size * .5;
    const angle = light.bandAngle * Math.PI / 180;
    const nx = Math.cos(angle);
    const ny = Math.sin(angle);
    const half = preset.bandWidth * size * .5;
    return { x1: centerX - half * nx, y1: centerY - half * ny,
      x2: centerX + half * nx, y2: centerY + half * ny };
  });
  const rainbowProps = useAnimatedProps(() => {
    const coords = reflection.get().rainbowGradient;
    return { x1: coords.x1 * size, y1: coords.y1 * size, x2: coords.x2 * size, y2: coords.y2 * size };
  });
  const hotspotProps = useAnimatedProps(() => {
    const light = reflection.get();
    const cx = light.highlightX * size;
    const cy = light.highlightY * size;
    return { cx, cy, fx: cx, fy: cy };
  });
  const linesProps = useAnimatedProps(() => {
    return { opacity: (.25 + .05 * Math.sin(reflection.get().rainbowPhase * Math.PI * 2)) * scale };
  });
  const reflectedProps = useAnimatedProps(() => ({ opacity: reflection.get().specular }));
  const edgeProps = useAnimatedProps(() => ({ opacity: reflection.get().fresnel }));
  // 그림보다 긴 색 주기를 나열해 양끝 색의 늘어짐이 카드 안에 들어오지 않게 한다.
  const rainbowColors = Array.from({ length: RAINBOW_PERIODS * (PRISM_FOIL_STOPS.length - 1) + 1 },
    (_, index) => PRISM_FOIL_STOPS[index % (PRISM_FOIL_STOPS.length - 1)]);
  const maskFace = faceMask ?? (faceUri ? <SvgImage href={{ uri: faceUri }} width={size} height={size} preserveAspectRatio="xMidYMid meet" />
    : <G scale={size / 100}><CollectibleFaceOutline shape={shape} fill="white" /></G>);
  const svgStyle = { position: 'absolute' as const, left: 0, top: 0 };
  const maskUri = webFaceMask ?? faceUri;
  const webShapeStyle = Platform.OS === 'web' ? { clipPath: collectibleWebClipPath(shape),
    ...(maskUri ? { maskImage: `url(${JSON.stringify(maskUri)})`, maskSize: 'contain', maskPosition: 'center', maskRepeat: 'no-repeat' } : {}) } as ViewStyle & CSSProperties : undefined;
  const glintCount = variant === 'card' ? isPrism ? 4 : isGold ? 3 : 0 : variant === 'detail' && !showGlints ? 0 : preset.glintCount;
  const bandStops = isGold ? GOLD_BAND_STOPS.map((stop) =>
    <Stop key={stop.offset} offset={stop.offset} stopColor={stop.color} stopOpacity={stop.opacity} />) : [
    <Stop key={0} offset={0} stopColor={preset.tint} stopOpacity={0} />,
    <Stop key={1} offset={0.25} stopColor="#B9E9FF" stopOpacity={0.28} />,
    <Stop key={2} offset={0.44} stopColor="#EDF9FF" stopOpacity={0.65} />,
    <Stop key={3} offset={0.5} stopColor="white" stopOpacity={1} />,
    <Stop key={4} offset={0.56} stopColor="#EDF9FF" stopOpacity={0.65} />,
    <Stop key={5} offset={0.75} stopColor={preset.tint} stopOpacity={0.28} />,
    <Stop key={6} offset={1} stopColor={preset.tint} stopOpacity={0} />,
  ];
  // 합성 부모가 사진도 포함하도록 효과만 감싸는 네이티브 격리 뷰를 만들지 않는다.
  return <>
    {/* 색과 빛의 합성을 분리하고 합성 미지원 환경에서도 사진을 보존할 불투명도를 쓴다. */}
    <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={[svgStyle, webShapeStyle, { width: size, height: size, mixBlendMode: isGold ? 'normal' : isPrism ? 'overlay' : 'soft-light' }]}>
      <Svg pointerEvents="none" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Defs>
          <ClipPath id={clipId}><G scale={size / 100}><CollectibleFaceOutline shape={shape} fill="white" /></G></ClipPath>
          <Mask id={maskId} maskType="alpha">{maskFace}</Mask>
          <LinearGradient id={warmId} x1={0} y1={0} x2={1} y2={1}>
            {GOLD_WARM_STOPS.map((color, index) => <Stop key={color} offset={index / (GOLD_WARM_STOPS.length - 1)} stopColor={color} />)}
          </LinearGradient>
          <AnimatedGradient id={rainbowId} animatedProps={rainbowProps} gradientUnits="userSpaceOnUse">
            {rainbowColors.map((color, index) => <Stop key={index} offset={index / (rainbowColors.length - 1)} stopColor={color} />)}
          </AnimatedGradient>
        </Defs>
        <G clipPath={Platform.OS === 'web' ? undefined : `url(#${clipId})`} mask={Platform.OS === 'web' ? undefined : `url(#${maskId})`}>
          <Rect width={size} height={size} fill={isGold ? `url(#${warmId})` : isPrism ? `url(#${rainbowId})` : preset.tint} opacity={alpha} />
          {isPrism ? <AnimatedGroup animatedProps={linesProps}>
            {Array.from({ length: 48 }, (_, index) => <Line key={index} x1={-size + index * size / 20} y1={0}
              x2={index * size / 20} y2={size} stroke={index % 2 ? '#e9fcff' : '#b871ff'} strokeWidth={size * .004} />)}
          </AnimatedGroup> : null}
        </G>
      </Svg>
    </View>
    {/* 골드 유색 가장자리는 일반 합성에 두어 흰 픽셀에서도 금빛 반사띠가 남게 한다. */}
    <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={[svgStyle, webShapeStyle, { width: size, height: size, mixBlendMode: isGold ? 'normal' : 'screen' }]}>
      <Svg pointerEvents="none" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Defs>
          <ClipPath id={clipId}><G scale={size / 100}><CollectibleFaceOutline shape={shape} fill="white" /></G></ClipPath>
          <Mask id={lightMaskId} maskType="alpha">{maskFace}</Mask>
          <AnimatedGradient id={bandId} animatedProps={bandProps} gradientUnits="userSpaceOnUse">
            {bandStops}
          </AnimatedGradient>
          <AnimatedRadialGradient id={hotspotId} animatedProps={hotspotProps} r={size * .32} gradientUnits="userSpaceOnUse">
            <Stop offset={0} stopColor={isGold ? '#FFE396' : '#DAA6FF'} stopOpacity={0.35} />
            <Stop offset={0.45} stopColor={isGold ? '#FFC349' : '#76F6EE'} stopOpacity={0.18} />
            <Stop offset={1} stopColor={preset.tint} stopOpacity={0} />
          </AnimatedRadialGradient>
        </Defs>
        <G clipPath={Platform.OS === 'web' ? undefined : `url(#${clipId})`} mask={Platform.OS === 'web' ? undefined : `url(#${lightMaskId})`}>
          <AnimatedGroup animatedProps={reflectedProps}>
          {vivid ? <Rect width={size} height={size} fill={`url(#${hotspotId})`} opacity={Math.min(1, scale)} /> : null}
          <Rect width={size} height={size} fill={`url(#${bandId})`} opacity={coreAlpha} />
          </AnimatedGroup>
          {Array.from({ length: Math.min(glintCount, STAR_POINTS.length) }, (_, index) =>
            <Glint key={index} index={index} size={size} color={isGold ? '#FFC23A' : index % 2 ? '#FFF1FF' : '#DCFFFF'}
              material={material} reflection={reflection} opacityScale={scale} />)}
        </G>
      </Svg>
    </View>
    {vivid ? <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={[svgStyle, webShapeStyle, { width: size, height: size, mixBlendMode: 'normal' }]}>
      <Svg pointerEvents="none" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Defs>
          <ClipPath id={clipId}><G scale={size / 100}><CollectibleFaceOutline shape={shape} fill="white" /></G></ClipPath>
          <Mask id={rimMaskId} maskType="alpha">{maskFace}</Mask>
          <LinearGradient id={rimId} x1={0} y1={0} x2={1} y2={1}>
            {(isGold ? ['#C98A00', '#FFC23A', '#FFF1BB', '#D99000', '#FFE7A0'] : PRISM_FOIL_STOPS).map((color, index, colors) =>
              <Stop key={index} offset={index / (colors.length - 1)} stopColor={color} />)}
          </LinearGradient>
          {/* 픽셀 반사 좌표를 0..100 윤곽 공간으로 바꿔 림의 밝은 부분도 같은 빛을 따른다. */}
          <AnimatedGradient id={rimLightId} animatedProps={bandProps} gradientUnits="userSpaceOnUse" gradientTransform={`scale(${100 / size})`}>
            {bandStops}
          </AnimatedGradient>
        </Defs>
        <G clipPath={Platform.OS === 'web' ? undefined : `url(#${clipId})`} mask={Platform.OS === 'web' ? undefined : `url(#${rimMaskId})`}>
          <AnimatedGroup animatedProps={edgeProps} scale={size / 100} opacity={coreAlpha}>
            <CollectibleFaceOutline shape={shape} fill="none" stroke={`url(#${rimId})`} strokeWidth={4.5} />
            <CollectibleFaceOutline shape={shape} fill="none" stroke={`url(#${rimLightId})`} strokeWidth={4.5} />
          </AnimatedGroup>
        </G>
      </Svg>
    </View> : null}
  </>;
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
