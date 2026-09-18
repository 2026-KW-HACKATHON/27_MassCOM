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
  success: Platform.select({
    ios: Color.ios.systemGreen,
    android: Color.android.material.green600,
    default: '#2D6A4F',
  })!,
  error: Platform.select({
    ios: Color.ios.systemRed,
    android: Color.android.material.red700,
    default: '#9A371D',
  })!,
};
