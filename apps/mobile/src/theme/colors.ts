import { Color } from 'expo-router';
import { Platform } from 'react-native';

import { lightColors } from './palette';

export { colorsForScheme, darkColors, lightColors, type AppColors } from './palette';

// Native semantic colors remain opaque so existing StyleSheets adapt without per-screen platform
// branches. Explicit palettes provide measurable contrast and navigation/web fallbacks.
export const colors = {
  label: Platform.select({ ios: Color.ios.label, android: Color.android.dynamic.onSurface, default: lightColors.label })!,
  secondaryLabel: Platform.select({ ios: Color.ios.secondaryLabel, android: Color.android.dynamic.onSurfaceVariant, default: lightColors.secondaryLabel })!,
  separator: Platform.select({ ios: Color.ios.separator, android: Color.android.dynamic.outlineVariant, default: lightColors.separator })!,
  background: Platform.select({ ios: Color.ios.systemBackground, android: Color.android.dynamic.surface, default: lightColors.background })!,
  surface: Platform.select({ ios: Color.ios.secondarySystemBackground, android: Color.android.dynamic.surfaceContainer, default: lightColors.surface })!,
  primary: Platform.select({ ios: Color.ios.systemBlue, android: Color.android.dynamic.primary, default: lightColors.primary })!,
  onPrimary: Platform.select({ ios: lightColors.onPrimary, android: Color.android.dynamic.onPrimary, default: lightColors.onPrimary })!,
  primaryContainer: Platform.select({ ios: Color.ios.systemBlue5, android: Color.android.dynamic.primaryContainer, default: lightColors.primaryContainer })!,
  onPrimaryContainer: Platform.select({ ios: lightColors.onPrimaryContainer, android: Color.android.dynamic.onPrimaryContainer, default: lightColors.onPrimaryContainer })!,
  success: Platform.select({ ios: Color.ios.systemGreen, android: Color.android.material.green600, default: lightColors.success })!,
  successContainer: Platform.select({ ios: Color.ios.systemGreen5, android: Color.android.dynamic.secondaryContainer, default: lightColors.successContainer })!,
  onSuccessContainer: Platform.select({ ios: lightColors.onSuccessContainer, android: Color.android.dynamic.onSecondaryContainer, default: lightColors.onSuccessContainer })!,
  error: Platform.select({ ios: Color.ios.systemRed, android: Color.android.material.red700, default: lightColors.error })!,
  errorContainer: Platform.select({ ios: Color.ios.systemRed5, android: Color.android.dynamic.errorContainer, default: lightColors.errorContainer })!,
  onErrorContainer: Platform.select({ ios: lightColors.onErrorContainer, android: Color.android.dynamic.onErrorContainer, default: lightColors.onErrorContainer })!,
};
