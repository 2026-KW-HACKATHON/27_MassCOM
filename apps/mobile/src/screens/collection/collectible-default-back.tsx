import { useId } from 'react';
import { Image, Text, View, useColorScheme } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Polygon, Rect, Stop } from 'react-native-svg';

import { medalColorsForScheme, type TierColors } from '@/theme/medal-colors';
import { colorsForScheme } from '@/theme/palette';
import { mascotArt } from '@/ui/mascot-art';
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

/** 얼굴과 옆면이 같은 윤곽을 공유한다. 알려지지 않은 형태는 원형이다. */
export function CollectibleFaceOutline({ shape, fill }: { shape: string; fill: string }) {
  return shape === 'stamp'
    ? <Rect x={9} y={4} width={82} height={92} rx={6} fill={fill} />
    : shape === 'serrated' || shape === 'gear'
      ? <Polygon fill={fill} points={Array.from({ length: 48 }, (_, index) => {
        const angle = -Math.PI / 2 + index * Math.PI * 2 / 48;
        const radius = index % 2 ? 36.8 : 46;
        return `${50 + Math.cos(angle) * radius},${50 + Math.sin(angle) * radius}`;
      }).join(' ')} />
      : <Circle cx={50} cy={50} r={46} fill={fill} />;
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

type Props = { shape: string; size: number; merchantName: string; name: string; gradeId: string; gradeName: string };

/** 게시된 뒷면 그림이 없어도 로컬 자산만으로 완성된 수집품 뒷면을 보여준다. */
export function CollectibleDefaultBack({ shape, size, merchantName, name, gradeId, gradeName }: Props) {
  const colors = collectibleGradeColors(gradeId, gradeName, useColorScheme());
  const material = gradeMaterialFor(gradeId, gradeName);
  const koreanGrade = /[가-힣]/.test(gradeName) ? gradeName
    : /prism/i.test(`${gradeId} ${gradeName}`) ? '프리즘'
      : /special/i.test(`${gradeId} ${gradeName}`) ? '특별'
        : /gold/i.test(`${gradeId} ${gradeName}`) ? '골드'
          : /silver/i.test(`${gradeId} ${gradeName}`) ? '실버' : '브론즈';
  return <View accessible={false} style={{ width: size, height: size }}>
    <CollectibleFaceShape shape={shape} size={size} fill={colors.container} ring={colors.edge} material={material} />
    {/* 무지개·금속 위 문자는 불투명한 등급 컨테이너에 두어 밝은/어두운 테마 대비를 지킨다. */}
    <View style={{ position: 'absolute', top: size * .22, left: size * .23, width: size * .54, alignItems: 'center', gap: size * .015,
      paddingVertical: size * .015, borderRadius: size * .04, backgroundColor: colors.container }}>
      <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: colors.onContainer, fontSize: size * .06, fontWeight: '700', textAlign: 'center' }}>{merchantName}</Text>
      <Text numberOfLines={2} adjustsFontSizeToFit style={{ color: colors.onContainer, fontSize: size * .05, fontWeight: '700', textAlign: 'center' }}>{name}</Text>
      <Text numberOfLines={1} style={{ color: colors.onContainer, fontSize: size * .04 }}>{koreanGrade}</Text>
      <Image source={mascotArt.stamp} resizeMode="contain" accessible={false} style={{ width: size * .23, height: size * .23 }} />
      <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: colors.onContainer, fontSize: size * .028 }}>MassCOM 월계 수집</Text>
    </View>
  </View>;
}
