import { darkColors, lightColors } from './palette';

// Presentation names map to the same semantic palette as the feature UI.
export const foundationColors = {
  light: {
    background: lightColors.background, ink: lightColors.label,
    muted: lightColors.secondaryLabel, line: lightColors.separator,
    soft: lightColors.surface, accent: lightColors.primary,
    tint: lightColors.primaryContainer, onAccent: lightColors.onPrimary,
  },
  dark: {
    background: darkColors.background, ink: darkColors.label,
    muted: darkColors.secondaryLabel, line: darkColors.separator,
    soft: darkColors.surface, accent: darkColors.primary,
    tint: darkColors.primaryContainer, onAccent: darkColors.onPrimary,
  },
};
