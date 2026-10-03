import { useCallback, useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { Image, Share, StyleSheet, Text, View } from 'react-native';

import { captureViewAsPng, shareImageFile } from '@/gamification/native-effects';
import { lightColors } from '@/theme/palette';

import { performShare, type ShareOutcome } from './collectible-share-flow';
import { gradeMaterialFor } from './grade-material';
import { GradeMaterialLayer } from './grade-material-layer';

export type ShareableCollectible = {
  thumbnailDataUrl: string; merchantName: string; name: string;
  gradeId: string; gradeName: string; shape: 'circle' | 'stamp' | 'serrated';
};

export type { ShareOutcome };

const cardSize = { width: 320, height: 400 } as const;

function shareLine(item: ShareableCollectible): string {
  return `${item.merchantName}에서 ${item.name}을 받았어요.`;
}

/**
 * 16장 공유: 대표 이미지·가게 이름·짧은 문구를 담은 이미지를 만들어 OS 공유 시트로만 내보낸다(자동 게시·자동 전송 없음).
 * badge-rewards의 useBadgeShare와 같은 방식: 카드를 화면 밖에 그렸다가 캡처해 공유하고, 실패하면 같은 문구를 텍스트로 공유한다.
 */
export function useCollectibleShare(): { host: ReactNode; share: (item: ShareableCollectible) => Promise<ShareOutcome>; sharing: boolean } {
  const [item, setItem] = useState<ShareableCollectible>();
  const [sharing, setSharing] = useState(false);
  const card = useRef<View>(null);
  // The screen that owns this hook remounts per account (route key=accountId). If it unmounts while a share is being
  // prepared (capture, frame waits, or even inside shareImageFile's own awaits), the job must stop before it reaches
  // the share sheet with the previous account's collectible — there is no reward-safety issue, only stale data
  // leaking into a share action.
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const share = useCallback(async (target: ShareableCollectible): Promise<ShareOutcome> => {
    setSharing(true);
    setItem(target);
    try {
      return await performShare({
        // Two frames so the image lays out before the snapshot, then a short settle like useBadgeShare.
        nextFrame: () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
        settle: () => new Promise<void>((resolve) => setTimeout(resolve, 120)),
        captureViewAsPng: () => (card.current ? captureViewAsPng(card.current) : Promise.resolve(undefined)),
        shareImageFile: (uri, isAlive) => shareImageFile(uri, '수집품 공유', isAlive),
        shareText: () => Share.share({ message: shareLine(target) }).then(() => undefined),
        isAlive: () => alive.current,
      });
    } finally {
      if (alive.current) {
        setItem(undefined);
        setSharing(false);
      }
    }
  }, []);

  const host = item ? (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.offscreen}>
      <ShareableCollectibleCard ref={card} item={item} />
    </View>
  ) : null;

  return { host, share, sharing };
}

function ShareableCollectibleCard({ item, ref }: { item: ShareableCollectible; ref?: Ref<View> }) {
  const material = gradeMaterialFor(item.gradeId, item.gradeName);
  return (
    <View ref={ref} collapsable={false} style={styles.card}>
      <View style={styles.image}>
        <Image source={{ uri: item.thumbnailDataUrl }} resizeMode="contain" style={StyleSheet.absoluteFill} />
        {material === 'gold' || material === 'prism' ? (
          <GradeMaterialLayer material={material} size={200} faceUri={item.thumbnailDataUrl} shape={item.shape}
            variant="card" active={false} />
        ) : null}
      </View>
      <Text allowFontScaling={false} style={styles.merchant}>{item.merchantName}</Text>
      <Text allowFontScaling={false} style={styles.line}>{shareLine(item)}</Text>
      <Text allowFontScaling={false} style={styles.footer}>MassCOM 도감</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  offscreen: { position: 'absolute', top: 0, left: -10000, width: cardSize.width, height: cardSize.height },
  card: { width: cardSize.width, height: cardSize.height, alignItems: 'center', paddingTop: 32, paddingHorizontal: 24, gap: 12, backgroundColor: '#FFFFFF' },
  image: { width: 200, height: 200 },
  merchant: { color: lightColors.label, fontSize: 20, fontWeight: '900', textAlign: 'center' },
  line: { color: lightColors.secondaryLabel, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  footer: { marginTop: 'auto', marginBottom: 16, color: lightColors.secondaryLabel, fontSize: 11, fontWeight: '800' },
});
