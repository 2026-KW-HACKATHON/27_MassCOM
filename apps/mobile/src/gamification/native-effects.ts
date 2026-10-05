import type { View } from 'react-native';

import { getGlobalHapticMode } from '@/sound/ui-sound-state';

// Native extras are imported lazily: an older development client without these modules
// must still open the collection and claim screens (it just skips haptics / image sharing).

export async function successHaptic(): Promise<void> {
  if (getGlobalHapticMode() !== 'ALL') return;
  try {
    const Haptics = await import('expo-haptics');
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    // Haptics are a bonus; silence is the correct fallback.
  }
}

export async function lightHaptic(): Promise<void> {
  if (getGlobalHapticMode() !== 'ALL') return;
  await impactLight();
}

export async function drawHaptic(): Promise<void> {
  const mode = getGlobalHapticMode();
  if (mode !== 'DRAW_ONLY' && mode !== 'ALL') return;
  await impactLight();
}

async function impactLight(): Promise<void> {
  try {
    const Haptics = await import('expo-haptics');
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch {
    // Same as above.
  }
}

/** Output size in pixels and file name; both optional so the original badge callers keep working untouched. */
export type CaptureOptions = { width?: number; height?: number; fileName?: string };

/**
 * A size is passed only when both sides are usable: one side alone would stretch the picture along one axis.
 * Kept free of the lazy import below so it can be unit-tested without the native module.
 */
export function captureRefOptions(options: CaptureOptions = {}) {
  const size = isPixels(options.width) && isPixels(options.height) ? { width: options.width, height: options.height } : {};
  return { format: 'png' as const, quality: 1, result: 'tmpfile' as const, fileName: options.fileName ?? 'masscom-badge', ...size };
}

function isPixels(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export async function captureViewAsPng(view: View, options?: CaptureOptions): Promise<string> {
  const { Platform } = await import('react-native');
  if (Platform.OS === 'web') {
    // view-shot's web adapter resizes a DPR bitmap after rendering. Render at export resolution instead.
    const { default: html2canvas } = await import('html2canvas');
    const element = view as unknown as HTMLElement;
    const bounds = element.getBoundingClientRect();
    const scale = isPixels(options?.width) && isPixels(options?.height)
      ? options!.width! / bounds.width : window.devicePixelRatio || 1;
    const canvas = await html2canvas(element, { useCORS: true, backgroundColor: null, scale });
    return canvas.toDataURL('image/png');
  }
  const { captureRef } = await import('react-native-view-shot');
  return captureRef(view, captureRefOptions(options));
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

export type ImageExportOutcome = 'shared' | 'saved' | 'cancelled' | 'unavailable';

export function webShareFailure(error: unknown): 'cancelled' | 'download' {
  if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
  if (error instanceof Error && error.name === 'NotAllowedError') return 'download';
  throw error;
}

/** Browser file sharing needs a File, while native sharing needs the captured file URI. */
export async function exportImageFile(uri: string, filename: string, title: string,
  isAlive: () => boolean = () => true): Promise<ImageExportOutcome> {
  if (!isAlive()) return 'cancelled';
  const { Platform } = await import('react-native');
  if (Platform.OS !== 'web') return await shareImageFile(uri, title, isAlive) ? 'shared' : 'unavailable';
  const response = await fetch(uri);
  const blob = await response.blob();
  if (!isAlive()) return 'cancelled';
  const file = new File([blob], `${filename}.png`, { type: 'image/png' });
  const mobileBrowser = /Android|iPhone|iPad/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  if (mobileBrowser && typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (error) {
      if (webShareFailure(error) === 'cancelled') return 'cancelled';
      // A generated image can outlive the browser's short user-activation window. Save it instead.
    }
  }
  if (!isAlive()) return 'cancelled';
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'saved';
}
