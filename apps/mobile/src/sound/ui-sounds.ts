import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { foregroundAudioMode } from './playback-audio-mode';
import {
  createUiSoundController,
  type SoundBackend,
  type UiSoundName,
  type UiSoundSettings,
} from './ui-sound-controller';

export type { UiSoundName, UiSoundSettings } from './ui-sound-controller';

// Literal requires let Metro include all sounds in both app variants.
const sources: Record<UiSoundName, number> = {
  tap: require('../../assets/sounds/tap.wav'),
  navigate: require('../../assets/sounds/navigate.wav'),
  success: require('../../assets/sounds/success.wav'),
  error: require('../../assets/sounds/error.wav'),
  open: require('../../assets/sounds/open.wav'),
  flip: require('../../assets/sounds/flip.wav'),
  close: require('../../assets/sounds/close.wav'),
};

type ExpoAudio = typeof import('expo-audio');
let audio: ExpoAudio | undefined;
const backend: SoundBackend = {
  async prepare() {
    // Older installed clients can lack the native module. In that case UI actions stay silent.
    audio = await import('expo-audio');
    await audio.setAudioModeAsync(foregroundAudioMode);
  },
  createPlayer(name) {
    if (!audio) throw new Error('Audio module unavailable');
    const player = audio.createAudioPlayer(sources[name], { downloadFirst: false });
    player.volume = 0.3;
    return player;
  },
};

const controller = createUiSoundController({ backend, storage: AsyncStorage });

/** Call once from the root layout's effect and return its cleanup. */
export function initializeUiSounds(): () => void {
  const cleanup = controller.start(AppState.currentState === 'active');
  const subscription = AppState.addEventListener('change', (state) => {
    controller.setForeground(state === 'active');
  });
  return () => {
    subscription.remove();
    cleanup();
  };
}

/** Best effort: an unavailable sound never blocks a press or navigation. */
export function playUiSound(name: UiSoundName): void {
  try { controller.play(name); } catch { /* UI sounds are optional. */ }
}

export function useUiSoundSettings(): UiSoundSettings {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}
