import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { ShopSnapshot } from './shop-api';

type ClothingKind = 'apron' | 'hoodie' | 'scarf' | 'unknown';

export type EquippedClothingArt = {
  id: string;
  name: string;
  label: string;
  kind: ClothingKind;
  primary: string;
  secondary: string;
  accent: string;
};

const wardrobeArt: Record<string, Omit<EquippedClothingArt, 'id' | 'name' | 'label'>> = {
  'green-apron': { kind: 'apron', primary: '#2E8B57', secondary: '#B9F2C2', accent: '#F7FFF4' },
  'sky-hoodie': { kind: 'hoodie', primary: '#5EA7E8', secondary: '#D9EEFF', accent: '#2865A8' },
  'market-scarf': { kind: 'scarf', primary: '#D84A3A', secondary: '#FFE07A', accent: '#8A2B24' },
};

function artFor(item: { id: string; name: string }): EquippedClothingArt {
  const art = wardrobeArt[item.id] ?? { kind: 'unknown' as const, primary: '#6D7B8D', secondary: '#E8EEF5', accent: '#2D3748' };
  return { id: item.id, name: item.name, label: item.name.slice(0, 1), ...art };
}

export function equippedClothingArt(snapshot: Pick<ShopSnapshot, 'clothing'> | undefined): EquippedClothingArt | null {
  const equipped = snapshot?.clothing.equipped;
  if (!equipped) return null;
  const item = snapshot.clothing.items.find((candidate) => candidate.id === equipped);
  return artFor(item ?? { id: equipped, name: '알 수 없는 옷' });
}

export function useEquippedClothingArt(snapshot: Pick<ShopSnapshot, 'clothing'> | undefined): EquippedClothingArt | null {
  return useMemo(() => equippedClothingArt(snapshot), [snapshot]);
}

export function AvatarWardrobe({ clothing, size = 58 }: { clothing: EquippedClothingArt | null; size?: number }) {
  if (!clothing) return null;
  const scale = (value: number) => Math.round((size * value) / 58);
  const frame = { width: scale(58), height: scale(48) };
  if (clothing.kind === 'hoodie') {
    return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.frame, frame]}>
      <View style={[styles.hood, { width: scale(34), height: scale(24), borderRadius: scale(16), backgroundColor: clothing.secondary, borderColor: clothing.primary, borderWidth: scale(3), left: scale(12), top: 0 }]} />
      <View style={[styles.sleeve, { backgroundColor: clothing.primary, width: scale(17), height: scale(28), borderRadius: scale(9), left: scale(3), top: scale(17), transform: [{ rotate: '-23deg' }] }]} />
      <View style={[styles.sleeve, { backgroundColor: clothing.primary, width: scale(17), height: scale(28), borderRadius: scale(9), right: scale(3), top: scale(17), transform: [{ rotate: '23deg' }] }]} />
      <View style={[styles.torso, { backgroundColor: clothing.primary, borderColor: clothing.accent, width: scale(34), height: scale(31), borderRadius: scale(9), left: scale(12), top: scale(16), borderWidth: scale(2) }]}>
        <View style={[styles.hoodieZip, { backgroundColor: clothing.accent, width: Math.max(1, scale(2)), height: scale(24) }]} />
        <View style={[styles.pocket, { borderColor: clothing.secondary, width: scale(18), height: scale(7), bottom: scale(5) }]} />
      </View>
    </View>;
  }
  if (clothing.kind === 'scarf') {
    return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.frame, frame]}>
      <View style={[styles.scarfBand, { backgroundColor: clothing.primary, borderColor: clothing.secondary, width: scale(44), height: scale(14), borderRadius: scale(8), left: scale(7), top: scale(7), borderWidth: scale(2) }]} />
      <View style={[styles.scarfTail, { backgroundColor: clothing.primary, borderColor: clothing.accent, width: scale(14), height: scale(31), borderRadius: scale(6), left: scale(30), top: scale(16), borderWidth: scale(2), transform: [{ rotate: '-10deg' }] }]} />
      <View style={[styles.scarfStripe, { backgroundColor: clothing.secondary, width: scale(10), height: scale(4), left: scale(32), top: scale(26), transform: [{ rotate: '-10deg' }] }]} />
      <View style={[styles.scarfStripe, { backgroundColor: clothing.secondary, width: scale(10), height: scale(4), left: scale(33), top: scale(36), transform: [{ rotate: '-10deg' }] }]} />
    </View>;
  }
  if (clothing.kind === 'apron') {
    return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.frame, frame]}>
      <View style={[styles.apronStrap, { borderColor: clothing.secondary, width: scale(28), height: scale(18), borderRadius: scale(14), left: scale(15), top: 0, borderWidth: scale(3) }]} />
      <View style={[styles.sleeve, { backgroundColor: clothing.secondary, width: scale(15), height: scale(26), borderRadius: scale(8), left: scale(6), top: scale(18), transform: [{ rotate: '-18deg' }] }]} />
      <View style={[styles.sleeve, { backgroundColor: clothing.secondary, width: scale(15), height: scale(26), borderRadius: scale(8), right: scale(6), top: scale(18), transform: [{ rotate: '18deg' }] }]} />
      <View style={[styles.apronBody, { backgroundColor: clothing.primary, borderColor: clothing.accent, width: scale(33), height: scale(35), borderRadius: scale(8), left: scale(13), top: scale(12), borderWidth: scale(2) }]}>
        <View style={[styles.apronPocket, { borderColor: clothing.secondary, width: scale(17), height: scale(9), bottom: scale(7) }]} />
      </View>
    </View>;
  }
  return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.unknown, frame, { borderColor: clothing.primary, backgroundColor: clothing.secondary }]}>
    <Text style={[styles.unknownText, { color: clothing.accent, fontSize: Math.max(12, scale(16)) }]}>{clothing.label}</Text>
  </View>;
}

const styles = StyleSheet.create({
  frame: { position: 'relative' },
  hood: { position: 'absolute' },
  sleeve: { position: 'absolute' },
  torso: { position: 'absolute', alignItems: 'center' },
  hoodieZip: { position: 'absolute', top: 3 },
  pocket: { position: 'absolute', borderBottomWidth: 2, borderLeftWidth: 2, borderRightWidth: 2, borderBottomLeftRadius: 7, borderBottomRightRadius: 7 },
  scarfBand: { position: 'absolute' },
  scarfTail: { position: 'absolute' },
  scarfStripe: { position: 'absolute', borderRadius: 2 },
  apronStrap: { position: 'absolute', borderBottomWidth: 0, backgroundColor: 'transparent' },
  apronBody: { position: 'absolute', alignItems: 'center' },
  apronPocket: { position: 'absolute', borderBottomWidth: 2, borderLeftWidth: 2, borderRightWidth: 2, borderBottomLeftRadius: 7, borderBottomRightRadius: 7 },
  unknown: { alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderRadius: 10 },
  unknownText: { fontWeight: '900' },
});
