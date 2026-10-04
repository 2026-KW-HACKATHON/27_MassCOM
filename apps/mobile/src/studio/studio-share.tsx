import { useCallback, useRef, useState, type Ref } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { captureViewAsPng, exportImageFile } from '@/gamification/native-effects';

import type { PublicStudio, StudioItem } from './studio-api';
import { StudioScene } from './studio-scene';

type Format = 'feed' | 'story';
const cardSizes = { feed: { width: 360, height: 450 }, story: { width: 360, height: 640 } } as const;
const imageSizes = { feed: { width: 1080, height: 1350 }, story: { width: 1080, height: 1920 } } as const;
const sceneHeights = { feed: 275, story: 450 } as const;
const copyHeights = { feed: 130, story: 145 } as const;
const brand = require('../../assets/images/mascot/v2/logo-badge.png');

export function StudioShareCard({ studio, items, avatar, apiUrl, format, demoNote, onReady, onAssetError, ref }: {
  studio: PublicStudio; items: readonly StudioItem[]; avatar: string | null; apiUrl: string;
  format: Format; demoNote?: boolean; onReady?: () => void; onAssetError?: () => void; ref?: Ref<View>;
}) {
  const sceneReady = useRef(false);
  const brandReady = useRef(false);
  const ready = () => { if (sceneReady.current && brandReady.current) onReady?.(); };
  const first = items[0];
  return (
    <View ref={ref} collapsable={false} style={[styles.card, cardSizes[format]]}>
      <View style={{ width: 360, height: sceneHeights[format] }}>
        <StudioScene studio={studio} items={items} avatar={avatar} apiUrl={apiUrl}
          width={360} height={sceneHeights[format]}
          onAssetsReady={() => { sceneReady.current = true; ready(); }} onAssetError={onAssetError} />
      </View>
      <View style={[styles.copy, { height: copyHeights[format] }]}>
        <Text allowFontScaling={false} style={styles.eyebrow}>MASSCOM · 나의 공간</Text>
        <Text allowFontScaling={false} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.6} style={styles.title}>
          {first?.merchantName ?? '함께 모은 우리 동네'}
        </Text>
        <Text allowFontScaling={false} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.6} style={styles.summary}>
          {first ? `${first.displayName}${items.length > 1 ? ` 외 ${items.length - 1}개` : ''}` : '첫 동행과 첫 수집품을 기다려요'}
        </Text>
        {demoNote ? <Text allowFontScaling={false} style={styles.demo}>체험용 가상 기록 · 실제 방문 혜택이 아니에요</Text> : null}
      </View>
      <View style={styles.footer}>
        <Image source={brand} onLoad={() => { brandReady.current = true; ready(); }} onError={onAssetError}
          style={styles.brand} resizeMode="contain" />
        <Text allowFontScaling={false} style={styles.footerText}>MassCOM · 동네를 발견하는 즐거움</Text>
      </View>
    </View>
  );
}

type ShareTarget = { id: number; studio: PublicStudio; items: StudioItem[]; avatar: string | null; format: Format; demoNote: boolean };
export type StudioShareOutcome = 'shared' | 'saved' | 'cancelled' | 'unavailable';

export function useStudioShare(apiUrl: string, isAlive: () => boolean, demoNote: boolean,
  onEvent?: (event: 'share-open' | 'image-created') => void) {
  const [target, setTarget] = useState<ShareTarget>();
  const [sharing, setSharing] = useState(false);
  const busy = useRef(false);
  const nextId = useRef(0);
  const card = useRef<View>(null);
  const pending = useRef<{ resolve: () => void; reject: (error: Error) => void }>(undefined);

  const share = useCallback(async (studio: PublicStudio, items: readonly StudioItem[], avatar: string | null, format: Format): Promise<StudioShareOutcome> => {
    if (busy.current || !isAlive()) return 'cancelled';
    busy.current = true;
    setSharing(true);
    const ready = new Promise<void>((resolve, reject) => { pending.current = { resolve, reject }; });
    const timeout = setTimeout(() => pending.current?.reject(new Error('SHARE_ASSET_TIMEOUT')), 4000);
    const cancellation = setInterval(() => { if (!isAlive()) pending.current?.reject(new Error('SHARE_CANCELLED')); }, 100);
    setTarget({ id: ++nextId.current, studio, items: [...items], avatar, format, demoNote });
    try {
      await ready;
      clearTimeout(timeout);
      clearInterval(cancellation);
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (!isAlive() || !card.current) return 'cancelled';
      const uri = await captureViewAsPng(card.current, { ...imageSizes[format], fileName: `masscom-studio-${format}` });
      if (!isAlive()) return 'cancelled';
      onEvent?.('image-created');
      const outcome = await exportImageFile(uri, `masscom-studio-${format}`, '나의 공간 공유', isAlive);
      if (outcome === 'shared' && isAlive()) onEvent?.('share-open');
      return outcome;
    } finally {
      clearTimeout(timeout);
      clearInterval(cancellation);
      pending.current = undefined;
      setTarget(undefined);
      busy.current = false;
      setSharing(false);
    }
  }, [demoNote, isAlive, onEvent]);

  const host = target ? (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.offscreen}>
      <StudioShareCard key={target.id} ref={card} {...target} apiUrl={apiUrl}
        onReady={() => pending.current?.resolve()}
        onAssetError={() => pending.current?.reject(new Error('SHARE_ASSET_FAILED'))} />
    </View>
  ) : null;
  return { host, share, sharing };
}

export function ShareFormatButtons({ disabled, onShare }: { disabled: boolean; onShare: (format: Format) => void }) {
  return <View style={styles.actions}>
    <Pressable accessibilityRole="button" disabled={disabled} onPress={() => onShare('feed')} style={[styles.button, disabled && styles.disabled]}>
      <Text style={styles.buttonText}>피드 4:5</Text>
    </Pressable>
    <Pressable accessibilityRole="button" disabled={disabled} onPress={() => onShare('story')} style={[styles.button, disabled && styles.disabled]}>
      <Text style={styles.buttonText}>스토리 9:16</Text>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  offscreen: { position: 'absolute', left: -10000, top: 0, width: 360, height: 640 },
  card: { backgroundColor: '#FFFFFF', overflow: 'hidden' },
  copy: { paddingHorizontal: 20, paddingVertical: 5, alignItems: 'center', justifyContent: 'center', gap: 2 },
  eyebrow: { color: '#327C8B', fontSize: 11, lineHeight: 14, fontWeight: '800' },
  title: { color: '#182940', fontSize: 20, lineHeight: 24, fontWeight: '900', textAlign: 'center', width: '100%' },
  summary: { color: '#536577', fontSize: 12, lineHeight: 17, fontWeight: '600', textAlign: 'center', width: '100%' },
  demo: { color: '#7B401E', backgroundColor: '#FFF1D8', fontSize: 10, lineHeight: 15, fontWeight: '800', paddingHorizontal: 5 },
  footer: { width: 360, height: 45, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderTopWidth: 1, borderTopColor: '#E6EDF0' },
  brand: { width: 24, height: 24 }, footerText: { color: '#42576B', fontSize: 11, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 8 },
  button: { flex: 1, minHeight: 44, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2456D6' },
  buttonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' }, disabled: { opacity: 0.45 },
});
