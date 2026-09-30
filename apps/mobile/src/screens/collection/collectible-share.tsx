import { useCallback, useRef, useState, type ReactNode, type Ref } from 'react';
import { Image, Share, StyleSheet, Text, View } from 'react-native';

import { captureViewAsPng, shareImageFile } from '@/gamification/native-effects';
import { lightColors } from '@/theme/palette';

export type ShareableCollectible = { thumbnailDataUrl: string; merchantName: string; name: string };

export type ShareOutcome = 'image' | 'text' | 'failed';

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

  const share = useCallback(async (target: ShareableCollectible): Promise<ShareOutcome> => {
    setSharing(true);
    setItem(target);
    try {
      try {
        // Two frames so the image lays out before the snapshot, then a short settle like useBadgeShare.
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        await new Promise((resolve) => setTimeout(resolve, 120));
        if (card.current) {
          const uri = await captureViewAsPng(card.current);
          if (await shareImageFile(uri, '수집품 공유')) return 'image';
        }
      } catch {
        // Image capture or the file share sheet is unavailable on this build; share text instead.
      } finally {
        setItem(undefined);
      }
      try {
        await Share.share({ message: shareLine(target) });
        return 'text';
      } catch {
        return 'failed';
      }
    } finally {
      setSharing(false);
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
  return (
    <View ref={ref} collapsable={false} style={styles.card}>
      <Image source={{ uri: item.thumbnailDataUrl }} resizeMode="contain" style={styles.image} />
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
