import { useEffect, useState } from 'react';
import { AppState, PanResponder, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';

import type { PublishedCollectible } from '@/commerce/collectible-artwork';
import { ConfettiBurst } from '@/gamification/confetti';
import { lightHaptic, successHaptic } from '@/gamification/native-effects';
import { useMotionEnabled } from '@/motion/use-motion';
import { Mascot } from '@/ui/mascot';

import { seriesSlotText, type StoreSeries } from '../store-series';
import { EnvelopeCard } from './envelope-card';
import { EnvelopeBody, EnvelopeFlapTorn, LeafSealGlyph } from './envelope-glyphs';
import { startCards, stepCard, type EnvelopeCardStep, type EnvelopeMilestone } from './envelope-state';
import { RevealLifecycle } from '../reveal-lifecycle';

export type EnvelopeCardData = { entitlementId: string; collectible: PublishedCollectible; isNew: boolean };

type Props = {
  cards: readonly EnvelopeCardData[];
  merchantName: string;
  series: StoreSeries | undefined;
  milestone: EnvelopeMilestone;
  onSkip: () => void;
  /** Opens the full detail for the first card. */
  onOpenDetail: (entitlementId: string) => void;
};

const TEAR_MS = 650;

/**
 * Idle (sealed, tap or swipe down to tear) → tearing (shake, light burst, flap off) → cards (flip, swipe/tap through)
 * → end (storage + series progress + milestone). The tear transition reuses RevealLifecycle exactly as collectible
 * acquisition already does — same reduce-motion-skips-the-animation and background-completes-immediately behaviour —
 * but the instance is only created once the person actually taps, so backgrounding the idle, untapped envelope
 * cannot auto-complete a tear nobody asked for (RevealLifecycle's `stage` starts at 'opening' from construction).
 */
export function EnvelopeReveal({ cards, merchantName, series, milestone, onSkip, onOpenDetail }: Props) {
  const motionAllowed = useMotionEnabled();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cardSize = Math.min(width - 72, 300);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [uiStage, setUiStage] = useState<'idle' | 'tearing' | 'open'>('idle');
  const [cardStep, setCardStep] = useState<EnvelopeCardStep>(() => startCards(cards.length));
  const [lifecycle, setLifecycle] = useState<RevealLifecycle>();
  const float = useSharedValue(0);
  const shake = useSharedValue(0);
  const tear = useSharedValue(0);
  const dragX = useSharedValue(0);

  useEffect(() => {
    if (!motionAllowed || uiStage !== 'idle') { float.set(0); return; }
    float.set(withDelay(200, withSequence(
      withTiming(-8, { duration: 900, easing: Easing.inOut(Easing.sin) }),
      withTiming(0, { duration: 900, easing: Easing.inOut(Easing.sin) }),
    )));
  }, [motionAllowed, uiStage, float]);

  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      const isForeground = state === 'active';
      setForeground(isForeground);
      lifecycle?.setForeground(isForeground);
    });
    return () => listener.remove();
  }, [lifecycle]);
  useEffect(() => { lifecycle?.setMotionAllowed(motionAllowed); }, [lifecycle, motionAllowed]);
  useEffect(() => () => lifecycle?.dispose(), [lifecycle]);

  function openEnvelope() {
    if (uiStage !== 'idle') return;
    tear.set(motionAllowed && foreground ? 0 : 1);
    setUiStage('tearing');
    void lightHaptic();
    const created = new RevealLifecycle(
      {
        onAnimateOpening: () => {
          shake.set(withSequence(
            withTiming(-6, { duration: 60 }), withTiming(6, { duration: 90 }),
            withTiming(-4, { duration: 80 }), withTiming(4, { duration: 70 }), withTiming(0, { duration: 70 }),
          ));
          tear.set(withDelay(130, withTiming(1, { duration: TEAR_MS - 130, easing: Easing.out(Easing.cubic) })));
        },
        onStageComplete: () => {
          tear.set(1);
          setUiStage('open');
          void successHaptic();
        },
      },
      TEAR_MS,
      { foreground, motionAllowed },
    );
    setLifecycle(created);
    created.start();
  }

  function goTo(direction: 1 | -1) {
    setCardStep((current) => stepCard(current, cards.length, direction));
  }

  // Recreated every render (cheap: it just builds a handlers object) so each handler always closes over the latest
  // uiStage/cardStep/cards — no stale-ref bridging needed for a screen that re-renders this rarely.
  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => uiStage === 'idle',
    onMoveShouldSetPanResponder: (_event, gesture) => uiStage === 'idle' && Math.abs(gesture.dy) > 8,
    onPanResponderRelease: (_event, gesture) => { if (gesture.dy > 32) openEnvelope(); },
  });

  const cardPanResponder = PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onPanResponderMove: (_event, gesture) => dragX.set(gesture.dx),
    onPanResponderRelease: (_event, gesture) => {
      dragX.set(withTiming(0, { duration: 150 }));
      if (gesture.dx < -40) goTo(1);
      else if (gesture.dx > 40) goTo(-1);
    },
    onPanResponderTerminate: () => { dragX.set(withTiming(0, { duration: 150 })); },
  });

  const envelopeStyle = useAnimatedStyle(() => ({
    opacity: 1 - tear.get(),
    transform: [{ translateY: float.get() }, { rotate: `${shake.get()}deg` }, { scale: 1 - tear.get() * 0.12 }],
  }));
  const flapStyle = useAnimatedStyle(() => ({
    opacity: tear.get(),
    transform: [{ translateY: -tear.get() * 70 }, { rotate: `${-10 - tear.get() * 16}deg` }],
  }));
  const dragStyle = useAnimatedStyle(() => ({ transform: [{ translateX: dragX.get() }] }));

  const current = cardStep.stage === 'cards' ? cards[cardStep.index] : undefined;

  return (
    <View style={[styles.root, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 28 }]}>
      <SkipButton onPress={onSkip} />

      {uiStage !== 'open' ? (
        <View style={styles.idleStage}>
          {/* Pressable wires its own responder internally and ignores panHandlers spread directly onto it, so the
              swipe-down-to-tear gesture is claimed by this wrapping View instead; the Pressable inside still handles
              the plain tap-to-open. */}
          <View {...panResponder.panHandlers}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="봉투를 눌러 열기"
              accessibilityHint="받은 수집품을 꺼내요"
              onPress={openEnvelope}
            >
              <Animated.View style={envelopeStyle}>
                <EnvelopeBody width={220} height={151} bodyColor="#F4EFE2" flapColor="#EADFC4" seamColor="#C9B98C" />
                <View style={styles.sealWrap}>
                  <LeafSealGlyph size={44} color="#4F7A57" ringColor="#F4EFE2" />
                </View>
              </Animated.View>
              <Animated.View style={[styles.flapTornWrap, flapStyle]} pointerEvents="none">
                <EnvelopeFlapTorn width={220} height={151} flapColor="#EADFC4" />
              </Animated.View>
            </Pressable>
          </View>
          <Text style={styles.idleHint}>봉투를 눌러 열어요</Text>
          {uiStage === 'idle' && motionAllowed ? <Mascot pose="gift" size={64} breathe /> : null}
          {uiStage === 'tearing' && motionAllowed ? (
            <ConfettiBurst colors={['#FFD27A', '#FFFFFF', '#9BDFC4']} leafColor="#4F7A57" originX={width / 2} originY={220} width={width} height={360} count={22} duration={900} />
          ) : null}
        </View>
      ) : cardStep.stage === 'cards' && current ? (
        <View style={styles.cardStage} {...cardPanResponder.panHandlers}>
          <Animated.View style={dragStyle}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${current.collectible.name}, ${current.collectible.gradeName}${current.isNew ? ', 새로 받음' : ''}, ${cardStep.index + 1}/${cards.length}번째 카드, 탭하면 다음 카드`}
              onPress={() => goTo(1)}
            >
              <EnvelopeCard
                key={current.entitlementId}
                collectible={current.collectible}
                merchantName={merchantName}
                isNew={current.isNew}
                motionAllowed={motionAllowed}
                size={cardSize}
              />
            </Pressable>
          </Animated.View>
          <Text accessibilityLiveRegion="polite" style={styles.srOnly}>
            {cardStep.index + 1}/{cards.length} · {current.collectible.name} · {current.collectible.gradeName}{current.isNew ? ' · 새로 받음' : ''}
          </Text>
          <View style={styles.dots} accessible={false} importantForAccessibility="no-hide-descendants">
            {cards.map((card, index) => (
              <View key={card.entitlementId} style={[styles.dot, index === cardStep.index && styles.dotActive]} />
            ))}
          </View>
          <View style={styles.cardNav}>
            <NavButton label="이전 카드" disabled={cardStep.index === 0} onPress={() => goTo(-1)} glyph="‹" />
            <Text style={styles.cardCount}>{cardStep.index + 1} / {cards.length}</Text>
            <NavButton label="다음 카드" onPress={() => goTo(1)} glyph="›" />
          </View>
        </View>
      ) : (
        <EndCard merchantName={merchantName} series={series} milestone={milestone} onOpenDetail={() => onOpenDetail(cards[0]!.entitlementId)} onSkip={onSkip} />
      )}
    </View>
  );
}

function NavButton({ label, glyph, disabled = false, onPress }: { label: string; glyph: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
      style={[styles.navButton, disabled && styles.navButtonDisabled]}>
      <Text style={styles.navButtonText}>{glyph}</Text>
    </Pressable>
  );
}

function EndCard({ merchantName, series, milestone, onOpenDetail, onSkip }: {
  merchantName: string; series: StoreSeries | undefined; milestone: EnvelopeMilestone; onOpenDetail: () => void; onSkip: () => void;
}) {
  return (
    <View style={styles.endStage}>
      <Mascot pose={milestone.reached ? 'cheer' : 'gift'} size={96} />
      <Text accessibilityRole="header" style={styles.endTitle}>도감에 보관했어요</Text>
      {series ? (
        <View style={styles.seriesCard}>
          <Text style={styles.seriesTitle}>{merchantName} 시리즈 {series.slots.filter((slot) => slot.owned).length}/{series.slots.length}</Text>
          <View style={styles.seriesChips}>
            {series.slots.map((slot) => (
              <View key={slot.targetVisitCount} style={[styles.chip, slot.owned && styles.chipOwned]}>
                <Text style={[styles.chipText, slot.owned && styles.chipTextOwned]}>{seriesSlotText(slot)}</Text>
              </View>
            ))}
          </View>
          {series.completed ? <Text style={styles.seriesComplete}>시리즈 완성!</Text> : null}
        </View>
      ) : null}
      {milestone.reached ? (
        <Text accessibilityLiveRegion="polite" style={styles.milestone}>{milestone.count}종류 달성!</Text>
      ) : null}
      <View style={styles.actions}>
        <Control label="자세히 보기" primary onPress={onOpenDetail} />
        <Control label="닫기" onPress={onSkip} />
      </View>
    </View>
  );
}

function SkipButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="연출 건너뛰기" onPress={onPress} style={styles.skipButton}>
      <Text style={styles.skipButtonText}>건너뛰기</Text>
    </Pressable>
  );
}

function Control({ label, onPress, primary = false }: { label: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[styles.control, primary && styles.controlPrimary]}>
      <Text style={[styles.controlText, primary && styles.controlTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#14213A', paddingHorizontal: 24, gap: 16, alignItems: 'stretch' },
  skipButton: { alignSelf: 'flex-end', minHeight: 44, paddingHorizontal: 16, justifyContent: 'center' },
  skipButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  idleStage: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18 },
  sealWrap: { position: 'absolute', top: '36%', left: '50%', marginLeft: -22, marginTop: -22 },
  flapTornWrap: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center' },
  idleHint: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', textAlign: 'center' },
  cardStage: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  srOnly: { position: 'absolute', opacity: 0, height: 1, width: 1 },
  dots: { flexDirection: 'row', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.25)' },
  dotActive: { backgroundColor: '#FFD27A', width: 20 },
  cardNav: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  navButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  navButtonDisabled: { opacity: 0.35 },
  navButtonText: { color: '#FFFFFF', fontSize: 22, fontWeight: '900' },
  cardCount: { color: '#C9D3EA', fontSize: 14, fontWeight: '700', minWidth: 48, textAlign: 'center' },
  endStage: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  endTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '900', textAlign: 'center' },
  seriesCard: { width: '100%', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 18, padding: 16, gap: 10 },
  seriesTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '800', textAlign: 'center' },
  seriesChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.1)' },
  chipOwned: { backgroundColor: '#2D6A4F' },
  chipText: { color: '#C9D3EA', fontSize: 12, fontWeight: '700' },
  chipTextOwned: { color: '#FFFFFF' },
  seriesComplete: { color: '#FFD27A', fontSize: 14, fontWeight: '900', textAlign: 'center' },
  milestone: { color: '#FFD27A', fontSize: 18, fontWeight: '900', textAlign: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  control: { minHeight: 48, paddingVertical: 12, paddingHorizontal: 18, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  controlPrimary: { backgroundColor: '#FFD27A' },
  controlText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  controlTextPrimary: { color: '#14213A' },
});
