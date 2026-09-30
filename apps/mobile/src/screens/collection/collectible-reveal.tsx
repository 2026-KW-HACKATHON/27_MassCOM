import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  const [stage, setStage] = useState<'opening' | 'revealed'>(motionAllowed ? 'opening' : 'revealed');
  const [muted, setMuted] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const player = useAudioPlayer(snapshot.audio ? { uri: snapshot.audio.dataUrl } : null);
  const reveal = useSharedValue(motionAllowed ? 0 : 1);
  const isStamp = snapshot.shape === 'stamp';
  // 재생 요청마다 올리는 세대. 음을 끄거나 백그라운드로 가면 세대를 올려, 그 이전에 시작한 재생 요청이 나중에 끝나도 소리를 내지 않게 막는다.
  const audioAction = useRef(0);
  const moving = motionAllowed && foreground;

  const pause = useCallback(() => {
    audioAction.current += 1;
    try { player.pause(); } catch { /* 이미 해제된 player일 수 있다. */ }
  }, [player]);

  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      setForeground(state === 'active');
      if (state !== 'active') pause();
    });
    return () => listener.remove();
  }, [pause]);

  useEffect(() => {
    if (stage !== 'opening') return;
    if (!moving) {
      // 동작 줄이기가 켜졌거나 화면이 백그라운드로 간 경우: 진행 중이던 열림 연출을 멈추고 바로 정적 결과 화면으로 넘어간다.
      // 그래야 동작 줄이기를 연출 중간에 켰을 때 대사·상세 보기 버튼이 영영 나오지 않는 일이 없다.
      const timer = setTimeout(() => { reveal.set(1); setStage('revealed'); }, 0);
      return () => clearTimeout(timer);
    }
    reveal.set(withTiming(1, { duration: 650, easing: Easing.out(Easing.cubic) }));
    const timer = setTimeout(() => setStage('revealed'), 700);
    return () => clearTimeout(timer);
  }, [moving, stage, reveal]);

  useEffect(() => {
    if (stage === 'revealed') void successHaptic();
  }, [stage]);

  useEffect(() => () => pause(), [pause]);

  const openingStyle = useAnimatedStyle(() => isStamp
    ? { opacity: reveal.get(), transform: [{ translateY: (1 - reveal.get()) * -36 }, { scale: 0.7 + reveal.get() * 0.3 }] }
    : { opacity: Math.max(0.05, reveal.get()), transform: [{ scaleX: Math.max(0.05, reveal.get()) }] });
  const burstStyle = useAnimatedStyle(() => ({ opacity: 0.35 + reveal.get() * 0.65, transform: [{ scale: 0.6 + reveal.get() * 0.4 }] }));

  const playGreeting = async () => {
    if (muted || !snapshot.audio || !foreground) return;
    const action = ++audioAction.current;
    try {
      await setAudioModeAsync({ shouldPlayInBackground: false, allowsRecording: false });
      await player.seekTo(0);
      // 대기하는 동안 소리 끄기를 누르거나 백그라운드로 갔다면(세대가 바뀌었다면) 이제 와서 재생을 시작하지 않는다.
      if (action === audioAction.current) player.play();
    } catch { /* 소리는 부가 효과라 실패해도 대사 텍스트는 그대로 보인다. */ }
  };

  const onMutedChange = (value: boolean) => {
    setMuted(value);
    if (value) pause();
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
