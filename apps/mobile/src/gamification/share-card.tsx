import { useCallback, useRef, useState, type ReactNode, type Ref } from 'react';
import { Image, Share, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { lightMedalColors } from '@/theme/medal-colors';
import { lightColors } from '@/theme/palette';

import type { Medal } from './badge-api';
import { shareCardCopy, shareMessage, type ShareVariant } from './badge-rules';
import { exploreBanner, mascotStamp } from './glyphs';
import { Medallion } from './medallion';
import { captureViewAsPng, shareImageFile } from './native-effects';

/** 4:5 so it drops into feeds without cropping. */
export const shareCardSize = { width: 360, height: 450 } as const;
const bannerHeight = 200;
const medalSize = 136;
/** The medal overlaps the white body by a quarter of its height, never more. */
const medalTop = bannerHeight - Math.round(medalSize * 0.75);
const sky = lightMedalColors.sky;

/**
 * The image people post: the approved mascot banner, a cloud edge into a white body, the medal
 * and one line. Every layer is opaque (the PNG has no transparent pixels that some share
 * previews turn black) and the card is always drawn in the light scheme.
 */
export function ShareCard({ medal, variant, onImageLoad, ref }: {
  medal: Medal;
  variant: ShareVariant;
  onImageLoad?: () => void;
  ref?: Ref<View>;
}) {
  const copy = shareCardCopy(medal, variant);
  const { width } = shareCardSize;
  return (
    <View ref={ref} collapsable={false} style={cardStyles.card}>
      <Svg width={width} height={bannerHeight} style={cardStyles.skyBlock}>
        <Defs>
          <LinearGradient id="shareSky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={sky[0]} />
            <Stop offset="1" stopColor={sky[1]} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={bannerHeight} fill="url(#shareSky)" />
      </Svg>
      <Image source={exploreBanner} onLoad={onImageLoad} resizeMode="cover" style={cardStyles.banner} />
      <Svg width={width} height={44} style={cardStyles.cloudEdge}>
        <Path d={cloudEdgePath(width, 44)} fill="#FFFFFF" />
      </Svg>

      <View style={cardStyles.medalHalo} />
      <View style={cardStyles.medal}>
        <Medallion
          kind={medal.kind}
          tier={medal.tier}
          progress={null}
          size={medalSize}
          colors={lightMedalColors}
          arcColor={lightColors.primary}
          trackColor={lightColors.separator}
        />
      </View>

      <View style={cardStyles.body}>
        <Text allowFontScaling={false} style={cardStyles.eyebrow}>{copy.eyebrow}</Text>
        <Text allowFontScaling={false} style={cardStyles.title}>{copy.title}</Text>
        <Text allowFontScaling={false} style={cardStyles.text}>{copy.body}</Text>
        {copy.demoNote ? <Text allowFontScaling={false} style={cardStyles.demo}>{copy.demoNote}</Text> : null}
      </View>

      <View style={cardStyles.footer}>
        <Image source={mascotStamp} style={cardStyles.footerStamp} />
        <Text allowFontScaling={false} style={cardStyles.footerText}>{copy.footer}</Text>
      </View>
    </View>
  );
}

/** Opaque white cloud bumps rising over the bottom of the banner. */
function cloudEdgePath(width: number, height: number): string {
  const bumps = 7;
  const step = width / bumps;
  let d = `M0 ${height} L0 ${height * 0.55}`;
  for (let index = 0; index < bumps; index += 1) {
    const x = index * step;
    const peak = index % 2 === 0 ? height * 0.05 : height * 0.3;
    d += ` C${(x + step * 0.1).toFixed(1)} ${peak.toFixed(1)} ${(x + step * 0.9).toFixed(1)} ${peak.toFixed(1)} ${(x + step).toFixed(1)} ${(height * 0.55).toFixed(1)}`;
  }
  return `${d} L${width} ${height} Z`;
}

export type ShareOutcome = 'image' | 'text' | 'failed';

/**
 * Renders the share card off-screen only while sharing, captures it as PNG and opens the
 * system share sheet. Falls back to the same privacy-safe text when image sharing is unavailable.
 * Place `host` inside whatever screen or modal is currently on top.
 */
export function useBadgeShare(variant: ShareVariant): {
  host: ReactNode;
  share: (medal: Medal) => Promise<ShareOutcome>;
  sharing: boolean;
} {
  const [medal, setMedal] = useState<Medal>();
  const [sharing, setSharing] = useState(false);
  const card = useRef<View>(null);
  const imageReady = useRef<() => void>(undefined);

  const share = useCallback(async (target: Medal): Promise<ShareOutcome> => {
    if (target.tier === 0) return 'failed';
    setSharing(true);
    const loaded = new Promise<void>((resolve) => {
      imageReady.current = resolve;
      setTimeout(resolve, 1500);
    });
    setMedal(target);
    try {
      await loaded;
      // Two frames so the medal ring and text are laid out before the snapshot.
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      await new Promise((resolve) => setTimeout(resolve, 120));
      if (card.current) {
        const uri = await captureViewAsPng(card.current);
        if (await shareImageFile(uri, '배지 공유')) return 'image';
      }
    } catch {
      // Image capture or the file share sheet is unavailable on this build; share text instead.
    } finally {
      setMedal(undefined);
      imageReady.current = undefined;
    }
    try {
      await Share.share({ message: shareMessage(target, variant) });
      return 'text';
    } catch {
      return 'failed';
    } finally {
      setSharing(false);
    }
  }, [variant]);

  const host = medal ? (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={cardStyles.offscreen}
    >
      <ShareCard ref={card} medal={medal} variant={variant} onImageLoad={() => imageReady.current?.()} />
    </View>
  ) : null;

  return { host, share, sharing };
}

const cardStyles = StyleSheet.create({
  offscreen: { position: 'absolute', top: 0, left: -10000, width: shareCardSize.width, height: shareCardSize.height },
  card: { width: shareCardSize.width, height: shareCardSize.height, overflow: 'hidden', backgroundColor: '#FFFFFF' },
  skyBlock: { position: 'absolute', top: 0, left: 0 },
  banner: { position: 'absolute', top: 0, left: 0, width: shareCardSize.width, height: bannerHeight },
  cloudEdge: { position: 'absolute', left: 0, top: bannerHeight - 30 },
  medalHalo: {
    position: 'absolute', top: medalTop - 7, left: (shareCardSize.width - medalSize - 14) / 2,
    width: medalSize + 14, height: medalSize + 14, borderRadius: (medalSize + 14) / 2,
    backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: sky[0],
  },
  medal: { position: 'absolute', top: medalTop, left: (shareCardSize.width - medalSize) / 2 },
  body: { position: 'absolute', top: medalTop + medalSize + 14, left: 24, right: 24, alignItems: 'center', gap: 6 },
  eyebrow: { color: lightMedalColors.skyMuted, fontSize: 12, fontWeight: '800', letterSpacing: 0.8 },
  title: { color: lightMedalColors.skyInk, fontSize: 26, fontWeight: '900', lineHeight: 33, textAlign: 'center', letterSpacing: -0.4 },
  text: { color: lightMedalColors.skyMuted, fontSize: 15, fontWeight: '600', lineHeight: 22, textAlign: 'center' },
  demo: {
    marginTop: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, overflow: 'hidden',
    color: lightColors.onAccentContainer, backgroundColor: lightColors.accentContainer, fontSize: 12, fontWeight: '800',
  },
  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, backgroundColor: sky[2], borderTopWidth: 1, borderTopColor: lightColors.separator,
  },
  footerStamp: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#FFFFFF' },
  footerText: { color: lightMedalColors.skyMuted, fontSize: 12, fontWeight: '800' },
});
