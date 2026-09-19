import { Color } from 'expo-router';
import { Platform } from 'react-native';

export const colors = {
  label: Platform.select({
    ios: Color.ios.label,
    android: Color.android.dynamic.onSurface,
    default: '#102833',
  })!,
  secondaryLabel: Platform.select({
    ios: Color.ios.secondaryLabel,
    android: Color.android.dynamic.onSurfaceVariant,
    default: '#526A73',
  })!,
  separator: Platform.select({
    ios: Color.ios.separator,
    android: Color.android.dynamic.outlineVariant,
    default: '#C9D9DE',
  })!,
  background: Platform.select({
    ios: Color.ios.systemBackground,
    android: Color.android.dynamic.surface,
    default: '#F4F9FA',
  })!,
  surface: Platform.select({
    ios: Color.ios.secondarySystemBackground,
    android: Color.android.dynamic.surfaceContainer,
    default: '#FFFFFF',
  })!,
  primary: Platform.select({
    ios: Color.ios.systemBlue,
    android: Color.android.dynamic.primary,
    default: '#286585',
  })!,
  onPrimary: Platform.select({
    ios: '#FFFFFF',
    android: Color.android.dynamic.onPrimary,
    default: '#FFFFFF',
  })!,
  primaryContainer: Platform.select({
    ios: Color.ios.systemBlue5,
    android: Color.android.dynamic.primaryContainer,
    default: '#D9EDF5',
  })!,
  onPrimaryContainer: Platform.select({
    ios: '#163B4D',
    android: Color.android.dynamic.onPrimaryContainer,
    default: '#163B4D',
  })!,
  success: Platform.select({
    ios: Color.ios.systemGreen,
    android: Color.android.material.green600,
    default: '#2D6A4F',
  })!,
  successContainer: Platform.select({
    ios: Color.ios.systemGreen5,
    android: Color.android.dynamic.secondaryContainer,
    default: '#DDEFE5',
  })!,
  onSuccessContainer: Platform.select({
    ios: '#174D35',
    android: Color.android.dynamic.onSecondaryContainer,
    default: '#174D35',
  })!,
  error: Platform.select({
    ios: Color.ios.systemRed,
    android: Color.android.material.red700,
    default: '#9A371D',
  })!,
  errorContainer: Platform.select({
    ios: Color.ios.systemRed5,
    android: Color.android.dynamic.errorContainer,
    default: '#FCE4DA',
  })!,
  onErrorContainer: Platform.select({
    ios: '#7B2718',
    android: Color.android.dynamic.onErrorContainer,
    default: '#7B2718',
  })!,
};
