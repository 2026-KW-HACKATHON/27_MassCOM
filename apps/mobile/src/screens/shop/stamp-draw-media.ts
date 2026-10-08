import type { ImageSourcePropType } from 'react-native';

export type StampDrawPhase = 'idle' | 'opening';

export type StampDrawSoundSettings = {
  ready: boolean;
  soundEffectsEnabled: boolean;
  soundEffectsVolume: number;
};

export const STAMP_REVEAL_DURATION_MS = 5040;
export const STAMP_REVEAL_WATCHDOG_MS = 12_000;

export type StampPlaybackConfig = {
  media: StampDrawPhase;
  loop: boolean;
  muted: boolean;
  volume: number;
  playing: boolean;
};

export type StampCompletionLatch = { current: boolean };

export function getStampDrawMedia(): Record<StampDrawPhase | 'poster', ImageSourcePropType> {
  return {
    idle: require('../../../assets/videos/gacha-stamp-idle.mp4'),
    opening: require('../../../assets/videos/gacha-stamp-reveal.mp4'),
    poster: require('../../../assets/videos/gacha-stamp-poster.png'),
  };
}

export function stampPlaybackConfig(
  phase: StampDrawPhase,
  active: boolean,
  sound: StampDrawSoundSettings,
  finishedOpening = false,
): StampPlaybackConfig {
  const opening = phase === 'opening';
  return {
    media: phase,
    loop: !opening,
    muted: !opening || !active || !sound.soundEffectsEnabled || !sound.ready || sound.soundEffectsVolume <= 0,
    volume: opening && active && sound.ready && sound.soundEffectsEnabled ? sound.soundEffectsVolume : 0,
    playing: active && (!opening || !finishedOpening),
  };
}

export function stampReducedMotionCompletionDelay(phase: StampDrawPhase, motionEnabled: boolean): number | null {
  return phase === 'opening' && !motionEnabled ? 0 : null;
}

export function stampOpeningWatchdogMs(): number {
  return STAMP_REVEAL_WATCHDOG_MS;
}

export function markStampOpeningComplete(latch: StampCompletionLatch): boolean {
  if (latch.current) return false;
  latch.current = true;
  return true;
}
