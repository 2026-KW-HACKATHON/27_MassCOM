import { useSyncExternalStore } from 'react';

type UiSoundSettings = {
  ready: boolean;
  enabled: boolean;
  bgmEnabled: boolean;
  soundEffectsEnabled: boolean;
  soundEffectsVolume: number;
  hapticMode: 'ON' | 'OFF';
  persistenceError?: string;
};

let lastKey = '';
let lastSnapshot: UiSoundSettings | undefined;

function snapshot(): UiSoundSettings {
  const params = new URLSearchParams(window.location.search);
  const muted = params.get('sound') === 'off';
  const key = muted ? 'off' : 'on';
  if (lastSnapshot && key === lastKey) return lastSnapshot;
  lastKey = key;
  lastSnapshot = {
    ready: true,
    enabled: !muted,
    bgmEnabled: !muted,
    soundEffectsEnabled: !muted,
    soundEffectsVolume: muted ? 0 : 0.72,
    hapticMode: muted ? 'OFF' : 'ON',
  };
  return lastSnapshot;
}

export function playUiSound(name: string): void {
  window.__qaSoundEvents = [...(window.__qaSoundEvents ?? []), name];
}

export function useDrawMusic(): void {}

export function useUiSoundSettings(): UiSoundSettings {
  return useSyncExternalStore(() => () => undefined, snapshot, snapshot);
}

export function getUiSoundSnapshot(): UiSoundSettings {
  return snapshot();
}

declare global {
  interface Window {
    __qaSoundEvents?: string[];
  }
}
