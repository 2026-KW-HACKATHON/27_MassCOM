import { StyleSheet, Text, View } from 'react-native';

import type { ExperienceProfile } from './experience-api';

type Equipment = Pick<ExperienceProfile, 'cosmetics'>;

// The existing character art has different head/body proportions. Keep anchors by character,
// while the equipment remains a separate layer so the original art is preserved.
const anchors: Record<string, { head: number; bag: number; hand: number }> = {
  'cook-cat': { head: 0.13, bag: 0.57, hand: 0.57 },
  'cafe-bear': { head: 0.15, bag: 0.59, hand: 0.61 },
  'bakery-squirrel': { head: 0.12, bag: 0.55, hand: 0.58 },
  'walk-rabbit': { head: 0.06, bag: 0.58, hand: 0.57 },
  'tteok-tiger': { head: 0.15, bag: 0.57, hand: 0.61 },
  'laundry-seal': { head: 0.17, bag: 0.64, hand: 0.64 },
  'market-raccoon': { head: 0.12, bag: 0.58, hand: 0.58 },
  'flower-hedgehog': { head: 0.13, bag: 0.61, hand: 0.59 },
  'book-owl': { head: 0.13, bag: 0.59, hand: 0.58 },
};

export function AvatarEquipment({ avatar, equipment, size }: { avatar: string | null; equipment?: Equipment; size: number }) {
  if (!equipment || !avatar) return null;
  const placement = anchors[avatar] ?? { head: 0.13, bag: 0.59, hand: 0.59 };
  const { hat, bag, prop, pose } = equipment.cosmetics;
  if (!hat && !bag && !prop && !pose) return null;
  const hue = hat?.includes('gold') ? '#F6D16E' : hat?.includes('silver') ? '#D5E5F5' :
    hat?.includes('bronze') ? '#D9A36F' : avatar.includes('bear') || avatar.includes('tiger') ? '#F8C969' : '#F6A6BB';
  return <View pointerEvents="none" style={[styles.overlay, { width: size, height: size }]} accessible
    accessibilityLabel={[hat && '모자', bag && '가방', prop && '손 소품', pose && '포즈'].filter(Boolean).join(', ') || undefined}>
    {hat ? <View style={[styles.hat, { top: size * placement.head, left: size * 0.33, width: size * 0.36, height: size * 0.12, backgroundColor: hue }]}>
      <Text style={{ color: '#70503C', fontWeight: '900', fontSize: size * 0.08 }}>{hat.includes('explorer') ? '✦' : hat.includes('steady') ? '✓' : '•'}</Text>
    </View> : null}
    {bag ? <View style={[styles.bag, { top: size * placement.bag, left: size * 0.68, width: size * 0.19, height: size * 0.23 }]}><Text style={[styles.glyph, { fontSize: size * 0.11 }]}>✦</Text></View> : null}
    {prop ? <View style={[styles.prop, { top: size * placement.hand, left: size * 0.11, width: size * 0.23, height: size * 0.23 }]}><Text style={[styles.glyph, { fontSize: size * 0.14 }]}>{prop.includes('memory') ? '▤' : prop.includes('steady') ? '✿' : prop.includes('gold') ? '✧' : '★'}</Text></View> : null}
    {pose ? <View style={[styles.pose, { top: size * 0.39, left: size * 0.07 }]}><Text style={[styles.poseText]}>{pose.includes('victory') ? '✌' : pose.includes('wave') ? '〰' : '✦'}</Text></View> : null}
  </View>;
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, left: 0 },
  hat: { position: 'absolute', borderRadius: 999, borderWidth: 2, borderColor: '#8E5364', transform: [{ rotate: '-7deg' }], alignItems: 'center', justifyContent: 'center' },
  bag: { position: 'absolute', backgroundColor: '#E2A46F', borderRadius: 12, borderWidth: 2, borderColor: '#875437', alignItems: 'center', justifyContent: 'center' },
  prop: { position: 'absolute', backgroundColor: '#FFF3C8', borderRadius: 999, borderWidth: 2, borderColor: '#C5904E', alignItems: 'center', justifyContent: 'center' },
  glyph: { color: '#704F42', fontWeight: '900' },
  pose: { position: 'absolute', backgroundColor: '#FFFFFFDB', borderRadius: 999, paddingHorizontal: 4 },
  poseText: { color: '#365A91', fontSize: 18, fontWeight: '900' },
});
