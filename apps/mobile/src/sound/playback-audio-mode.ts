import type { AudioMode } from 'expo-audio';

// Expo replaces Android's audio mode rather than merging omitted fields. Every
// foreground playback path uses this policy, including collectible greetings.
export const foregroundAudioMode = {
  allowsRecording: false,
  shouldPlayInBackground: false,
  playsInSilentMode: false,
  interruptionMode: 'mixWithOthers',
} satisfies Partial<AudioMode>;
