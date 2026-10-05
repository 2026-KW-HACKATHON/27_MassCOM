import { Image, View } from 'react-native';
import { CosmeticArt } from '@/illustration/artwork';
import { practiceTokens } from './play-copy';
import { AvatarPortrait } from '@/illustration/avatar-portrait';
import type { DisplayExperienceProfile } from '@/experience/experience-api';
import type { CollectionSnapshot } from '@/commerce/commerce-api';
import type { EquippedClothingArt } from '@/shop/wardrobe';

export type OwnedArt = { name: string; uri: string; merchantId?: string; merchantName?: string };

export function ownedGameArt(collection: CollectionSnapshot | undefined): OwnedArt[] {
  const result: OwnedArt[] = [];
  const seen = new Set<string>();
  for (const collectible of collection?.collectibles ?? []) {
    const artwork = collectible.artwork;
    if (!artwork || seen.has(artwork.publicationId)) continue;
    seen.add(artwork.publicationId);
    result.push({ name: artwork.name, uri: artwork.thumbnailDataUrl, merchantId: collectible.merchantId, merchantName: collectible.merchantName });
    if (result.length === 6) break;
  }
  return result;
}

export function FoodToken({ value, size = 48 }: { value: number; size?: number }) {
  const index = value % 4;
  return <View style={{ width: size, height: size, overflow: 'hidden' }} accessible={false}>
    <Image source={require('../../../assets/images/play/food-tokens.png')} resizeMode="stretch"
      style={{ position: 'absolute', width: size * 2, height: size * 2, left: -(index % 2) * size, top: -Math.floor(index / 2) * size }} />
  </View>;
}

export function GameToken({ value, art, size = 48 }: { value: number; art: readonly OwnedArt[]; size?: number }) {
  const owned = art[value];
  if (owned) return <Image source={{ uri: owned.uri }} resizeMode="contain" style={{ width: size, height: size }} accessibilityLabel={owned.name} />;
  const token = practiceTokens[value];
  if (!token) return null;
  return 'food' in token ? <FoodToken value={token.food} size={size} /> : <CosmeticArt id={token.cosmetic} size={size} />;
}

export function Companion({ avatar, equipment, clothing, reaction = 'idle' }: { avatar: string | null; equipment?: DisplayExperienceProfile; clothing?: EquippedClothingArt | null; reaction?: 'idle' | 'wave' | 'cheer' | 'concerned' }) {
  return avatar ? <AvatarPortrait avatar={avatar} profile={equipment} clothing={clothing} size={66} reaction={reaction} /> : null;
}
