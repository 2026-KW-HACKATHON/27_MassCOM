import { useRef } from 'react';
import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions, type ImageSourcePropType } from 'react-native';

import { friendArt } from '@/shop/shop-art';
import { merchantArtSource } from '@/screens/collection/merchant-art';
import { Companion } from '@/ui/companion';

import type { PublicStudio, StudioItem } from './studio-api';

const rooms = {
  daylight: require('../../assets/images/play/room-daylight.png'),
  evening: require('../../assets/images/play/room-evening.png'),
  garden: require('../../assets/images/play/room-garden.png'),
} as const;
const mascot = require('../../assets/images/mascot/v2/wave.png');
const accentColors = { mint: '#68BAAC', rose: '#E78F9B', sky: '#72A7E6' } as const;

export function CompanionScene({ avatar, size = 160, onLoad, onError }: {
  avatar: string | null; size?: number; onLoad?: () => void; onError?: () => void;
}) {
  const source: ImageSourcePropType | undefined = avatar ? friendArt[avatar] : undefined;
  if (onLoad) return <Image source={source ?? mascot} resizeMode="contain" onLoad={onLoad} onError={onError}
    accessible accessibilityLabel={source ? '선택한 동행' : '동행을 기다리는 마스코트'} style={{ width: size, height: size }} />;
  return <Companion art={source} size={size} />;
}

export function StudioScene({ studio, items, avatar, apiUrl, onItemPress, onAssetsReady, onAssetError, width = 360, height = 330 }: {
  studio: PublicStudio; items: readonly StudioItem[]; avatar: string | null; apiUrl: string;
  onItemPress?: (item: StudioItem) => void; onAssetsReady?: () => void; onAssetError?: () => void;
  width?: number; height?: number;
}) {
  const { fontScale } = useWindowDimensions();
  const loaded = useRef(new Set<string>());
  const accent = accentColors[studio.accent];
  const sceneItems = items.slice(0, 6);
  const shelf = studio.layout === 'shelf';
  const expectedAssets = 2 + sceneItems.filter((item) => !!item.artwork?.thumbnailDataUrl ||
    !!merchantArtSource({ id: item.merchantId }, apiUrl)).length;
  const markLoaded = (key: string) => {
    if (!onAssetsReady) return;
    loaded.current.add(key);
    if (loaded.current.size === expectedAssets) onAssetsReady();
  };
  return (
    <View style={[styles.scene, { width, height, backgroundColor: '#DDF2FB' }]}>
      <Image source={rooms[studio.theme]} resizeMode="cover" style={styles.backdrop} accessible={false}
        onLoad={() => markLoaded('room')} onError={onAssetError} />
      <View style={[styles.accentLine, { borderColor: accent }]} />
      <View style={[styles.companion, { left: width * 0.285, bottom: height * 0.17 }]}>
        <CompanionScene avatar={avatar} size={Math.min(width * 0.43, height * 0.46)}
          onLoad={onAssetsReady ? () => markLoaded('companion') : undefined} onError={onAssetError} />
      </View>
      {sceneItems.map((item, index) => {
          const source = item.artwork?.thumbnailDataUrl
            ? { uri: item.artwork.thumbnailDataUrl }
            : merchantArtSource({ id: item.merchantId }, apiUrl);
          const column = shelf ? index % 2 : index % 3;
          const row = shelf ? Math.floor(index / 2) : Math.floor(index / 3);
          return (
            <Pressable key={item.entitlementId ?? `${item.merchantId}-${index}`}
              accessibilityRole={onItemPress ? 'button' : 'image'}
              accessibilityLabel={`${item.displayName}, ${item.merchantName}`}
              disabled={!onItemPress} onPress={() => onItemPress?.(item)}
              style={[styles.item, { borderColor: accent, width: width * (shelf ? 0.13 : 0.17), height: height * (shelf ? 0.13 : 0.17),
                left: width * (shelf ? (column ? 0.79 : 0.08) : (0.15 + column * 0.27)),
                top: height * (shelf ? (0.17 + row * 0.14) : (0.13 + row * 0.2)) }]}>
              {source ? <Image source={source} resizeMode="contain" style={styles.itemImage} accessible={false}
                onLoad={() => markLoaded(`item-${index}`)} onError={onAssetError} />
                : <Text style={styles.missingArt} numberOfLines={2}>{item.displayName}</Text>}
            </Pressable>
          );
        })}
      {!sceneItems.length && fontScale < 1.5 ? <View style={[styles.empty, { right: width * 0.06, top: height * 0.29 }]}>
        <Text style={styles.emptyText}>첫 수집품을 기다리는 공간</Text>
      </View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  scene: { overflow: 'hidden', position: 'relative' },
  backdrop: { position: 'absolute', width: '100%', height: '100%', top: 0 },
  accentLine: { position: 'absolute', bottom: 0, left: 0, width: '100%', borderBottomWidth: 5 },
  companion: { position: 'absolute' },
  item: { position: 'absolute', backgroundColor: '#FFFFFF', borderWidth: 2, borderRadius: 7, alignItems: 'center', justifyContent: 'center', padding: 3 },
  itemImage: { width: '100%', height: '100%' },
  missingArt: { color: '#35445B', textAlign: 'center', fontSize: 10, fontWeight: '700' },
  empty: { position: 'absolute', width: '46%', backgroundColor: '#FFFFFFDD', padding: 9, borderRadius: 6 },
  emptyText: { color: '#34445B', fontWeight: '700', fontSize: 12, textAlign: 'center' },
});
