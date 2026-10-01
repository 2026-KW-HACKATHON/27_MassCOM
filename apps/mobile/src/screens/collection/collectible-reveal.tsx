import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { useEffect, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import type { PublishedCollectible } from '@/commerce/collectible-artwork';
import { FullScreenModal } from '@/gamification/full-screen-modal';
import { SparkleGlyph } from '@/gamification/glyphs';
import { successHaptic } from '@/gamification/native-effects';
import { useMotionEnabled } from '@/motion/use-motion';
import { Mascot } from '@/ui/mascot';
import { StateScene } from '@/ui/state-scene';

import { collectibleDetailFailure, type CollectibleDetailFailure } from './collectible-detail-state';
import { RevealLifecycle, type RevealStage } from './reveal-lifecycle';

type Props = {
  entitlementId: string;
  merchantName: string;
  load: (entitlementId: string) => Promise<PublishedCollectible>;
  /** Skips (or finishes) the reveal without opening the full detail. The reward is already stored either way. */
  onSkip: () => void;
  /** Leaves the reveal for the full collectible detail screen. */
  onOpenDetail: () => void;
};

/**
 * 16장 "획득 연출": 방문 수령으로 사진 수집품을 받으면 열리는 짧은 연출. 포장/도장 열림 → 수집품 등장 → 대사(탭해야 소리 재생) →
 * "도감에 보관했어요" 순서로 넘어간다. 언제든 건너뛸 수 있고, 건너뛰어도 보관은 이미 끝난 상태다(이 화면은 저장에 관여하지 않는다).
 */
export function CollectibleReveal({ entitlementId, merchantName, load, onSkip, onOpenDetail }: Props) {
  const [snapshot, setSnapshot] = useState<PublishedCollectible>();
  const [failure, setFailure] = useState<CollectibleDetailFailure>();
  useEffect(() => {
    let active = true;
    void load(entitlementId).then((value) => {
      if (active) setSnapshot(value);
    }).catch((caught: unknown) => {
      if (!active) return;
      setFailure(collectibleDetailFailure(caught));
    });
    return () => { active = false; };
  }, [entitlementId, load]);

  return (
    <FullScreenModal visible animationType="fade" onRequestClose={onSkip}>
      {snapshot ? (
        <RevealBody snapshot={snapshot} merchantName={merchantName} onSkip={onSkip} onOpenDetail={onOpenDetail} />
      ) : failure ? (
        <View style={styles.loadingFrame}>
          <SkipButton onPress={onSkip} />
          <StateScene kind={failure.removed ? 'empty' : 'error'} title={failure.title} body={failure.body} />
          <Control label="도감으로 돌아가기" onPress={onSkip} />
        </View>
      ) : (
        <View style={styles.loadingFrame}>
          <SkipButton onPress={onSkip} />
          <StateScene kind="loading" title="수집품을 펼치는 중" />
        </View>
      )}
    </FullScreenModal>
  );
}

/** 건너뛰기는 로딩·실패 상태를 포함해 이 화면의 어느 단계에서도 보여야 한다. */
function SkipButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="연출 건너뛰기" onPress={onPress} style={styles.skipButton}>
      <Text style={styles.skipButtonText}>건너뛰기</Text>
    </Pressable>
  );
}

function RevealBody({ snapshot, merchantName, onSkip, onOpenDetail }: {
  snapshot: PublishedCollectible; merchantName: string; onSkip: () => void; onOpenDetail: () => void;
}) {
  const insets = useSafeAreaInsets();
  const motionAllowed = useMotionEnabled();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [muted, setMuted] = useState(false);
  // Lazy initializers (evaluated once, on the first render only) so an already-static mount (reduce-motion or
  // backgrounded from the start) never flashes the opening state before the lifecycle effect below corrects it.
  const [stage, setStage] = useState<RevealStage>(() => (motionAllowed && foreground ? 'opening' : 'revealed'));
  const reveal = useSharedValue(motionAllowed && foreground ? 0 : 1);
  const player = useAudioPlayer(snapshot.audio ? { uri: snapshot.audio.dataUrl } : null);
  const isStamp = snapshot.shape === 'stamp';

  // Owns the opening→revealed transition and the audio play generation; see reveal-lifecycle.ts and its tests for
  // the races this exists to close (mute/background/unmount racing a pending play(), reduce-motion or backgrounding
  // mid-opening never advancing the stage). The lazy useState initializer runs exactly once, so the controller is
  // built a single time per mount — a ref would read the same way but this repo's lint forbids reading ref.current
  // during render (react-hooks/refs), so a stable piece of state is used instead of a ref for this singleton.
  const [lifecycle] = useState(() => new RevealLifecycle(
    {
      onAnimateOpening: () => reveal.set(withTiming(1, { duration: 650, easing: Easing.out(Easing.cubic) })),
      onStageComplete: () => { reveal.set(1); setStage('revealed'); },
    },
    700,
    { foreground, motionAllowed },
  ));

  // start()/dispose() run exactly once (lifecycle's identity never changes across renders). Foreground and mute are
  // pushed to the controller straight from the event that changes them (the AppState listener, the mute Switch),
  // not from an effect a render cycle later — a background/mute that arrives while play() is mid-flight must
  // invalidate it immediately, not after React gets around to committing. motionAllowed has no such event to hook;
  // useMotionEnabled() only surfaces a new value via re-render, so an effect is the only way to observe it, and it
  // is not audio-time-sensitive (it never gates play(), only the opening animation) so the one-tick lag is fine.
  useEffect(() => {
    lifecycle.start();
    return () => lifecycle.dispose();
  }, [lifecycle]);
  useEffect(() => { lifecycle.setMotionAllowed(motionAllowed); }, [lifecycle, motionAllowed]);

  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      const isForeground = state === 'active';
      setForeground(isForeground);
      lifecycle.setForeground(isForeground);
    });
    return () => listener.remove();
  }, [lifecycle]);

  useEffect(() => {
    if (stage === 'revealed') void successHaptic();
  }, [stage]);

  const onMutedChange = (value: boolean) => {
    setMuted(value);
    lifecycle.setMuted(value);
  };

  const openingStyle = useAnimatedStyle(() => isStamp
    ? { opacity: reveal.get(), transform: [{ translateY: (1 - reveal.get()) * -36 }, { scale: 0.7 + reveal.get() * 0.3 }] }
    : { opacity: Math.max(0.05, reveal.get()), transform: [{ scaleX: Math.max(0.05, reveal.get()) }] });
  const burstStyle = useAnimatedStyle(() => ({ opacity: 0.35 + reveal.get() * 0.65, transform: [{ scale: 0.6 + reveal.get() * 0.4 }] }));

  const playGreeting = async () => {
    if (!snapshot.audio) return;
    await lifecycle.play({
      setAudioMode: () => setAudioModeAsync({ shouldPlayInBackground: false, allowsRecording: false }),
      seekToStart: () => player.seekTo(0),
      startPlayback: () => player.play(),
    });
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#14213A' }} contentContainerStyle={[styles.body, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 28 }]}>
      <SkipButton onPress={onSkip} />

      <View style={styles.stage}>
        <View style={{ alignItems: 'center', justifyContent: 'center', height: 40 }} importantForAccessibility="no-hide-descendants">
          <Animated.View style={[{ flexDirection: 'row', gap: 14 }, burstStyle]}>
            <SparkleGlyph size={16} color="#FFD27A" />
            <SparkleGlyph size={24} color="#FFFFFF" />
            <SparkleGlyph size={16} color="#FFD27A" />
          </Animated.View>
        </View>
        {isStamp ? <Mascot pose="stamp" size={96} breathe={false} /> : null}
        <Animated.Image
          source={{ uri: snapshot.thumbnailDataUrl }}
          resizeMode="contain"
          accessibilityLabel={`${merchantName}에서 받은 ${snapshot.name}`}
          style={[{ width: 220, height: 220 }, openingStyle]}
        />
      </View>

      {stage === 'revealed' ? (
        <View style={styles.revealed}>
          <Text accessibilityRole="header" style={styles.title}>{snapshot.name}</Text>
          <Text style={styles.meta}>{merchantName} · {snapshot.gradeName}</Text>
          {snapshot.greeting ? <Text selectable accessibilityLiveRegion="polite" style={styles.greeting}>{snapshot.greeting}</Text> : null}
          {snapshot.audio ? (
            <>
              <View style={styles.toggle}>
                <Text style={styles.toggleLabel}>소리 끄기</Text>
                <Switch accessibilityLabel="사장님 음성 소리 끄기" value={muted} onValueChange={onMutedChange} />
              </View>
              <Control label="사장님 음성 듣기" disabled={muted || !foreground} onPress={() => { void playGreeting(); }} />
            </>
          ) : null}
          <Text style={styles.stored}>도감에 보관했어요</Text>
          <View style={styles.actions}>
            <Control label="자세히 보기" primary onPress={onOpenDetail} />
            <Control label="닫기" onPress={onSkip} />
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

function Control({ label, onPress, disabled = false, primary = false }: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled}
      onPress={onPress} style={[styles.control, primary && styles.controlPrimary, disabled && { opacity: 0.5 }]}>
      <Text style={[styles.controlText, primary && styles.controlTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  loadingFrame: { flex: 1, alignItems: 'stretch', justifyContent: 'center', padding: 24, gap: 16, backgroundColor: '#14213A' },
  body: { paddingHorizontal: 24, gap: 16, alignItems: 'stretch' },
  skipButton: { alignSelf: 'flex-end', minHeight: 44, paddingHorizontal: 16, justifyContent: 'center' },
  skipButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  stage: { alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 260 },
  revealed: { gap: 14, alignItems: 'stretch' },
  title: { color: '#FFFFFF', fontSize: 24, fontWeight: '900', textAlign: 'center' },
  meta: { color: '#C9D3EA', fontSize: 13, textAlign: 'center' },
  greeting: { color: '#FFFFFF', fontSize: 18, lineHeight: 26, textAlign: 'center' },
  stored: { color: '#FFD27A', fontSize: 15, fontWeight: '800', textAlign: 'center' },
  toggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggleLabel: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  control: { minHeight: 48, paddingVertical: 12, paddingHorizontal: 18, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  controlPrimary: { backgroundColor: '#FFD27A' },
  controlText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  controlTextPrimary: { color: '#14213A' },
});
