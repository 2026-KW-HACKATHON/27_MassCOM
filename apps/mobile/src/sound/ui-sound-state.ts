import type { HapticMode } from './ui-sound-controller';

let currentHapticMode: HapticMode = 'ALL';

export function setGlobalHapticMode(mode: HapticMode): void {
  currentHapticMode = mode;
}

export function getGlobalHapticMode(): HapticMode {
  return currentHapticMode;
}
