import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Image, StyleSheet, View } from 'react-native';

import { useMotionEnabled } from '@/motion/use-motion';
import { useUiSoundSettings } from '@/sound/ui-sounds';

import {
  getStampDrawMedia,
  markStampOpeningComplete,
  stampOpeningWatchdogMs,
  stampPlaybackConfig,
  stampReducedMotionCompletionDelay,
  type StampDrawPhase,
} from './stamp-draw-media';
import { StampVideo } from './stamp-video';

type Props = {
  phase: StampDrawPhase;
  onComplete?: () => void;
  compact?: boolean;
};

export function StampDrawStage({ phase, onComplete, compact = false }: Props) {
  return <StampDrawStageContent key={phase} phase={phase} onComplete={onComplete} compact={compact} />;
}

function StampDrawStageContent({ phase, onComplete, compact }: Props) {
  const motionEnabled = useMotionEnabled();
  const soundSettings = useUiSoundSettings();
  const media = useMemo(() => getStampDrawMedia(), []);
  const [focused, setFocused] = useState(true);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [finishedOpening, setFinishedOpening] = useState(false);
  const finishedOpeningLatch = useRef(false);
  const completeRef = useRef(onComplete);

  useEffect(() => { completeRef.current = onComplete; }, [onComplete]);

  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => { setFocused(false); };
  }, []));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => subscription.remove();
  }, []);

  const completeOnce = useCallback(() => {
    if (!markStampOpeningComplete(finishedOpeningLatch)) return;
    setFinishedOpening(true);
    completeRef.current?.();
  }, []);

  const active = focused && foreground;
  const reducedMotionDelay = stampReducedMotionCompletionDelay(phase, motionEnabled);
  const playback = stampPlaybackConfig(phase, active, soundSettings, finishedOpening);

  useEffect(() => {
    if (reducedMotionDelay === null || finishedOpening) return;
    const timer = setTimeout(completeOnce, reducedMotionDelay);
    return () => clearTimeout(timer);
  }, [completeOnce, finishedOpening, reducedMotionDelay]);

  useEffect(() => {
    if (phase !== 'opening' || !motionEnabled || !active || finishedOpening) return;
    const timer = setTimeout(completeOnce, stampOpeningWatchdogMs());
    return () => clearTimeout(timer);
  }, [active, completeOnce, finishedOpening, motionEnabled, phase]);

  return <View accessibilityLabel="우표 뽑기 연출" style={[styles.root, compact ? styles.compact : styles.regular]}>
    {motionEnabled ? <StampVideo
      key={playback.media}
      source={media[playback.media]}
      posterSource={media.poster}
      playing={playback.playing}
      loop={playback.loop}
      muted={playback.muted}
      volume={playback.volume}
      style={styles.video}
      onEnded={completeOnce}
      onError={phase === 'opening' ? completeOnce : undefined}
    /> : <Image source={media.poster} resizeMode="contain" style={styles.video} />}
  </View>;
}

const styles = StyleSheet.create({
  root: {
    alignSelf: 'stretch',
    overflow: 'hidden',
    backgroundColor: '#000000',
  },
  regular: {
    height: 440,
    maxHeight: 440,
    minHeight: 320,
  },
  compact: {
    height: 300,
    minHeight: 260,
  },
  video: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000000',
  },
});
