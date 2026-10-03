import { useCallback, useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { mascotStamp } from '@/gamification/glyphs';
import { Medallion } from '@/gamification/medallion';
import { captureViewAsPng, shareImageFile } from '@/gamification/native-effects';
import { lightMedalColors } from '@/theme/medal-colors';
import { lightColors } from '@/theme/palette';
import { mascotArt } from '@/ui/mascot-art';

import {
  collectionShareCaptureSize,
  collectionShareCardSize,
  type CollectionShareCardItem,
  type CollectionShareCardModel,
} from './collection-share-card';
import { createImageLoadGate, performCollectionShare, type CollectionShareOutcome } from './collection-share-flow';

export type { CollectionShareOutcome };

const { width: cardWidth, height: cardHeight } = collectionShareCardSize;
const sky = lightMedalColors.sky;
const tierByGrade = { BRONZE: lightMedalColors.bronze, SILVER: lightMedalColors.silver, GOLD: lightMedalColors.gold } as const;
const columnGap = 8;
const sidePadding = 16;
const cellWidth = (cardWidth - sidePadding * 2 - columnGap * 2) / 3;
/** 그림이 다 불러와지길 기다리는 최대 시간. 깨진 그림 하나가 공유를 붙잡지 않게 한다. */
const imageWaitMs = 2500;

/**
 * 도감 자랑 카드: 마스코트·제목·가게 수, 등급 틀(브론즈·실버·골드)에 담은 대표 수집품 3×2, 메달 줄, 푸터.
 * 모든 층이 불투명하고(공유 미리보기가 투명 픽셀을 검게 그리는 일을 막는다) 언제나 밝은 테마로 그린다.
 * 글꼴 배율을 따르지 않는 고정 레이아웃이라 기기 설정과 상관없이 같은 이미지가 나온다.
 */
export function CollectionShareCard({ model, onImageSettled, ref }: {
  model: CollectionShareCardModel;
  onImageSettled?: () => void;
  ref?: Ref<View>;
}) {
  return (
    <View ref={ref} collapsable={false} style={cardStyles.card}>
      <Svg width={cardWidth} height={cardHeight} style={cardStyles.background}>
        <Defs>
          <LinearGradient id="collectionShareSky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={sky[0]} />
            <Stop offset="0.55" stopColor={sky[1]} />
            <Stop offset="1" stopColor={sky[2]} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={cardWidth} height={cardHeight} fill="url(#collectionShareSky)" />
      </Svg>

      <View style={cardStyles.header}>
        <Image source={mascotArt.cheer} resizeMode="contain" style={cardStyles.mascot} />
        <View style={cardStyles.headerText}>
          <Text allowFontScaling={false} numberOfLines={1} style={cardStyles.title}>{model.title}</Text>
          <Text allowFontScaling={false} numberOfLines={1} style={cardStyles.subtitle}>{model.subtitle}</Text>
        </View>
      </View>

      <View style={cardStyles.grid}>
        {model.items.map((item, index) => (
          <ShareCell key={`${index}:${item.title}`} item={item} onImageSettled={onImageSettled} />
        ))}
      </View>

      {model.medals.length > 0 ? (
        <View style={cardStyles.medalRow}>
          {model.medals.map((medal) => (
            <View key={medal.kind} style={cardStyles.medal}>
              <Medallion
                kind={medal.kind}
                tier={medal.tier}
                progress={null}
                size={38}
                colors={lightMedalColors}
                arcColor={lightColors.primary}
                trackColor={lightColors.separator}
              />
              <View style={cardStyles.medalText}>
                <Text allowFontScaling={false} numberOfLines={1} style={cardStyles.medalName}>{medal.label}</Text>
                <Text allowFontScaling={false} numberOfLines={1} style={cardStyles.medalTier}>{medal.tierLabel}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {model.demoNote ? <Text allowFontScaling={false} style={cardStyles.demo}>{model.demoNote}</Text> : null}

      <View style={cardStyles.footer}>
        <Text allowFontScaling={false} style={cardStyles.footerText}>{model.footer}</Text>
      </View>
    </View>
  );
}

function ShareCell({ item, onImageSettled }: { item: CollectionShareCardItem; onImageSettled?: () => void }) {
  const tier = tierByGrade[item.grade];
  return (
    <View style={cardStyles.cell}>
      <View style={[cardStyles.frame, { borderColor: tier.edge, backgroundColor: tier.container }]}>
        {item.imageUri ? (
          <Image
            source={{ uri: item.imageUri }}
            resizeMode="contain"
            onLoad={onImageSettled}
            onError={onImageSettled}
            style={cardStyles.art}
          />
        ) : (
          <Image source={mascotStamp} resizeMode="contain" style={cardStyles.placeholder} />
        )}
      </View>
      <Text allowFontScaling={false} numberOfLines={1} style={cardStyles.itemTitle}>{item.title}</Text>
      <Text allowFontScaling={false} numberOfLines={1} style={cardStyles.itemStore}>{item.storeName}</Text>
    </View>
  );
}

/**
 * 카드를 화면 밖에서 그렸다가 1080×1350으로 캡처해 OS 공유 시트로만 내보낸다(자동 게시·전송 없음). collectible-share.tsx와
 * 같은 방식이다: 화면이 사라지면(계정 전환 등) 캡처 전과 시트를 열기 전에 멈춰, 이전 계정의 도감이 공유 동작에 새지 않는다.
 * `host`는 이 훅을 쓰는 화면 안에 놓는다.
 */
export function useCollectionShare(): {
  host: ReactNode;
  share: (model: CollectionShareCardModel) => Promise<CollectionShareOutcome>;
  sharing: boolean;
} {
  const [model, setModel] = useState<CollectionShareCardModel>();
  const [sharing, setSharing] = useState(false);
  const card = useRef<View>(null);
  const alive = useRef(true);
  const busy = useRef(false);
  const gate = useRef<ReturnType<typeof createImageLoadGate>>(undefined);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const onImageSettled = useCallback(() => gate.current?.markLoaded(), []);

  const share = useCallback(async (target: CollectionShareCardModel): Promise<CollectionShareOutcome> => {
    // 이미 만드는 중이면 두 번째 탭은 조용히 무시한다(버튼도 sharing 동안 꺼 둔다).
    if (busy.current) return 'stopped';
    busy.current = true;
    setSharing(true);
    const loadGate = createImageLoadGate(target.items.filter((item) => item.imageUri !== null).length);
    gate.current = loadGate;
    setModel(target);
    try {
      return await performCollectionShare({
        // 카드가 그려질 두 프레임, 그림 로드, 짧은 안정화 시간 순서로 기다린 뒤 찍는다.
        nextFrame: () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
        imagesReady: () => loadGate.wait(imageWaitMs),
        settle: () => new Promise<void>((resolve) => setTimeout(resolve, 120)),
        captureViewAsPng: () => (card.current
          ? captureViewAsPng(card.current, { ...collectionShareCaptureSize, fileName: 'masscom-collection' })
          : Promise.resolve(undefined)),
        shareImageFile: (uri, isAlive) => shareImageFile(uri, '도감 공유', isAlive),
        isAlive: () => alive.current,
        // 웹은 캡처·파일 공유를 지원하지 않는 환경으로 본다: 실패해도 "다시 시도"가 아니라 지원 안 함으로 알린다.
        captureUnsupported: Platform.OS === 'web',
      });
    } finally {
      busy.current = false;
      gate.current = undefined;
      if (alive.current) {
        setModel(undefined);
        setSharing(false);
      }
    }
  }, []);

  const host = model ? (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={cardStyles.offscreen}>
      <CollectionShareCard ref={card} model={model} onImageSettled={onImageSettled} />
    </View>
  ) : null;

  return { host, share, sharing };
}

const headerTop = 14;
const headerHeight = 76;
const gridTop = headerTop + headerHeight + 8;
const frameHeight = 84;
const cellHeight = frameHeight + 32;
const gridHeight = cellHeight * 2 + 6;
const medalTop = gridTop + gridHeight + 8;
const footerHeight = 34;

const cardStyles = StyleSheet.create({
  offscreen: { position: 'absolute', top: 0, left: -10000, width: cardWidth, height: cardHeight },
  card: { width: cardWidth, height: cardHeight, overflow: 'hidden', backgroundColor: '#FFFFFF' },
  background: { position: 'absolute', top: 0, left: 0 },
  header: { position: 'absolute', top: headerTop, left: sidePadding, right: sidePadding, height: headerHeight, flexDirection: 'row', alignItems: 'center', gap: 12 },
  mascot: { width: headerHeight, height: headerHeight, borderRadius: headerHeight / 2, borderWidth: 3, borderColor: '#FFFFFF', backgroundColor: '#FFFFFF' },
  headerText: { flex: 1, gap: 4 },
  title: { color: lightMedalColors.skyInk, fontSize: 26, fontWeight: '900', letterSpacing: -0.4 },
  subtitle: { color: lightMedalColors.skyMuted, fontSize: 15, fontWeight: '700' },
  grid: { position: 'absolute', top: gridTop, left: sidePadding, right: sidePadding, height: gridHeight, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignContent: 'flex-start', columnGap, rowGap: 6 },
  cell: { width: cellWidth, height: cellHeight, gap: 2 },
  frame: { width: cellWidth, height: frameHeight, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 3 },
  art: { width: frameHeight - 14, height: frameHeight - 14 },
  placeholder: { width: frameHeight - 28, height: frameHeight - 28 },
  itemTitle: { color: lightMedalColors.skyInk, fontSize: 11, fontWeight: '800', textAlign: 'center' },
  itemStore: { color: lightMedalColors.skyMuted, fontSize: 10, fontWeight: '600', textAlign: 'center' },
  medalRow: { position: 'absolute', top: medalTop, left: sidePadding, right: sidePadding, height: 44, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 },
  medal: { width: (cardWidth - sidePadding * 2 - 12) / 3, flexDirection: 'row', alignItems: 'center', gap: 4, justifyContent: 'center' },
  medalText: { flexShrink: 1 },
  medalName: { color: lightMedalColors.skyInk, fontSize: 10, fontWeight: '800' },
  medalTier: { color: lightMedalColors.skyMuted, fontSize: 10, fontWeight: '700' },
  demo: {
    position: 'absolute', top: medalTop + 46, alignSelf: 'center', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10, overflow: 'hidden',
    color: lightColors.onAccentContainer, backgroundColor: lightColors.accentContainer, fontSize: 11, fontWeight: '800',
  },
  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: footerHeight, alignItems: 'center', justifyContent: 'center',
    backgroundColor: sky[2], borderTopWidth: 1, borderTopColor: lightColors.separator,
  },
  footerText: { color: lightMedalColors.skyMuted, fontSize: 12, fontWeight: '800' },
});
