import { useCallback, useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { mascotStamp } from '@/gamification/glyphs';
import { Medallion } from '@/gamification/medallion';
import { captureViewAsPng, exportImageFile } from '@/gamification/native-effects';
import { lightMedalColors } from '@/theme/medal-colors';
import { lightColors } from '@/theme/palette';
import { mascotArt } from '@/ui/mascot-art';

import {
  collectionShareCaptureSize,
  collectionShareCardSize,
  collectionShareColumns,
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
const cellTextSize = (value: string, maximum: number, width: number, lines: number, minimum: number) =>
  Math.max(minimum, Math.min(maximum, (width - 6) * lines / Math.max(1, value.length)));
/** Required images must load before capture; time out with a retryable failure. */
const imageWaitMs = 4000;

/**
 * 도감 자랑 카드: 마스코트·제목·가게 수, 등급 틀(브론즈·실버·골드)에 담은 대표 수집품 3×2, 메달 줄, 푸터.
 * 모든 층이 불투명하고(공유 미리보기가 투명 픽셀을 검게 그리는 일을 막는다) 언제나 밝은 테마로 그린다.
 * 글꼴 배율을 따르지 않는 고정 레이아웃이라 기기 설정과 상관없이 같은 이미지가 나온다.
 */
export function CollectionShareCard({ model, onImageLoaded, onImageFailed, ref }: {
  model: CollectionShareCardModel;
  onImageLoaded?: (key: string) => void;
  onImageFailed?: (key: string) => void;
  ref?: Ref<View>;
}) {
  const columns = collectionShareColumns(model.items);
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
        <Image source={mascotArt.cheer} resizeMode="contain" style={cardStyles.mascot}
          onLoad={() => onImageLoaded?.('mascot')} onError={() => onImageFailed?.('mascot')} />
        <View style={cardStyles.headerText}>
          <Text allowFontScaling={false} numberOfLines={1} style={cardStyles.title}>{model.title}</Text>
          <Text allowFontScaling={false} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}
            style={cardStyles.subtitle}>{model.subtitle}</Text>
        </View>
      </View>

      <View style={cardStyles.grid}>
        {model.items.map((item, index) => (
          <ShareCell key={`${index}:${item.title}`} item={item} imageKey={`item-${index}`}
            columns={columns} onImageLoaded={onImageLoaded} onImageFailed={onImageFailed} />
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

function ShareCell({ item, imageKey, columns, onImageLoaded, onImageFailed }: {
  item: CollectionShareCardItem; imageKey: string; columns: 1 | 2 | 3;
  onImageLoaded?: (key: string) => void; onImageFailed?: (key: string) => void;
}) {
  const tier = tierByGrade[item.grade];
  const wide = columns === 1;
  const width = (cardWidth - sidePadding * 2 - columnGap * (columns - 1)) / columns;
  const frameWidth = wide ? 96 : width;
  const frameHeightForCell = wide ? 96 : frameHeight;
  const textWidth = wide ? width - frameWidth - 8 : width;
  const lines = wide ? 4 : 3;
  const minimum = wide ? 9.5 : 8;
  return (
    <View style={[cardStyles.cell, { width }, wide && cardStyles.wideCell]}>
      <View style={[cardStyles.frame, { width: frameWidth, height: frameHeightForCell, borderColor: tier.edge, backgroundColor: tier.container }]}>
        {item.imageUri ? (
          <Image
            source={{ uri: item.imageUri }}
            resizeMode="contain"
            onLoad={() => onImageLoaded?.(imageKey)}
            onError={() => onImageFailed?.(imageKey)}
            style={{ width: frameHeightForCell - 10, height: frameHeightForCell - 10 }}
          />
        ) : (
          <Image source={mascotStamp} resizeMode="contain" style={cardStyles.placeholder}
            onLoad={() => onImageLoaded?.(imageKey)} onError={() => onImageFailed?.(imageKey)} />
        )}
      </View>
      <View style={[cardStyles.textBlock, { width: textWidth }]}>
        <Text allowFontScaling={false} numberOfLines={lines} adjustsFontSizeToFit minimumFontScale={0.7}
          style={[cardStyles.itemTitle, { height: wide ? 44 : 33, fontSize: cellTextSize(item.title, 11, textWidth, lines, minimum) }]}>{item.title}</Text>
        <Text allowFontScaling={false} numberOfLines={lines} adjustsFontSizeToFit minimumFontScale={0.7}
          style={[cardStyles.itemStore, { height: wide ? 40 : 30, fontSize: cellTextSize(item.storeName, 10, textWidth, lines, minimum) }]}>{item.storeName}</Text>
      </View>
    </View>
  );
}

/**
 * Render offscreen, capture at 1080×1350, then open native sharing or save a browser PNG (never auto-post).
 * Stop before export if this account's screen goes away so a previous account's card cannot leak.
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

  const onImageLoaded = useCallback((key: string) => gate.current?.markLoaded(key), []);
  const onImageFailed = useCallback((key: string) => gate.current?.markFailed(key), []);

  const share = useCallback(async (target: CollectionShareCardModel): Promise<CollectionShareOutcome> => {
    // 이미 만드는 중이면 두 번째 탭은 조용히 무시한다(버튼도 sharing 동안 꺼 둔다).
    if (busy.current) return 'stopped';
    busy.current = true;
    setSharing(true);
    const loadGate = createImageLoadGate(1 + target.items.length);
    gate.current = loadGate;
    setModel(target);
    try {
      return await performCollectionShare({
        // Wait for layout, every required image, and a short render settle before capture.
        nextFrame: () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
        imagesReady: () => loadGate.wait(imageWaitMs),
        settle: () => new Promise<void>((resolve) => setTimeout(resolve, 120)),
        captureViewAsPng: () => (card.current
          ? captureViewAsPng(card.current, { ...collectionShareCaptureSize, fileName: 'masscom-collection' })
          : Promise.resolve(undefined)),
        exportImageFile: (uri, isAlive) => exportImageFile(uri, 'masscom-collection', '도감 공유', isAlive),
        isAlive: () => alive.current,
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
      <CollectionShareCard ref={card} model={model} onImageLoaded={onImageLoaded} onImageFailed={onImageFailed} />
    </View>
  ) : null;

  return { host, share, sharing };
}

const headerTop = 10;
const headerHeight = 60;
const gridTop = headerTop + headerHeight + 8;
const frameHeight = 58;
const cellHeight = frameHeight + 70;
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
  title: { color: lightMedalColors.skyInk, fontSize: 23, fontWeight: '900', letterSpacing: -0.4 },
  subtitle: { color: lightMedalColors.skyMuted, fontSize: 14, fontWeight: '700' },
  grid: { position: 'absolute', top: gridTop, left: sidePadding, right: sidePadding, height: gridHeight, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignContent: 'flex-start', columnGap, rowGap: 6 },
  cell: { height: cellHeight, gap: 2 },
  wideCell: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  frame: { alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 3 },
  placeholder: { width: frameHeight - 20, height: frameHeight - 20 },
  textBlock: { gap: 2, alignItems: 'center' },
  itemTitle: { height: 33, color: lightMedalColors.skyInk, fontSize: 11, lineHeight: 11, fontWeight: '800', textAlign: 'center' },
  itemStore: { height: 30, color: lightMedalColors.skyMuted, fontSize: 10, lineHeight: 10, fontWeight: '600', textAlign: 'center' },
  medalRow: { position: 'absolute', top: medalTop, left: sidePadding, right: sidePadding, height: 44, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 },
  medal: { width: (cardWidth - sidePadding * 2 - 12) / 3, flexDirection: 'row', alignItems: 'center', gap: 4, justifyContent: 'center' },
  medalText: { flexShrink: 1 },
  medalName: { color: lightMedalColors.skyInk, fontSize: 10, fontWeight: '800' },
  medalTier: { color: lightMedalColors.skyMuted, fontSize: 10, fontWeight: '700' },
  demo: {
    position: 'absolute', top: medalTop + 44, alignSelf: 'center', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10, overflow: 'hidden',
    color: lightColors.onAccentContainer, backgroundColor: lightColors.accentContainer, fontSize: 11, fontWeight: '800',
  },
  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: footerHeight, alignItems: 'center', justifyContent: 'center',
    backgroundColor: sky[2], borderTopWidth: 1, borderTopColor: lightColors.separator,
  },
  footerText: { color: lightMedalColors.skyMuted, fontSize: 12, fontWeight: '800' },
});
