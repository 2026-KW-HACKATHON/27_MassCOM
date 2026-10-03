import { useEffect, useState } from 'react';
import { AppState, Image, StyleSheet, Text, View } from 'react-native';
import Animated, { cancelAnimation, Easing, interpolate, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Polygon } from 'react-native-svg';

import type { PublishedCollectible } from '@/commerce/collectible-artwork';
import { gradeMaterialFor } from '../grade-material';
import { GradeMaterialLayer } from '../grade-material-layer';

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
  const material = gradeMaterialFor(collectible.gradeId, collectible.gradeName);
  const precious = material === 'gold' || material === 'prism';
  const artSize = size * 0.7;
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const animate = motionAllowed && foreground;

  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => listener.remove();
  }, []);

  useEffect(() => {
    if (!animate) { flip.set(1); sweep.set(1); return; }
    flip.set(0);
    sweep.set(0);
    const flipTimer = setTimeout(() => {
      flip.set(withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) }));
    }, 260);
    const sweepTimer = setTimeout(() => {
      sweep.set(withTiming(1, { duration: holo ? 1100 : 700, easing: Easing.linear }));
    }, 260 + 420);
    return () => { clearTimeout(flipTimer); clearTimeout(sweepTimer); cancelAnimation(flip); cancelAnimation(sweep); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- collectible identity changes every card; flip/sweep are stable shared values.
  }, [collectible.publicationId, collectible.gradeId, animate]);

  const backStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 1000 }, { rotateY: `${interpolate(flip.get(), [0, 1], [0, 180])}deg` }],
    opacity: flip.get() < 0.5 ? 1 : 0,
  }));
  const frontStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 1000 }, { rotateY: `${interpolate(flip.get(), [0, 1], [-180, 0])}deg` }],
    opacity: flip.get() >= 0.5 ? 1 : 0,
  }));
  const sweepStyle = useAnimatedStyle(() => ({
    opacity: sweep.get() <= 0 || sweep.get() >= 1 ? 0 : (holo ? 0.55 : precious ? 0.2 : 0.32),
    transform: [{ translateX: interpolate(sweep.get(), [0, 1], [-size * 0.9, size * 0.9]) }, { rotate: '18deg' }],
  }));
  const burstStyle = useAnimatedStyle(() => ({
    opacity: animate && precious && sweep.get() > 0 && sweep.get() < 0.7
      ? interpolate(sweep.get(), [0, 0.15, 0.7], [0, 0.58, 0]) : 0,
    transform: [{ scale: interpolate(sweep.get(), [0, 0.7, 1], [0.7, 1.25, 1.25]) }],
  }));

  return (
    <View style={{ width: size, height: size }}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.face, styles.back, backStyle]}>
        <View style={styles.backPattern} />
        <Text style={styles.backMark}>?</Text>
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, styles.face, styles.front, frontStyle]}>
        {precious && animate ? (
          <Animated.View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
            style={[StyleSheet.absoluteFill, burstStyle]}>
            <Svg width={size} height={size} viewBox="0 0 100 100">
              {Array.from({ length: material === 'prism' ? 12 : 8 }, (_, index) => {
                const angle = 2 * Math.PI * index / (material === 'prism' ? 12 : 8);
                const x = 50 + 75 * Math.cos(angle);
                const y = 50 + 75 * Math.sin(angle);
                const dx = -Math.sin(angle) * 5;
                const dy = Math.cos(angle) * 5;
                const color = material === 'gold' ? '#FFD46A' : ['#78F5FF', '#A9A3FF', '#FF9DD8', '#FFE68A', '#89FFD2'][index % 5];
                return <Polygon key={index} points={`50,50 ${x - dx},${y - dy} ${x + dx},${y + dy}`} fill={color} opacity={0.32} />;
              })}
            </Svg>
          </Animated.View>
        ) : null}
        <View style={{ width: artSize, height: artSize, marginTop: 8 }}>
          <Image source={{ uri: collectible.thumbnailDataUrl }} resizeMode="contain" style={StyleSheet.absoluteFill}
            accessibilityIgnoresInvertColors accessible={false} />
          <GradeMaterialLayer material={material} size={artSize} faceUri={collectible.thumbnailDataUrl} shape={collectible.shape}
            variant="envelope" active={animate && precious} intensityScale={holo ? .75 : 1} />
        </View>
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
  sweep: { position: 'absolute', backgroundColor: '#FFFFFF' },
  newBadge: { position: 'absolute', top: 10, left: 10, backgroundColor: '#FF5D73', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  newBadgeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900', letterSpacing: 0.5 },
  captionBar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingVertical: 12, paddingHorizontal: 16, backgroundColor: 'rgba(10,16,34,0.55)' },
  name: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', textAlign: 'center' },
  meta: { color: '#C9D3EA', fontSize: 12, textAlign: 'center', marginTop: 2 },
});
