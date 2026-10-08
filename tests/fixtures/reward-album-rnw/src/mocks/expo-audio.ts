export async function setAudioModeAsync(): Promise<void> {}

export function createAudioPlayer() {
  return {
    volume: 0,
    loop: false,
    play: () => undefined,
    pause: () => undefined,
    remove: () => undefined,
  };
}
