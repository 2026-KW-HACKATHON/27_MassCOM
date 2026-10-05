import { useRef } from 'react';
import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions, type ImageSourcePropType } from 'react-native';

import { friendArt } from '@/shop/shop-art';
import { AvatarEquipment } from '@/experience/avatar-equipment';
import type { DisplayExperienceProfile } from '@/experience/experience-api';
import { merchantArtSource } from '@/screens/collection/merchant-art';
import { gradeMaterialFor, gradeMaterialPresets } from '@/screens/collection/grade-material';
import { Companion } from '@/ui/companion';

import type { PublicStudio, StudioItem } from './studio-api';

const rooms = {
  daylight: require('../../assets/images/play/room-daylight.png'),
  evening: require('../../assets/images/play/room-evening.png'),
  garden: require('../../assets/images/play/room-garden.png'),
} as const;
const mascot = require('../../assets/images/mascot/v2/wave.png');
const accentColors = { mint: '#68BAAC', rose: '#E78F9B', sky: '#72A7E6' } as const;

export function CompanionScene({ avatar, size = 160, onLoad, onError, experienceProfile, interactive = false }: {
  avatar: string | null; size?: number; onLoad?: () => void; onError?: () => void; experienceProfile?: DisplayExperienceProfile; interactive?: boolean;
}) {
  const source: ImageSourcePropType | undefined = avatar ? friendArt[avatar] : undefined;
  const equipment = <AvatarEquipment avatar={avatar} equipment={experienceProfile} size={size} />;
  return <View style={{ width: size, height: size }}>
    {onLoad ? <View style={{ transform: [{ rotate: experienceProfile?.cosmetics.pose === 'stack-cheer' ? '-7deg' : '0deg' }] }}>
      <Image source={source ?? mascot} resizeMode="contain" onLoad={onLoad} onError={onError}
        accessible accessibilityLabel={source ? '선택한 동행' : '동행을 기다리는 마스코트'} style={{ width: size, height: size }} />
      {equipment}
    </View> : <Companion art={source} size={size} interactive={interactive} characterId={avatar} poseId={experienceProfile?.cosmetics.pose}>{equipment}</Companion>}
  </View>;
}

export function StudioScene({ studio, items, avatar, apiUrl, onItemPress, onAssetsReady, onAssetError, width = 360, height = 330, experienceProfile, badgeName, representativeCoin, videoBackground = false }: {
  studio: PublicStudio; items: readonly StudioItem[]; avatar: string | null; apiUrl: string;
  onItemPress?: (item: StudioItem) => void; onAssetsReady?: () => void; onAssetError?: () => void;
  width?: number; height?: number; experienceProfile?: DisplayExperienceProfile; badgeName?: string; representativeCoin?: StudioItem; videoBackground?: boolean;
}) {
  const { fontScale } = useWindowDimensions();
  const loaded = useRef(new Set<string>());
  const accent = accentColors[studio.accent];
  const sceneItems = items.slice(0, 6);
  const representative: StudioItem | undefined = representativeCoin ?? (experienceProfile?.coinEntitlementId
    ? sceneItems.find((item) => item.entitlementId === experienceProfile.coinEntitlementId) : experienceProfile?.coin ?? undefined);
  const coinSource = representative?.artwork?.thumbnailDataUrl ? { uri: representative.artwork.thumbnailDataUrl }
    : representative ? merchantArtSource({ id: representative.merchantId }, apiUrl) : undefined;
  const shelf = studio.layout === 'shelf';
  const featuredIndex = sceneItems.findIndex((item) => representative &&
    (representative.entitlementId && item.entitlementId ? representative.entitlementId === item.entitlementId :
      item.merchantId === representative.merchantId && item.campaignTitle === representative.campaignTitle &&
      item.displayName === representative.displayName && item.artwork?.gradeId === representative.artwork?.gradeId));
  const material = gradeMaterialPresets[gradeMaterialFor(representative?.artwork?.gradeId ?? '', representative?.artwork?.gradeName ?? '')];
  const coinWidth = width * (onAssetsReady ? .30 : .19);
  const expectedAssets = (videoBackground ? 1 : 2) + (!videoBackground && coinSource ? 1 : 0) + sceneItems.filter((item, index) => index !== featuredIndex && (!!item.artwork?.thumbnailDataUrl ||
    !!merchantArtSource({ id: item.merchantId }, apiUrl))).length;
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
      {!videoBackground ? <View style={[styles.companion, { left: width * 0.285, bottom: height * 0.17 }]}>
        <CompanionScene avatar={avatar} experienceProfile={experienceProfile} size={Math.min(width * 0.43, height * 0.46)}
          onLoad={onAssetsReady ? () => markLoaded('companion') : undefined} onError={onAssetError} />
      </View> : null}
      {!videoBackground && coinSource ? <Pressable
        accessibilityRole={onItemPress && representative ? 'button' : 'image'}
        accessibilityLabel={`대표 수집품 ${representative?.displayName ?? experienceProfile?.coin?.displayName ?? ''}`}
        disabled={!onItemPress || !representative} onPress={() => representative && onItemPress?.(representative)}
        style={[styles.featuredCoin, { left: width * .235 - coinWidth / 2, top: Math.max(0, height * .23 - coinWidth / 2), width: coinWidth, height: coinWidth,
          backgroundColor: material.tint, borderColor: material.colors[0] }]}>
        <Image source={coinSource} resizeMode="contain" style={styles.itemImage} accessible={false}
          onLoad={() => markLoaded('featured-coin')} onError={onAssetError} />
      </Pressable> : null}
      {sceneItems.map((item, index) => {
          if (index === featuredIndex) return null;
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
      {experienceProfile?.badgeId ? <View style={[styles.badge, onAssetsReady && { left: undefined, right: 12, maxWidth: width * .6 }]}><Text allowFontScaling={!onAssetsReady} style={styles.badgeText} numberOfLines={1}>✦ {badgeName ?? experienceProfile.badgeName ?? experienceProfile.badgeId}</Text></View> : null}
      {(experienceProfile?.coin || experienceProfile?.coinEntitlementId) ? <View style={styles.coinLabel}>
        {coinSource ? <Image source={coinSource} resizeMode="contain" style={styles.coinImage} accessible={false} /> : null}
        <Text allowFontScaling={!onAssetsReady} style={styles.coinText} numberOfLines={1}>{experienceProfile.coin?.displayName ?? representative?.displayName ?? '대표 코인'}</Text>
      </View> : null}
      {experienceProfile?.cosmetics.decor ? <View style={[styles.wallDecor,
        { backgroundColor: experienceProfile.cosmetics.decor.includes('gold') ? '#F6D77C' : experienceProfile.cosmetics.decor.includes('silver') ? '#DEE8F2' : '#F2C9AF' }]}>
        <Text style={styles.wallDecorText}>{experienceProfile.cosmetics.decor.includes('flower') ? '✿' : '✦'}</Text>
      </View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  featuredCoin: { position: 'absolute', borderRadius: 999, backgroundColor: '#FFF0C3', borderWidth: 3,
    borderColor: '#D6AD54', padding: 3, overflow: 'hidden', elevation: 4, shadowColor: '#65451B', shadowOpacity: .24, shadowRadius: 5 },
  scene: { overflow: 'hidden', position: 'relative' },
  backdrop: { position: 'absolute', width: '100%', height: '100%', top: 0 },
  accentLine: { position: 'absolute', bottom: 0, left: 0, width: '100%', borderBottomWidth: 5 },
  companion: { position: 'absolute' },
  item: { position: 'absolute', backgroundColor: '#FFFFFF', borderWidth: 2, borderRadius: 7, alignItems: 'center', justifyContent: 'center', padding: 3 },
  itemImage: { width: '100%', height: '100%' },
  missingArt: { color: '#35445B', textAlign: 'center', fontSize: 10, fontWeight: '700' },
  empty: { position: 'absolute', width: '46%', backgroundColor: '#FFFFFFDD', padding: 9, borderRadius: 6 },
  emptyText: { color: '#34445B', fontWeight: '700', fontSize: 12, textAlign: 'center' },
  badge: { position: 'absolute', top: 9, left: 9, maxWidth: '65%', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, backgroundColor: '#FFF1BD', borderWidth: 1, borderColor: '#C5904E' },
  badgeText: { color: '#68491E', fontWeight: '900', fontSize: 11 },
  coinLabel: { position: 'absolute', bottom: 8, right: 8, maxWidth: '45%', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: '#FFFFFFDD', flexDirection: 'row', alignItems: 'center', gap: 4 },
  coinImage: { width: 24, height: 24 },
  coinText: { color: '#35445B', fontWeight: '800', fontSize: 10 },
  wallDecor: { position: 'absolute', top: '16%', right: '9%', width: 31, height: 31, borderRadius: 8, borderWidth: 2, borderColor: '#A47B50', alignItems: 'center', justifyContent: 'center' },
  wallDecorText: { color: '#69503B', fontSize: 22, fontWeight: '900' },
});
