import { type ReactNode, useEffect, useReducer } from 'react';
import { StyleSheet, Text, View, useColorScheme } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { drawHaptic } from '@/gamification/native-effects';
import { useMotionEnabled } from '@/motion/use-motion';
import { playUiSound } from '@/sound/ui-sounds';
import { colorsForScheme } from '@/theme/palette';
import { BounceButton } from '@/ui/bounce-button';
import { FloatingCard } from '@/ui/floating-card';
import { coinRevealAccent, nextCoinRevealStage } from './coin-reveal-state';

/** The caller has already received the server result; children retain all result actions. */
export function CoinReveal({ sourceLabel, gradeId, recovered, children }: {
  sourceLabel: string; gradeId: string; recovered: boolean; children: ReactNode;
}) {
  const palette = colorsForScheme(useColorScheme());
  const motionEnabled = useMotionEnabled();
  const [stage, advance] = useReducer(nextCoinRevealStage, recovered ? 'result' : 'source');
  const accent = coinRevealAccent(gradeId);
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  useEffect(() => {
    if (stage !== 'opening') return;
    if (!motionEnabled) { advance('settle'); return; }
    scale.set(withRepeat(withSequence(withTiming(accent.scale, { duration: 180 }), withTiming(.94, { duration: 180 })), -1, true));
    const timer = setTimeout(() => advance('settle'), accent.duration);
    return () => { clearTimeout(timer); cancelAnimation(scale); scale.set(1); };
  }, [stage, motionEnabled, accent.duration, accent.scale, scale]);

  if (stage === 'result') return <>{children}</>;
  return <FloatingCard style={styles.card}>
    <Text accessibilityRole="header" style={[styles.title, { color: palette.label }]}>가게에서 온 코인</Text>
    <Text style={{ color: palette.secondaryLabel }}>{sourceLabel}</Text>
    <Text style={{ color: palette.secondaryLabel }}>코인은 이미 보관됐어요. 천천히 열어 보고 감상해요.</Text>
    {stage === 'opening' ? <>
      <View style={styles.stage} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Animated.View style={[styles.seal, { borderColor: palette.primary, backgroundColor: palette.primaryContainer }, animatedStyle]}>
          {Array.from({ length: accent.rings }, (_, index) => <View key={index} style={[styles.ring,
            { inset: 9 + index * 10, borderColor: index % 2 ? palette.onAccentContainer : palette.primary }]} />)}
          <Text style={[styles.sealText, { color: palette.onPrimaryContainer }]}>✦</Text>
        </Animated.View>
      </View>
      <Text accessibilityLiveRegion="polite" style={{ color: palette.label }}>{accent.label} 코인을 여는 중이에요</Text>
    </> : <BounceButton label="출처 확인 · 코인 열기" onPress={() => {
      playUiSound('open'); void drawHaptic(); advance('open');
    }} />}
    <BounceButton label="연출 건너뛰고 결과 보기" variant="secondary" onPress={() => advance('skip')} />
  </FloatingCard>;
}

const styles = StyleSheet.create({
  card: { gap: 14, padding: 16 },
  title: { fontSize: 20, fontWeight: '800' },
  stage: { alignItems: 'center', padding: 16 },
  seal: { width: 136, height: 136, borderRadius: 68, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', borderWidth: 2, borderRadius: 68 },
  sealText: { fontSize: 30, fontWeight: '800' },
});
