import type { View } from 'react-native';

// Native extras are imported lazily: an older development client without these modules
// must still open the collection and claim screens (it just skips haptics / image sharing).

export async function successHaptic(): Promise<void> {
  try {
    const Haptics = await import('expo-haptics');
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    // Haptics are a bonus; silence is the correct fallback.
  }
}

export async function lightHaptic(): Promise<void> {
  try {
    const Haptics = await import('expo-haptics');
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch {
    // Same as above.
  }
}

export async function captureViewAsPng(view: View): Promise<string> {
  const { captureRef } = await import('react-native-view-shot');
  return captureRef(view, { format: 'png', quality: 1, result: 'tmpfile', fileName: 'masscom-badge' });
}

/**
 * Returns false when the platform share sheet for files is unavailable. `isAlive`, if given, is checked immediately
 * before actually opening the share sheet — after the two awaits above, a caller whose screen unmounted in the
 * meantime (e.g. an account switch) can stop this from opening the sheet with stale data. Defaults to always alive.
 */
export async function shareImageFile(uri: string, dialogTitle: string, isAlive: () => boolean = () => true): Promise<boolean> {
  const Sharing = await import('expo-sharing');
  if (!(await Sharing.isAvailableAsync())) return false;
  if (!isAlive()) return false;
  await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle, UTI: 'public.png' });
  return true;
}
