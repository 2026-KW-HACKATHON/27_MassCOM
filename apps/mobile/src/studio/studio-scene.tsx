import { useId, useRef } from 'react';
import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useIsFocused } from 'expo-router';

import Svg, { Defs, Polygon, G, LinearGradient, Stop } from 'react-native-svg';
import { AvatarPortrait } from '@/illustration/avatar-portrait';
import { BadgeArt, CosmeticArt } from '@/illustration/artwork';
import { badgeFrame, cosmeticFrames } from '@/illustration/art-catalog';
import type { DisplayExperienceProfile } from '@/experience/experience-api';
import type { EquippedClothingArt } from '@/shop/wardrobe';
import { merchantArtSource } from '@/screens/collection/merchant-art';
import { publicDataDemoStoreName } from '@/merchant/public-data-demo-store';
import { CollectibleFaceOutline } from '@/screens/collection/collectible-default-back';
import { gradeMaterialFor, gradeMaterialPresets } from '@/screens/collection/grade-material';
import { GradeMaterialLayer } from '@/screens/collection/grade-material-layer';
import { studioComposition, studioDecorPlacement } from './studio-composition';

import type { FurnitureSnapshot, PlacedFurnitureItem, PublicStudio, StudioItem } from './studio-api';
import { FurnitureLayer, hasFurnitureArt } from './furniture-layer';

const rooms = {
  daylight: require('../../assets/images/room/room-empty.png'),
  evening: require('../../assets/images/play/room-evening.png'),
  garden: require('../../assets/images/play/room-garden.png'),
} as const;
const accentColors = { mint: '#68BAAC', rose: '#E78F9B', sky: '#72A7E6' } as const;
const floorColors = { daylight: '#D5AE7126', garden: '#72AB8B38', evening: '#2A385B52' } as const;

export function CompanionScene({ avatar, clothing, size = 160, onLoad, onError, experienceProfile, interactive = false }: {
  avatar: string | null; clothing?: EquippedClothingArt | null; size?: number; onLoad?: () => void; onError?: () => void; experienceProfile?: DisplayExperienceProfile; interactive?: boolean;
}) {
  return <AvatarPortrait avatar={avatar} profile={experienceProfile} clothing={clothing} size={size} interactive={interactive}
    reaction="idle" onLoad={onLoad} onError={onError} animated={false} />;
}

/** The exact metal shell is captured once for both photographs and video layers. */
export function StudioCoin({ item, apiUrl, size, onLoad, onError, active = false }: {
  item: StudioItem; apiUrl: string; size: number; onLoad?: () => void; onError?: () => void; active?: boolean;
}) {
  const focused = useIsFocused();
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const source = item.artwork?.thumbnailDataUrl ? { uri: item.artwork.thumbnailDataUrl }
    : merchantArtSource({ id: item.merchantId }, apiUrl);
  const grade = gradeMaterialFor(item.artwork?.gradeId ?? '', item.artwork?.gradeName ?? '');
  const material = gradeMaterialPresets[grade];
  const shape = item.artwork?.shape ?? 'circle';
  return <View style={{ width: size, height: size }}>
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id={`${id}metal`} x1="0" y1="0" x2="1" y2="1">
          {material.colors.map((color, index) => <Stop key={index} offset={index / (material.colors.length - 1)} stopColor={color} />)}
        </LinearGradient>
      </Defs>
      <G transform="translate(1.2 2)"><CollectibleFaceOutline shape={shape} fill={material.colors[material.colors.length - 1]!} /></G>
      <CollectibleFaceOutline shape={shape} fill={`url(#${id}metal)`} stroke={material.colors[0]} strokeWidth={2} />
    </Svg>
    {source ? <View style={{ position: 'absolute', overflow: 'hidden',
      left: size * (shape === 'stamp' ? .12 : shape === 'serrated' ? .15 : .1),
      top: size * (shape === 'stamp' ? .08 : shape === 'serrated' ? .15 : .1),
      width: size * (shape === 'stamp' ? .76 : shape === 'serrated' ? .70 : .8),
      height: size * (shape === 'stamp' ? .84 : shape === 'serrated' ? .70 : .8),
      borderRadius: shape === 'stamp' ? size * .04 : size }}>
      <Image source={source} resizeMode="contain" style={{ width: '100%', height: '100%' }} onLoad={onLoad} onError={onError} />
    </View> : null}
    <GradeMaterialLayer material={grade} size={size} faceUri={item.artwork?.thumbnailDataUrl} shape={shape}
      variant="card" active={active && focused} />
    <Svg pointerEvents="none" width={size} height={size} viewBox="0 0 100 100" style={{ position: 'absolute' }}>
      <CollectibleFaceOutline shape={shape} fill="none" stroke={material.colors[1]} strokeWidth={1} />
    </Svg>
  </View>;
}

/** The same grounded decor layer belongs to live scenes and the captured video background. */
export function StudioDecor({ id, width, height, onLoad, onError }: {
  id: string; width: number; height: number; onLoad?: () => void; onError?: () => void;
}) {
  const placement = studioDecorPlacement(id);
  const size = width * placement.size;
  const top = height * placement.anchorY - size * placement.paintedBase;
  return <View pointerEvents="none" style={[styles.decor, { left: width * placement.left, top, width: size, height: size }]}>
    {placement.surface !== 'wall' ? <View style={[styles.decorContact,
      { left: size * .14, top: size * placement.paintedBase - size * .025, width: size * .74, height: size * .075 }]} /> : null}
    <CosmeticArt id={id} size={size} onLoad={onLoad} onError={onError} />
  </View>;
}

export function StudioScene({ studio, items, avatar, clothing, apiUrl, onItemPress, onAssetsReady, onAssetError, width = 360, height = 330, experienceProfile, badgeName, representativeCoin, videoBackground = false, furniture, furnitureItems, selectedFurnitureId, onFurnitureSelect, onFurnitureMove, emptyAction }: {
  studio: PublicStudio; items: readonly StudioItem[]; avatar: string | null; clothing?: EquippedClothingArt | null; apiUrl: string;
  onItemPress?: (item: StudioItem) => void; onAssetsReady?: () => void; onAssetError?: () => void;
  width?: number; height?: number; experienceProfile?: DisplayExperienceProfile; badgeName?: string; representativeCoin?: StudioItem; videoBackground?: boolean;
  furniture?: FurnitureSnapshot; furnitureItems?: PlacedFurnitureItem[]; selectedFurnitureId?: string; onFurnitureSelect?: (inventoryId: string) => void;
  onFurnitureMove?: (inventoryId: string, x: number, y: number) => void;
  /** Shown instead of the empty-room note when nothing is on show yet (e.g. "수집품 3개 · 방에 놓기"). */
  emptyAction?: { label: string; onPress: () => void };
}) {
  const { fontScale } = useWindowDimensions();
  const loaded = useRef(new Set<string>());
  const accent = accentColors[studio.accent];
  const sceneItems = items.slice(0, 6);
  const representative: StudioItem | undefined = representativeCoin ?? (experienceProfile?.coinEntitlementId
    ? sceneItems.find((item) => item.entitlementId === experienceProfile.coinEntitlementId) : experienceProfile?.coin ?? sceneItems[0]);
  const coinSource = representative?.artwork?.thumbnailDataUrl ? { uri: representative.artwork.thumbnailDataUrl }
    : representative ? merchantArtSource({ id: representative.merchantId }, apiUrl) : undefined;
  const shelf = studio.layout === 'shelf';
  const featuredIndex = sceneItems.findIndex((item) => representative &&
    (representative.entitlementId && item.entitlementId ? representative.entitlementId === item.entitlementId :
      representative.sourceId && item.sourceId ? representative.sourceKind === item.sourceKind && representative.sourceId === item.sourceId :
      item.merchantId === representative.merchantId && item.campaignTitle === representative.campaignTitle &&
      item.displayName === representative.displayName && item.artwork?.gradeId === representative.artwork?.gradeId));
  const coinWidth = width * studioComposition.coinSizeRatio;
  const badgeAsset = !!experienceProfile?.badgeId && badgeFrame(experienceProfile.badgeId) !== undefined;
  const decorAsset = !!experienceProfile?.cosmetics.decor && cosmeticFrames[experienceProfile.cosmetics.decor] !== undefined;
  const expectedAssets = Number(badgeAsset) + Number(decorAsset) + (videoBackground ? 1 : 2) + (!videoBackground && coinSource ? 1 : 0) + sceneItems.filter((item, index) => index !== featuredIndex && (!!item.artwork?.thumbnailDataUrl ||
    !!merchantArtSource({ id: item.merchantId }, apiUrl))).length + studio.furniture.filter((placement) => {
      const ownedItemId = furniture?.inventory.find((entry) => entry.id === placement.inventoryId)?.itemId;
      const assetId = (ownedItemId ? furniture?.catalog.find((entry) => entry.id === ownedItemId)?.assetId : undefined)
        ?? furnitureItems?.find((entry) => entry.id === placement.inventoryId)?.assetId;
      return hasFurnitureArt(assetId);
    }).length;
  const markLoaded = (key: string) => {
    if (!onAssetsReady) return;
    loaded.current.add(key);
    if (loaded.current.size === expectedAssets) onAssetsReady();
  };
  return (
    <View style={[styles.scene, { width, height, backgroundColor: 'transparent' }]}>
      <Image source={rooms.daylight} resizeMode="contain" style={styles.backdrop} accessible={false}
        onLoad={() => markLoaded('room')} onError={onAssetError} />
      <Svg pointerEvents="none" width={width} height={height} viewBox="0 0 1000 1000" style={StyleSheet.absoluteFill}>
        <Polygon points="33,330 500,95 964,326 964,611 500,380 33,616" fill={(studio.wall ?? studio.theme) === 'garden' ? '#7EAD88' : '#153B50'}
          fillOpacity={(studio.wall ?? studio.theme) === 'daylight' ? 0 : (studio.wall ?? studio.theme) === 'garden' ? .28 : .35} />
        <Polygon points="20,638 500,382 980,638 500,940" fill={floorColors[studio.floor ?? studio.theme]} />
      </Svg>
      {representative ? <View style={[styles.pedestal, { left: width * .235 - coinWidth * .42, top: height * .23 + coinWidth * .43, width: coinWidth * .84, height: height * .035 }]} /> : null}
      <View style={[styles.contactShadow, { left: width * .285 + width * .06, bottom: height * .16, width: width * .31, height: height * .045 }]} />
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
              accessibilityLabel={`${item.displayName}, ${publicDataDemoStoreName(item.merchantId, item.merchantName)}`}
              disabled={!onItemPress} onPress={() => onItemPress?.(item)}
              style={[styles.item, { borderColor: accent, width: width * (shelf ? 0.13 : 0.17), height: height * (shelf ? 0.13 : 0.17),
                left: width * (shelf ? (column ? 0.79 : 0.08) : (0.15 + column * 0.27)),
                top: height * (shelf ? (0.17 + row * 0.14) : (0.13 + row * 0.2)) }]}>
              <View style={styles.shelfLip} />
              {source ? <Image source={source} resizeMode="contain" style={styles.itemImage} accessible={false}
                onLoad={() => markLoaded(`item-${index}`)} onError={onAssetError} />
                : <Text style={styles.missingArt} numberOfLines={2}>{item.displayName}</Text>}
            </Pressable>
          );
        })}
      {!sceneItems.length && emptyAction ? <Pressable accessibilityRole="button" accessibilityLabel={emptyAction.label} onPress={emptyAction.onPress}
        style={[styles.empty, styles.emptyAction, { right: width * 0.04, bottom: 6 }]}>
        <Text style={styles.emptyActionText}>{emptyAction.label}</Text>
      </Pressable> : !sceneItems.length && fontScale < 1.5 ? <View style={[styles.empty, { right: width * 0.04, bottom: 6 }]}>
        <Text style={styles.emptyText}>첫 수집품을 기다리는 공간</Text>
      </View> : null}
      {experienceProfile?.badgeId ? <View style={[styles.badge, { right: 12, maxWidth: width * .40 }]}><BadgeArt id={experienceProfile.badgeId} size={30} onLoad={() => markLoaded('badge')} onError={onAssetError} /><Text allowFontScaling={!onAssetsReady} style={styles.badgeText} numberOfLines={1}>{badgeName ?? experienceProfile.badgeName ?? experienceProfile.badgeId}</Text></View> : null}
      {(experienceProfile?.coin || experienceProfile?.coinEntitlementId) ? <View style={styles.coinLabel}>
        <Text allowFontScaling={!onAssetsReady} style={styles.coinText} numberOfLines={1}>{experienceProfile.coin?.displayName ?? representative?.displayName ?? '대표 코인'}</Text>
      </View> : null}
      <FurnitureLayer placements={studio.furniture} owned={furniture} placedItems={furnitureItems} width={width} height={height}
        selectedId={selectedFurnitureId} onSelect={onFurnitureSelect} onMove={onFurnitureMove}
        onAssetLoad={onAssetsReady ? (id) => markLoaded(`furniture-${id}`) : undefined} />
      {experienceProfile?.cosmetics.decor ? <StudioDecor id={experienceProfile.cosmetics.decor} width={width} height={height}
        onLoad={() => markLoaded('decor')} onError={onAssetError} /> : null}
      {!videoBackground ? <View style={[styles.companion, { left: width * studioComposition.avatarLeft, bottom: height * (1 - studioComposition.avatarFloor) }]}>
        <CompanionScene avatar={avatar} clothing={clothing} experienceProfile={experienceProfile} size={Math.min(width * studioComposition.avatarWidth, height * studioComposition.avatarHeight)}
          onLoad={onAssetsReady ? () => markLoaded('companion') : undefined} onError={onAssetError} />
      </View> : null}
      {!videoBackground && coinSource ? <Pressable
        accessibilityRole={onItemPress && representative ? 'button' : 'image'}
        accessibilityLabel={`대표 수집품 ${representative?.displayName ?? experienceProfile?.coin?.displayName ?? ''}`}
        disabled={!onItemPress || !representative} onPress={() => representative && onItemPress?.(representative)}
        style={[styles.featuredCoin, { left: width * studioComposition.coinCenterX - coinWidth / 2, top: height * studioComposition.coinCenterY - coinWidth / 2, width: coinWidth, height: coinWidth }]}>
        <StudioCoin item={representative!} apiUrl={apiUrl} size={coinWidth} active={!onAssetsReady}
          onLoad={() => markLoaded('featured-coin')} onError={onAssetError} />
      </Pressable> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  featuredCoin: { position: 'absolute' },
  floor: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#B7947340', borderTopWidth: 2, borderTopColor: '#9D79564A' },
  pedestal: { position: 'absolute', backgroundColor: '#C6A67D', borderRadius: 8, borderBottomWidth: 5, borderBottomColor: '#92704F', elevation: 3 },
  contactShadow: { position: 'absolute', borderRadius: 999, backgroundColor: '#584B3D24' },
  shelfLip: { position: 'absolute', bottom: -5, left: -6, right: -6, height: 7, borderRadius: 2, backgroundColor: '#B8936A', borderBottomWidth: 2, borderBottomColor: '#785A42' },
  scene: { overflow: 'hidden', position: 'relative' },
  backdrop: { position: 'absolute', width: '100%', height: '100%', top: 0 },
  accentLine: { position: 'absolute', bottom: 0, left: 0, width: '100%', borderBottomWidth: 5 },
  companion: { position: 'absolute' },
  item: { position: 'absolute', backgroundColor: '#FFFFFF', borderWidth: 2, borderRadius: 7, alignItems: 'center', justifyContent: 'center', padding: 3 },
  itemImage: { width: '100%', height: '100%' },
  missingArt: { color: '#35445B', textAlign: 'center', fontSize: 12, fontWeight: '700' },
  empty: { position: 'absolute', width: '46%', backgroundColor: '#FFFFFFDD', padding: 9, borderRadius: 6 },
  emptyText: { color: '#34445B', fontWeight: '700', fontSize: 12, textAlign: 'center' },
  emptyAction: { width: '58%', minHeight: 44, justifyContent: 'center', backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#0B5C52' },
  emptyActionText: { color: '#0B5C52', fontWeight: '800', fontSize: 13, textAlign: 'center' },
  badge: { position: 'absolute', top: 9, right: 12, maxWidth: '40%', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, backgroundColor: '#FFF1BD', flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: '#C5904E' },
  badgeText: { color: '#68491E', fontWeight: '900', fontSize: 12 },
  coinLabel: { position: 'absolute', bottom: 8, right: 8, maxWidth: '45%', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: '#FFFFFFDD', flexDirection: 'row', alignItems: 'center', gap: 4 },
  coinText: { color: '#35445B', fontWeight: '800', fontSize: 12 },
  decor: { position: 'absolute' },
  decorContact: { position: 'absolute', borderRadius: 999, backgroundColor: '#44321C35' },
});
