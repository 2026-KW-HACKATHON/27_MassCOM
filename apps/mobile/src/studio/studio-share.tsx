import { useCallback, useRef, useState, type Ref } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { captureViewAsPng, exportImageFile } from '@/gamification/native-effects';
import { useMotionEnabled } from '@/motion/use-motion';
import { studioComposition } from './studio-composition';
import type { ExperienceProfile } from '@/experience/experience-api';
import { merchantArtSource } from '@/screens/collection/merchant-art';
import { gradeMaterialFor, gradeMaterialPresets } from '@/screens/collection/grade-material';

import type { PublicStudio, StudioItem } from './studio-api';
import { CompanionScene, StudioCoin, StudioScene } from './studio-scene';
import { studioShareLifetime } from './studio-share-lifetime';
import { cancelStudioVideo, exportStudioVideo, saveStudioImage } from './studio-video';

type Format = 'feed' | 'story';
type Media = 'image' | 'video';
const cardSizes = { feed: { width: 360, height: 450 }, story: { width: 360, height: 640 } } as const;
const imageSizes = { feed: { width: 1080, height: 1350 }, story: { width: 1080, height: 1920 } } as const;
const sceneHeights = { feed: 275, story: 252 } as const;
const copyHeights = { feed: 130, story: 125 } as const;
const sceneTops = { feed: 0, story: 90 } as const;
const brand = require('../../assets/images/mascot/v2/logo-badge.png');

export function StudioShareCard({ studio, items, avatar, apiUrl, format, media = 'image', experienceProfile, badgeName,
  demoNote, onReady, onAssetError, ref }: {
  studio: PublicStudio; items: readonly StudioItem[]; avatar: string | null; apiUrl: string;
  format: Format; media?: Media; experienceProfile?: ExperienceProfile; badgeName?: string;
  demoNote?: boolean; onReady?: () => void; onAssetError?: () => void; ref?: Ref<View>;
}) {
  const sceneReady = useRef(false);
  const brandReady = useRef(false);
  const ready = () => { if (sceneReady.current && brandReady.current) onReady?.(); };
  const first = items[0];
  return (
    <View ref={ref} collapsable={false} style={[styles.card, cardSizes[format],
      { paddingTop: sceneTops[format], backgroundColor: format === 'story' ? '#EDF5F8' : '#FFFFFF' }]}>
      <View style={{ width: 360, height: sceneHeights[format] }}>
        <StudioScene studio={studio} items={items} avatar={avatar} apiUrl={apiUrl}
          experienceProfile={experienceProfile} badgeName={badgeName}
          videoBackground={media === 'video'}
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

type ShareTarget = { id: number; studio: PublicStudio; items: StudioItem[]; avatar: string | null; format: Format;
  media: Media; experienceProfile?: ExperienceProfile; badgeName?: string; demoNote: boolean };
export type StudioShareOutcome = 'shared' | 'saved' | 'cancelled' | 'unavailable';

export function useStudioShare(apiUrl: string, isAlive: () => boolean, demoNote: boolean,
  onEvent?: (event: 'share-open' | 'image-created') => void, generation?: () => number) {
  const motionEnabled = useMotionEnabled();
  const [target, setTarget] = useState<ShareTarget>();
  const [sharing, setSharing] = useState(false);
  const busy = useRef(false);
  const nextId = useRef(0);
  const card = useRef<View>(null);
  const avatarView = useRef<View>(null);
  const coinView = useRef<View>(null);
  const readyFlags = useRef({ card: false, avatar: false, coin: false });
  const pending = useRef<{ id: number; resolve: () => void; reject: (error: Error) => void }>(undefined);
  const markReady = (key: 'card' | 'avatar' | 'coin', id: number) => {
    if (pending.current?.id !== id) return;
    readyFlags.current[key] = true;
    if (Object.values(readyFlags.current).every(Boolean)) pending.current?.resolve();
  };

  const share = useCallback(async (studio: PublicStudio, items: readonly StudioItem[], avatar: string | null,
    format: Format, media: Media = 'image', experienceProfile?: ExperienceProfile, badgeName?: string,
    representativeCoin?: StudioItem): Promise<StudioShareOutcome> => {
    const alive = studioShareLifetime(isAlive, generation);
    if (busy.current || !alive()) return 'cancelled';
    busy.current = true;
    setSharing(true);
    const id = ++nextId.current;
    const ready = new Promise<void>((resolve, reject) => { pending.current = { id, resolve, reject }; });
    const featured = representativeCoin ?? items.find((item) => item.entitlementId === experienceProfile?.coinEntitlementId);
    const ordered = featured ? [featured, ...items.filter((item) => item.entitlementId !== featured.entitlementId)].slice(0, 6) : [...items];
    const first = ordered[0];
    const coinSource = first?.artwork?.thumbnailDataUrl
      ? { uri: first.artwork.thumbnailDataUrl } : first ? merchantArtSource({ id: first.merchantId }, apiUrl) : undefined;
    readyFlags.current = { card: false, avatar: media === 'image', coin: media === 'image' || !coinSource };
    const timeout = setTimeout(() => pending.current?.reject(new Error('SHARE_ASSET_TIMEOUT')), 8000);
    const cancellation = setInterval(() => {
      if (!alive()) { pending.current?.reject(new Error('SHARE_CANCELLED')); void cancelStudioVideo(); }
    }, 100);
    setTarget({ id, studio, items: ordered, avatar, format, media, experienceProfile, badgeName, demoNote });
    try {
      await ready;
      clearTimeout(timeout);
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (!alive() || !card.current) return 'cancelled';
      const size = imageSizes[format];
      const uri = await captureViewAsPng(card.current, { ...size, fileName: `masscom-studio-${format}` });
      if (!alive()) return 'cancelled';
      if (media === 'video') {
        if (!avatarView.current) throw new Error('SHARE_AVATAR_MISSING');
        const avatarUri = await captureViewAsPng(avatarView.current, { width: 512, height: 512, fileName: 'masscom-video-avatar' });
        const coinUri = coinSource && coinView.current
          ? await captureViewAsPng(coinView.current, { width: 512, height: 512, fileName: 'masscom-video-coin' }) : undefined;
        if (!alive()) return 'cancelled';
        const coinMaterial = gradeMaterialFor(first?.artwork?.gradeId ?? '', first?.artwork?.gradeName ?? '');
        const outcome = await exportStudioVideo({ backgroundUri: uri, avatarUri, coinUri,
          coinColors: gradeMaterialPresets[coinMaterial].colors,
          width: size.width, height: size.height, sceneHeight: sceneHeights[format] * 3,
          sceneTop: sceneTops[format] * 3, coinSizeRatio: studioComposition.coinSizeRatio, motionEnabled }, alive,
          () => { if (alive()) onEvent?.('share-open'); });
        return outcome;
      }
      onEvent?.('image-created');
      const saved = await saveStudioImage(uri);
      if (!alive()) return 'cancelled';
      const outcome = await exportImageFile(uri, `masscom-studio-${format}`, '나의 공간 공유', alive);
      if (outcome === 'shared' && alive()) onEvent?.('share-open');
      return saved ? 'saved' : outcome;
    } catch (error) {
      if (!alive() || error instanceof Error && error.message === 'SHARE_CANCELLED') return 'cancelled';
      throw error;
    } finally {
      clearTimeout(timeout);
      clearInterval(cancellation);
      pending.current = undefined;
      setTarget(undefined);
      busy.current = false;
      setSharing(false);
    }
  }, [apiUrl, demoNote, isAlive, onEvent, motionEnabled, generation]);

  const face = target?.items[0];
  const coinSource = face?.artwork?.thumbnailDataUrl
    ? { uri: face.artwork.thumbnailDataUrl } : face ? merchantArtSource({ id: face.merchantId }, apiUrl) : undefined;
  const host = target ? (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.offscreen}>
      <StudioShareCard key={target.id} ref={card} {...target} apiUrl={apiUrl}
        onReady={() => markReady('card', target.id)}
        onAssetError={() => { if (pending.current?.id === target.id) pending.current.reject(new Error('SHARE_ASSET_FAILED')); }} />
      {target.media === 'video' ? <>
        <View ref={avatarView} collapsable={false} style={styles.layer}>
          <CompanionScene avatar={target.avatar} experienceProfile={target.experienceProfile} size={170} onLoad={() => markReady('avatar', target.id)}
            onError={() => { if (pending.current?.id === target.id) pending.current.reject(new Error('SHARE_ASSET_FAILED')); }} />
        </View>
        {coinSource ? <View ref={coinView} collapsable={false} style={styles.layer}>
          <StudioCoin item={face!} apiUrl={apiUrl} size={170} onLoad={() => markReady('coin', target.id)}
            onError={() => { if (pending.current?.id === target.id) pending.current.reject(new Error('SHARE_ASSET_FAILED')); }} />
        </View> : null}
      </> : null}
    </View>
  ) : null;
  return { host, share, sharing };
}

export function ShareFormatButtons({ disabled, onShare }: { disabled: boolean; onShare: (format: Format, media: Media) => void }) {
  return <View style={styles.actions}>
    <Pressable accessibilityRole="button" disabled={disabled} onPress={() => onShare('feed', 'image')} style={[styles.button, disabled && styles.disabled]}>
      <Text style={styles.buttonText}>피드 사진</Text>
    </Pressable>
    <Pressable accessibilityRole="button" disabled={disabled} onPress={() => onShare('story', 'image')} style={[styles.button, disabled && styles.disabled]}>
      <Text style={styles.buttonText}>스토리 사진</Text>
    </Pressable>
    <Pressable accessibilityRole="button" disabled={disabled} onPress={() => onShare('feed', 'video')} style={[styles.button, disabled && styles.disabled]}>
      <Text style={styles.buttonText}>피드 영상</Text>
    </Pressable>
    <Pressable accessibilityRole="button" disabled={disabled} onPress={() => onShare('story', 'video')} style={[styles.button, disabled && styles.disabled]}>
      <Text style={styles.buttonText}>스토리 영상</Text>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  offscreen: { position: 'absolute', left: -10000, top: 0, width: 360, height: 640 },
  layer: { width: 170, height: 170, backgroundColor: 'transparent' },
  card: { backgroundColor: '#FFFFFF', overflow: 'hidden' },
  copy: { paddingHorizontal: 20, paddingVertical: 3, alignItems: 'center', justifyContent: 'center', gap: 2 },
  eyebrow: { color: '#327C8B', fontSize: 11, lineHeight: 14, fontWeight: '800' },
  title: { color: '#182940', fontSize: 20, lineHeight: 24, fontWeight: '900', textAlign: 'center', width: '100%' },
  summary: { color: '#536577', fontSize: 12, lineHeight: 17, fontWeight: '600', textAlign: 'center', width: '100%' },
  demo: { color: '#7B401E', backgroundColor: '#FFF1D8', fontSize: 10, lineHeight: 15, fontWeight: '800', paddingHorizontal: 5 },
  footer: { width: 360, height: 45, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderTopWidth: 1, borderTopColor: '#E6EDF0' },
  brand: { width: 24, height: 24 }, footerText: { color: '#42576B', fontSize: 11, fontWeight: '700' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: { flex: 1, minHeight: 44, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2456D6' },
  buttonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' }, disabled: { opacity: 0.45 },
});
