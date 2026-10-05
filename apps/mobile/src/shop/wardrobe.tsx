import { useMemo } from 'react';
import { AtlasImage } from '@/illustration/atlas-image';

import type { ShopSnapshot } from './shop-api';

export type EquippedClothingArt = { id: string; name: string };
const clothingNames: Readonly<Record<string, string>> = {
  'green-apron': '초록 앞치마', 'sky-hoodie': '하늘 후드', 'market-scarf': '장터 스카프',
};

const clothingFrames: Readonly<Record<string, number>> = { 'green-apron': 0, 'sky-hoodie': 1, 'market-scarf': 2 };
const torso: Readonly<Record<string, { x: number; y: number; width: number }>> = {
  'cook-cat': { x: .29, y: .57, width: .39 }, 'cafe-bear': { x: .30, y: .55, width: .40 },
  'walk-rabbit': { x: .33, y: .57, width: .35 }, 'bakery-squirrel': { x: .30, y: .57, width: .39 },
  'flower-hedgehog': { x: .30, y: .57, width: .39 }, 'book-owl': { x: .31, y: .56, width: .38 },
  'tteok-tiger': { x: .29, y: .57, width: .40 }, 'market-raccoon': { x: .30, y: .56, width: .39 },
  'laundry-seal': { x: .31, y: .56, width: .38 },
};

export function hasClothingArt(clothing: EquippedClothingArt | null | undefined): boolean {
  return !!clothing && clothingFrames[clothing.id] !== undefined;
}

export function AvatarClothing({ avatar, clothing, size, onLoad, onError }: {
  avatar: string | null; clothing: EquippedClothingArt | null | undefined; size: number; onLoad?: () => void; onError?: () => void;
}) {
  if (!avatar || !hasClothingArt(clothing)) return null;
  const anchor = torso[avatar] ?? torso['cook-cat']!;
  const scarf = clothing!.id === 'market-scarf';
  const width = size * anchor.width * (scarf ? .82 : 1);
  return <AtlasImage source={require('../../assets/images/experience-quality/clothing-atlas.png')}
    columns={2} rows={2} frame={clothingFrames[clothing!.id]!} size={width} onLoad={onLoad} onError={onError}
    style={{ position: 'absolute', left: size * anchor.x + (size * anchor.width - width) / 2,
      top: size * (anchor.y + (scarf ? -.11 : 0)) }} />;
}

export function clothingArtForId(id: string | null | undefined): EquippedClothingArt | null {
  return id && clothingNames[id] ? { id, name: clothingNames[id] } : null;
}

export function equippedClothingArt(snapshot: Pick<ShopSnapshot, 'clothing'> | undefined): EquippedClothingArt | null {
  const equipped = snapshot?.clothing.equipped;
  if (!equipped) return null;
  const item = snapshot.clothing.items.find((candidate) => candidate.id === equipped);
  return item ?? { id: equipped, name: '알 수 없는 옷' };
}

export function useEquippedClothingArt(snapshot: Pick<ShopSnapshot, 'clothing'> | undefined): EquippedClothingArt | null {
  return useMemo(() => equippedClothingArt(snapshot), [snapshot]);
}

export function AvatarWardrobe({ clothing, size = 58 }: { clothing: EquippedClothingArt | null; size?: number }) {
  if (!clothing) return null;
  const frame = clothingFrames[clothing.id];
  return frame === undefined ? null : <AtlasImage source={require('../../assets/images/experience-quality/clothing-atlas.png')}
    columns={2} rows={2} frame={frame} size={size} />;
}
