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
    backButton: {
      minWidth: uiMetrics.minTouch, minHeight: uiMetrics.minTouch, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
      backgroundColor: world.card,
      shadowColor: world.cardShadow, shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2,
    },
    backGlyph: { color: world.cardInk, fontSize: 28, fontWeight: '700', lineHeight: 32 },
    backTitle: { color: world.skyInk, fontSize: 22, fontWeight: '800', lineHeight: 30 },
    sceneTitle: { color: world.cardInk, fontSize: 18, fontWeight: '800', textAlign: 'center' },
    sceneBody: { color: world.cardMuted, fontSize: 15, lineHeight: 22, textAlign: 'center' },
    // Passport stamp page: a cream paper card with a dashed edge; every slot is a round ink stamp.
    stampPage: {
      flexDirection: 'row', flexWrap: 'wrap', gap: 10, padding: 14, borderRadius: 20,
      backgroundColor: world.paper, borderWidth: 2, borderStyle: 'dashed', borderColor: world.paperLine,
    },
    stampSlot: { minHeight: uiMetrics.minTouch, alignItems: 'center', gap: 4, paddingVertical: 8, paddingHorizontal: 4 },
    stampRing: { width: 72, height: 72, borderRadius: 36, borderWidth: 3, borderColor: world.stampInk, alignItems: 'center', justifyContent: 'center' },
    stampRingInner: { width: 58, height: 58, borderRadius: 29, borderWidth: 1, borderColor: world.stampInk, alignItems: 'center', justifyContent: 'center' },
    stampRingEmpty: { width: 72, height: 72, borderRadius: 36, borderWidth: 2, borderStyle: 'dashed', borderColor: world.paperLine, alignItems: 'center', justifyContent: 'center' },
    stampMark: { color: world.stampInk, fontSize: 16, fontWeight: '900', textAlign: 'center' },
    stampMystery: { color: world.paperInk, fontSize: 24, fontWeight: '900' },
    stampName: { color: world.paperInk, fontSize: 13, fontWeight: '800', lineHeight: 18, textAlign: 'center' },
    stampStatus: { color: world.paperInk, fontSize: 11, lineHeight: 16, textAlign: 'center' },
  } satisfies Record<string, ImageStyle | TextStyle | ViewStyle>;
}
