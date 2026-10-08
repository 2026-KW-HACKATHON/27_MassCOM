import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { useCallback, useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';

import { foregroundAudioMode } from './playback-audio-mode';
import {
  createUiSoundController,
  type MusicSoundName,
  type SoundBackend,
  type UiSoundName,
  type UiSoundSettings,
} from './ui-sound-controller';

export type { HapticMode, UiSoundName, UiSoundSettings } from './ui-sound-controller';

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
const musicSources: Record<MusicSoundName, number> = {
  drawIntro: require('../../assets/sounds/draw-intro.mp3'),
  drawLoop: require('../../assets/sounds/draw-loop.mp3'),
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
  createMusicPlayer(name) {
    if (!audio) throw new Error('Audio module unavailable');
    const player = audio.createAudioPlayer(musicSources[name], { downloadFirst: false });
    player.volume = 0.3;
    if (name === 'drawLoop') player.loop = true;
    return player;
  },
};

// 웹은 UI 소리와 BGM을 첫 입력 뒤에 만든다. 네이티브 BGM도 첫 렌더 뒤에 지연 생성한다.
const controller = createUiSoundController({ backend, storage: AsyncStorage, deferUiPlayers: Platform.OS === 'web' });

/** 웹: 재생이 확인될 때까지 신뢰된 입력 안에서 로드·재생을 재시도한다. */
function onFirstGesture(soundController: Pick<ReturnType<typeof createUiSoundController>, 'loadUiPlayers' | 'needsMusicGesture' | 'subscribe'>): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const events = ['pointerdown', 'keydown', 'touchstart'] as const;
  let armed = false;
  function sync() {
    const needed = soundController.needsMusicGesture();
    if (armed === needed) return;
    armed = needed;
    events.forEach((name) => {
      if (armed) document.addEventListener(name, handle, true);
      else document.removeEventListener(name, handle, true);
    });
  }
  function handle(event: Event) {
    if (!event.isTrusted) return;
    soundController.loadUiPlayers();
    sync();
  }
  const unsubscribe = soundController.subscribe(sync);
  sync();
  return () => {
    unsubscribe();
    events.forEach((name) => document.removeEventListener(name, handle, true));
  };
}

/** Call once from the root layout's effect and return its cleanup. */
export function initializeUiSounds(): () => void {
  const cleanup = controller.start(AppState.currentState === 'active');
  const subscription = AppState.addEventListener('change', (state) => {
    controller.setForeground(state === 'active');
  });
  const stopUiGesture = Platform.OS === 'web' ? onFirstGesture({
    loadUiPlayers: () => controller.loadUiPlayers(false),
    needsMusicGesture: controller.needsUiGesture,
    subscribe: controller.subscribe,
  }) : undefined;
  const stopGesture = Platform.OS === 'web' ? onFirstGesture(controller) : undefined;
  return () => {
    stopUiGesture?.();
    stopGesture?.();
    subscription.remove();
    cleanup();
  };
}

/** Logout pauses music and clears pending gesture retries without changing device preferences. */
export function setUiSoundSessionActive(active: boolean): void {
  controller.setMusicSessionActive(active);
}

/** Best effort: an unavailable sound never blocks a press or navigation. */
export function playUiSound(name: UiSoundName): void {
  try { controller.play(name); } catch { /* UI sounds are optional. */ }
}

/** Play the draw intro while focused; cleanup falls back to the normal loop. */
export function useDrawMusic(enabled = true): void {
  useFocusEffect(useCallback(() => {
    if (!enabled) return undefined;
    controller.setDrawMusicFocused(true);
    return () => controller.setDrawMusicFocused(false);
  }, [enabled]));
}

export function useUiSoundSettings(): UiSoundSettings {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}

export function getUiSoundSnapshot(): UiSoundSettings {
  return controller.getSnapshot();
}
