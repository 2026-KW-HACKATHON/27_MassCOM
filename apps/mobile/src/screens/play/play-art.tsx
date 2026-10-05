import { Image, StyleSheet, Text, View } from 'react-native';
import { CompanionScene } from '@/studio/studio-scene';
import type { DisplayExperienceProfile } from '@/experience/experience-api';
import type { CollectionSnapshot } from '@/commerce/commerce-api';

export type OwnedArt = { name: string; uri: string };

export function ownedGameArt(collection: CollectionSnapshot | undefined): OwnedArt[] {
  const result: OwnedArt[] = [];
  const seen = new Set<string>();
  for (const collectible of collection?.collectibles ?? []) {
    const artwork = collectible.artwork;
    if (!artwork || seen.has(artwork.publicationId)) continue;
    seen.add(artwork.publicationId);
    result.push({ name: artwork.name, uri: artwork.thumbnailDataUrl });
    if (result.length === 6) break;
  }
  return result;
}

const neutral = ['✿', '◆', '●', '✦', '★', '☀'];

export function FoodToken({ value, size = 48 }: { value: number; size?: number }) {
  const index = value % 4;
  return <View style={{ width: size, height: size, overflow: 'hidden' }} accessible={false}>
    <Image source={require('../../../assets/images/play/food-tokens.png')} resizeMode="stretch"
      style={{ position: 'absolute', width: size * 2, height: size * 2, left: -(index % 2) * size, top: -Math.floor(index / 2) * size }} />
  </View>;
}

export function GameToken({ value, art, size = 48 }: { value: number; art: readonly OwnedArt[]; size?: number }) {
  const owned = art[value];
  return owned ? <Image source={{ uri: owned.uri }} resizeMode="contain" style={{ width: size, height: size }} accessibilityLabel={owned.name} />
    : value < 4 ? <FoodToken value={value} size={size} />
      : <View style={[styles.neutral, { width: size, height: size, borderRadius: Math.min(size / 2, 24) }]}><Text style={[styles.glyph, { fontSize: size * 0.5 }]}>{neutral[value % neutral.length]}</Text></View>;
}

export function Companion({ avatar, equipment }: { avatar: string | null; equipment?: DisplayExperienceProfile }) {
  return avatar ? <CompanionScene avatar={avatar} experienceProfile={equipment} size={66} /> : null;
}

const styles = StyleSheet.create({
  neutral: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#E4F1EF', borderWidth: 2, borderColor: '#80B8AB' },
  glyph: { color: '#285F59', fontWeight: '800' },
  companion: { width: 66, height: 66 },
});
