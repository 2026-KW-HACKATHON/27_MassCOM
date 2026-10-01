import { useEffect } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import type { PublishedCollectible } from '@/commerce/collectible-artwork';

type Props = {
  collectible: PublishedCollectible;
  merchantName: string;
  isNew: boolean;
  motionAllowed: boolean;
  size: number;
};

/** A shine/sparkle motion already authored for this grade gets a brighter, twice-over sweep; every other card still gets one plain light sweep. */
function isHolo(collectible: PublishedCollectible): boolean {
  return collectible.animation === 'shine' || collectible.animation === 'sparkle'
    || (collectible.motions ?? []).some((motion) => motion.type === 'shine' || motion.type === 'sparkle');
}

/**
 * One envelope card: face-down, then flips to the collectible's artwork. Mounted fresh per card (the caller keys it
 * by entitlementId), so this effect-driven flip runs again each time a new card becomes current — no stage machine
 * needed here, just a timer that reduce-motion skips straight past (this card has no audio or network wait to race,
 * unlike reveal-lifecycle.ts's opening/revealed split, so a plain effect-cleanup timer is enough).
 */
export function EnvelopeCard({ collectible, merchantName, isNew, motionAllowed, size }: Props) {
  const flip = useSharedValue(motionAllowed ? 0 : 1);
  const sweep = useSharedValue(0);
  const holo = isHolo(collectible);

  useEffect(() => {
    if (!motionAllowed) { flip.set(1); sweep.set(1); return; }
    flip.set(0);
    sweep.set(0);
    const flipTimer = setTimeout(() => {
      flip.set(withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) }));
    }, 260);
    const sweepTimer = setTimeout(() => {
      sweep.set(withTiming(1, { duration: holo ? 1100 : 700, easing: Easing.linear }));
    }, 260 + 420);
    return () => { clearTimeout(flipTimer); clearTimeout(sweepTimer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- collectible identity changes every card; flip/sweep are stable shared values.
  }, [collectible.publicationId, collectible.gradeId, motionAllowed]);

  const backStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 1000 }, { rotateY: `${interpolate(flip.get(), [0, 1], [0, 180])}deg` }],
    opacity: flip.get() < 0.5 ? 1 : 0,
  }));
  const frontStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 1000 }, { rotateY: `${interpolate(flip.get(), [0, 1], [-180, 0])}deg` }],
    opacity: flip.get() >= 0.5 ? 1 : 0,
  }));
  const sweepStyle = useAnimatedStyle(() => ({
    opacity: sweep.get() <= 0 || sweep.get() >= 1 ? 0 : (holo ? 0.55 : 0.32),
    transform: [{ translateX: interpolate(sweep.get(), [0, 1], [-size * 0.9, size * 0.9]) }, { rotate: '18deg' }],
  }));

  return (
    <View style={{ width: size, height: size }}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.face, styles.back, backStyle]}>
        <View style={styles.backPattern} />
        <Text style={styles.backMark}>?</Text>
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, styles.face, styles.front, frontStyle]}>
        <Image source={{ uri: collectible.thumbnailDataUrl }} resizeMode="contain" style={styles.art}
          accessibilityIgnoresInvertColors accessible={false} />
        <Animated.View pointerEvents="none" style={[styles.sweep, { width: size * 0.3, height: size * 1.6 }, sweepStyle]} />
        {isNew ? (
          <View style={styles.newBadge} accessibilityLabel="새로 처음 받은 수집품">
            <Text style={styles.newBadgeText}>NEW</Text>
          </View>
        ) : null}
        <View style={styles.captionBar}>
          <Text numberOfLines={1} style={styles.name}>{collectible.name}</Text>
          <Text numberOfLines={1} style={styles.meta}>{merchantName} · {collectible.gradeName}</Text>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  face: { borderRadius: 20, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backfaceVisibility: 'hidden' },
  back: { backgroundColor: '#1D2E52' },
  backPattern: { position: 'absolute', width: '70%', height: '70%', borderRadius: 999, borderWidth: 2, borderColor: 'rgba(255,255,255,0.18)' },
  backMark: { color: 'rgba(255,255,255,0.35)', fontSize: 64, fontWeight: '900' },
  front: { backgroundColor: '#20305A' },
  art: { width: '78%', height: '62%', marginTop: 8 },
  sweep: { position: 'absolute', backgroundColor: '#FFFFFF' },
  newBadge: { position: 'absolute', top: 10, left: 10, backgroundColor: '#FF5D73', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  newBadgeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900', letterSpacing: 0.5 },
  captionBar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingVertical: 12, paddingHorizontal: 16, backgroundColor: 'rgba(10,16,34,0.55)' },
  name: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', textAlign: 'center' },
  meta: { color: '#C9D3EA', fontSize: 12, textAlign: 'center', marginTop: 2 },
});
