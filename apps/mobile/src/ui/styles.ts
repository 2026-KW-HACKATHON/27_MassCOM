import type { ImageStyle, TextStyle, ViewStyle } from 'react-native';

import type { AppColors } from '../theme/palette';
import { uiMetrics } from '../theme/ui-metrics';
import type { WorldTheme } from '../theme/world';

export function makeUiStyles(palette: AppColors, world: WorldTheme) {
  return {
    card: {
      backgroundColor: world.card, borderRadius: world.radius.card, padding: 18,
      shadowColor: world.cardShadow, shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 3,
    },
    cardTitle: { color: world.cardInk, fontSize: 17, fontWeight: '800', lineHeight: 24 },
    cardBody: { color: world.cardMuted, fontSize: 15, lineHeight: 22 },
    primaryButton: {
      backgroundColor: palette.primary, borderRadius: 16, minHeight: uiMetrics.minTouch,
      paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center',
    },
    primaryButtonText: { color: palette.onPrimary, fontSize: 16, fontWeight: '800' },
    secondaryButton: {
      backgroundColor: palette.primaryContainer, borderRadius: 16, minHeight: uiMetrics.minTouch,
      paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center',
    },
    secondaryButtonText: { color: palette.onPrimaryContainer, fontSize: 16, fontWeight: '800' },
    headerTitle: { color: world.skyInk, fontSize: 28, fontWeight: '800', lineHeight: 36 },
    headerSubtitle: { color: world.skyMuted, fontSize: 15, lineHeight: 22 },
    avatarButton: {
      minWidth: uiMetrics.minTouch, minHeight: uiMetrics.minTouch, borderRadius: 999,
      alignItems: 'center', justifyContent: 'center',
    },
    sceneTitle: { color: world.cardInk, fontSize: 18, fontWeight: '800', textAlign: 'center' },
    sceneBody: { color: world.cardMuted, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  } satisfies Record<string, ImageStyle | TextStyle | ViewStyle>;
}
