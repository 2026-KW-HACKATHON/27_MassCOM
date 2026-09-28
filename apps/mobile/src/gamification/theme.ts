import { StyleSheet, useColorScheme } from 'react-native';

import { darkMedalColors, lightMedalColors, type MedalColors } from '@/theme/medal-colors';
import { darkColors, lightColors, type AppColors } from '@/theme/palette';

import { makeGamificationStyles, type GamificationStyles } from './styles';

export type GamificationTheme = {
  scheme: 'light' | 'dark';
  palette: AppColors;
  medal: MedalColors;
  styles: GamificationStyles;
};

// StyleSheet.create runs once per scheme, not on every render of every medal/box/ticket.
const themes = new Map<'light' | 'dark', GamificationTheme>();

export function gamificationTheme(scheme: 'light' | 'dark'): GamificationTheme {
  let theme = themes.get(scheme);
  if (!theme) {
    const palette = scheme === 'dark' ? darkColors : lightColors;
    const medal = scheme === 'dark' ? darkMedalColors : lightMedalColors;
    theme = { scheme, palette, medal, styles: StyleSheet.create(makeGamificationStyles(palette, medal)) };
    themes.set(scheme, theme);
  }
  return theme;
}

export function useGamificationTheme(): GamificationTheme {
  return gamificationTheme(useColorScheme() === 'dark' ? 'dark' : 'light');
}
