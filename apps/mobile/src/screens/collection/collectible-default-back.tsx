import { useId } from 'react';
import { Image, Platform, View, useColorScheme, type ViewStyle } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, Image as SvgImage, LinearGradient, Polygon, Rect, Stop } from 'react-native-svg';

import { medalColorsForScheme, type TierColors } from '@/theme/medal-colors';
import { colorsForScheme } from '@/theme/palette';
import { gradeMaterialFor, gradeMaterialPresets, type GradeMaterial } from './grade-material';

/** 옆면 팔레트와 얼굴 재질은 같은 등급 판별을 공유한다. */
export function collectibleGradeColors(gradeId: string, gradeName: string, scheme: ReturnType<typeof useColorScheme>): TierColors {
  const medals = medalColorsForScheme(scheme);
  const material = gradeMaterialFor(gradeId, gradeName);
  if (material === 'prism') {
    const palette = colorsForScheme(scheme);
    return { highlight: medals.sky[0], base: palette.primary, shade: medals.ribbonShade,
      edge: palette.primary, container: palette.primaryContainer, onContainer: palette.onPrimaryContainer };
  }
  if (material === 'gold') return medals.gold;
  if (material === 'silver') return medals.silver;
  return medals.bronze;
}

export const collectibleSerratedPoints = Array.from({ length: 48 }, (_, index) => {
  const angle = -Math.PI / 2 + index * Math.PI * 2 / 48;
  const radius = index % 2 ? 36.8 : 46;
  return [50 + Math.cos(angle) * radius, 50 + Math.sin(angle) * radius] as const;
});

/** SVG 안팎의 웹 사진·재질광이 발행된 한 윤곽을 공유한다. */
export function collectibleWebClipPath(shape: string): string {
  if (shape === 'stamp') return 'inset(4% 9% round 6%)';
  if (shape === 'serrated' || shape === 'gear') return `polygon(${collectibleSerratedPoints.map(([x, y]) => `${x}% ${y}%`).join(',')})`;
  return 'circle(46% at 50% 50%)';
}

/** 얼굴과 옆면이 같은 윤곽을 공유한다. 알려지지 않은 형태는 원형이다. */
export function CollectibleFaceOutline({ shape, fill, stroke, strokeWidth }: { shape: string; fill: string; stroke?: string; strokeWidth?: number }) {
  return shape === 'stamp'
    ? <Rect x={9} y={4} width={82} height={92} rx={6} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
    : shape === 'serrated' || shape === 'gear'
      ? <Polygon fill={fill} stroke={stroke} strokeWidth={strokeWidth} points={collectibleSerratedPoints.map(([x, y]) => `${x},${y}`).join(' ')} />
      : <Circle cx={50} cy={50} r={46} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
}

export function CollectibleFaceShape({ shape, size, fill, ring, material }: { shape: string; size: number; fill: string; ring?: string; material?: GradeMaterial }) {
  const gradientId = `back-material-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const stops = material === 'prism' ? gradeMaterialPresets.prism.rainbowStops
    : material === 'gold' ? gradeMaterialPresets.gold.colors : undefined;
  return <Svg pointerEvents="none" width={size} height={size} viewBox="0 0 100 100">
    {stops ? <Defs><LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
      {stops.map((color, index) => <Stop key={index} offset={index / (stops.length - 1)} stopColor={color} />)}
    </LinearGradient></Defs> : null}
    <CollectibleFaceOutline shape={shape} fill={stops ? `url(#${gradientId})` : fill} />
    {ring ? (shape === 'stamp'
      ? <Rect x={16} y={11} width={68} height={78} rx={5} fill="none" stroke={ring} strokeWidth={1.2} />
      : <Circle cx={50} cy={50} r={34} fill="none" stroke={ring} strokeWidth={1.2} />) : null}
  </Svg>;
}

export type FixedBackShape = 'circle' | 'stamp' | 'serrated';
export type FixedBackGrade = 'bronze' | 'silver' | 'gold' | 'prism';

export const fixedBackShapes: readonly FixedBackShape[] = ['circle', 'stamp', 'serrated'];
export const fixedBackGrades: readonly FixedBackGrade[] = ['bronze', 'silver', 'gold', 'prism'];

export function fixedBackShape(shape: string): FixedBackShape {
  return shape === 'stamp' ? 'stamp' : (shape === 'serrated' || shape === 'gear') ? 'serrated' : 'circle';
}

export function fixedBackGrade(gradeId: string, _gradeName: string): FixedBackGrade {
  const id = String(gradeId).toLowerCase();
  return fixedBackGrades.includes(id as FixedBackGrade) ? id as FixedBackGrade : 'bronze';
}

const fixedBackImages: Record<FixedBackShape, Record<FixedBackGrade, number>> = {
  circle: {
    bronze: require('../../../assets/images/collectibles/backs/v2/circle-bronze.webp'),
    silver: require('../../../assets/images/collectibles/backs/v2/circle-silver.webp'),
    gold: require('../../../assets/images/collectibles/backs/v2/circle-gold.webp'),
    prism: require('../../../assets/images/collectibles/backs/v2/circle-prism.webp'),
  },
  stamp: {
    bronze: require('../../../assets/images/collectibles/backs/v2/stamp-bronze.webp'),
    silver: require('../../../assets/images/collectibles/backs/v2/stamp-silver.webp'),
    gold: require('../../../assets/images/collectibles/backs/v2/stamp-gold.webp'),
    prism: require('../../../assets/images/collectibles/backs/v2/stamp-prism.webp'),
  },
  serrated: {
    bronze: require('../../../assets/images/collectibles/backs/v2/serrated-bronze.webp'),
    silver: require('../../../assets/images/collectibles/backs/v2/serrated-silver.webp'),
    gold: require('../../../assets/images/collectibles/backs/v2/serrated-gold.webp'),
    prism: require('../../../assets/images/collectibles/backs/v2/serrated-prism.webp'),
  },
};

export function collectibleFixedBackSource(shape: string, gradeId: string, gradeName: string): number {
  const fixedShape = fixedBackShape(shape);
  const fixedGrade = fixedBackGrade(gradeId, gradeName);
  return fixedBackImages[fixedShape][fixedGrade];
}

type Props = { shape: string; size: number; merchantName: string; name: string; gradeId: string; gradeName: string };

function FixedBackImage({ shape, source, size }: { shape: string; source: number; size: number }) {
  const fixedShape = fixedBackShape(shape);
  const clipId = `fixed-back-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  if (Platform.OS === 'web') {
    return <View pointerEvents="none" style={{ position: 'absolute', width: size, height: size, overflow: 'hidden', ...({ clipPath: collectibleWebClipPath(fixedShape) } as ViewStyle) }}>
      <Image source={source} resizeMode="cover" accessible={false} style={{ width: size, height: size }} />
    </View>;
  }
  return <Svg pointerEvents="none" width={size} height={size} style={{ position: 'absolute' }}>
    <Defs><ClipPath id={clipId}><G scale={size / 100}><CollectibleFaceOutline shape={fixedShape} fill="white" /></G></ClipPath></Defs>
    <SvgImage href={source} width={size} height={size} preserveAspectRatio="xMidYMid slice" clipPath={`url(#${clipId})`} />
  </Svg>;
}

/** 게시된 뒷면 그림이 없어도 로컬 자산만으로 완성된 수집품 뒷면을 보여준다. */
export function CollectibleDefaultBack({ shape, size, gradeId, gradeName }: Props) {
  const colors = collectibleGradeColors(gradeId, gradeName, useColorScheme());
  const material = gradeMaterialFor(gradeId, gradeName);
  const source = collectibleFixedBackSource(shape, gradeId, gradeName);
  return <View accessible={false} style={{ width: size, height: size }}>
    <CollectibleFaceShape shape={shape} size={size} fill={colors.container} ring={colors.edge} material={material} />
    <FixedBackImage shape={shape} source={source} size={size} />
  </View>;
}
