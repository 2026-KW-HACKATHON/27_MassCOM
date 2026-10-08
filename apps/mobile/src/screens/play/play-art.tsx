import { Image, View } from 'react-native';
import { CosmeticArt } from '@/illustration/artwork';
import { practiceTokens } from './play-copy';
import { AvatarPortrait } from '@/illustration/avatar-portrait';
import { mascotArt } from '@/ui/mascot-art';
import type { DisplayExperienceProfile } from '@/experience/experience-api';
import type { EquippedClothingArt } from '@/shop/wardrobe';

/** One visited store's coin. `held` lists every coin of that store the account owns, so its series' next slot can be derived. */
export type OwnedArt = {
  name: string; uri: string; merchantId?: string; merchantName?: string; entitlementId?: string;
  held?: readonly { entitlementId: string; campaignId: string; targetVisitCount: 1 | 3 | 5 }[];
};

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
  return avatar ? <AvatarPortrait avatar={avatar} profile={equipment} clothing={clothing} size={66} reaction={reaction} />
    : <Image source={mascotArt[reaction === 'cheer' ? 'cheer' : reaction === 'concerned' ? 'puzzled' : 'wave']} style={{ width: 66, height: 66 }} resizeMode="contain" accessible={false} />;
}
