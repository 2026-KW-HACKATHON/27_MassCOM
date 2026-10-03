import { Image, Text, View, useColorScheme } from 'react-native';
import Svg, { Circle, Polygon, Rect } from 'react-native-svg';

import { medalColorsForScheme, type TierColors } from '@/theme/medal-colors';
import { colorsForScheme } from '@/theme/palette';
import { mascotArt } from '@/ui/mascot-art';

/** 기존 금속색을 재사용한다. 프리즘·특별 등급은 앱의 하늘색 계열을 쓴다. */
export function collectibleGradeColors(gradeId: string, gradeName: string, scheme: ReturnType<typeof useColorScheme>): TierColors {
  const medals = medalColorsForScheme(scheme);
  const grade = `${gradeId} ${gradeName}`.toLowerCase();
  if (/prism|special|프리즘|특별/.test(grade)) {
    const palette = colorsForScheme(scheme);
    return { highlight: medals.sky[0], base: palette.primary, shade: medals.ribbonShade,
      edge: palette.primary, container: palette.primaryContainer, onContainer: palette.onPrimaryContainer };
  }
  if (/gold|골드|금색|금등급/.test(grade)) return medals.gold;
  if (/silver|실버|은색|은등급/.test(grade)) return medals.silver;
  return medals.bronze;
}

/** 얼굴과 옆면이 같은 윤곽을 공유한다. 알려지지 않은 형태는 원형이다. */
export function CollectibleFaceShape({ shape, size, fill, ring }: { shape: string; size: number; fill: string; ring?: string }) {
  const outline = shape === 'stamp'
    ? <Rect x={9} y={4} width={82} height={92} rx={6} fill={fill} />
    : shape === 'serrated' || shape === 'gear'
      ? <Polygon fill={fill} points={Array.from({ length: 48 }, (_, index) => {
        const angle = -Math.PI / 2 + index * Math.PI * 2 / 48;
        const radius = index % 2 ? 36.8 : 46;
        return `${50 + Math.cos(angle) * radius},${50 + Math.sin(angle) * radius}`;
      }).join(' ')} />
      : <Circle cx={50} cy={50} r={46} fill={fill} />;
  return <Svg pointerEvents="none" width={size} height={size} viewBox="0 0 100 100">
    {outline}
    {ring ? (shape === 'stamp'
      ? <Rect x={16} y={11} width={68} height={78} rx={5} fill="none" stroke={ring} strokeWidth={1.2} />
      : <Circle cx={50} cy={50} r={34} fill="none" stroke={ring} strokeWidth={1.2} />) : null}
  </Svg>;
}

type Props = { shape: string; size: number; merchantName: string; name: string; gradeId: string; gradeName: string };

/** 게시된 뒷면 그림이 없어도 로컬 자산만으로 완성된 수집품 뒷면을 보여준다. */
export function CollectibleDefaultBack({ shape, size, merchantName, name, gradeId, gradeName }: Props) {
  const colors = collectibleGradeColors(gradeId, gradeName, useColorScheme());
  const koreanGrade = /[가-힣]/.test(gradeName) ? gradeName
    : /prism/i.test(`${gradeId} ${gradeName}`) ? '프리즘'
      : /special/i.test(`${gradeId} ${gradeName}`) ? '특별'
        : /gold/i.test(`${gradeId} ${gradeName}`) ? '골드'
          : /silver/i.test(`${gradeId} ${gradeName}`) ? '실버' : '브론즈';
  return <View accessible={false} style={{ width: size, height: size }}>
    <CollectibleFaceShape shape={shape} size={size} fill={colors.container} ring={colors.edge} />
    <View style={{ position: 'absolute', top: size * .22, left: size * .23, width: size * .54, alignItems: 'center', gap: size * .015 }}>
      <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: colors.onContainer, fontSize: size * .06, fontWeight: '700', textAlign: 'center' }}>{merchantName}</Text>
      <Text numberOfLines={2} adjustsFontSizeToFit style={{ color: colors.onContainer, fontSize: size * .05, fontWeight: '700', textAlign: 'center' }}>{name}</Text>
      <Text numberOfLines={1} style={{ color: colors.onContainer, fontSize: size * .04 }}>{koreanGrade}</Text>
      <Image source={mascotArt.stamp} resizeMode="contain" accessible={false} style={{ width: size * .23, height: size * .23 }} />
      <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: colors.onContainer, fontSize: size * .028 }}>MassCOM 월계 수집</Text>
    </View>
  </View>;
}
