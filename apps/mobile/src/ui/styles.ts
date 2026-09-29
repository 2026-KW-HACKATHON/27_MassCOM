import type { ImageStyle, TextStyle, ViewStyle } from 'react-native';

import { blend, pressedFill, withAlpha } from '../theme/contrast';
import type { AppColors } from '../theme/palette';
import { uiMetrics } from '../theme/ui-metrics';
import type { WorldTheme } from '../theme/world';

export function makeUiStyles(palette: AppColors, world: WorldTheme) {
  return {
    card: {
      backgroundColor: world.card, borderRadius: world.radius.card, padding: 18,
      // A 1px top highlight: in dark the card is ~1.05:1 against the page, so its edge is drawn (transparent in light).
      borderTopWidth: 1, borderTopColor: withAlpha(world.cardEdge, world.cardEdgeAlpha),
      shadowColor: world.cardShadow, shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 3,
    },
    // Press feedback that does not depend on motion: the fill shifts, the text stays fully opaque.
    cardPressed: { backgroundColor: blend(world.cardInk, world.card, 0.08) },
    cardTitle: { color: world.cardInk, fontSize: 17, fontWeight: '800', lineHeight: 24 },
    cardBody: { color: world.cardMuted, fontSize: 15, lineHeight: 22 },
    primaryButton: {
      backgroundColor: palette.primary, borderRadius: 16, minHeight: uiMetrics.minTouch,
      paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center',
    },
    primaryButtonPressed: { backgroundColor: pressedFill(palette.primary, palette.onPrimary) },
    primaryButtonText: { color: palette.onPrimary, fontSize: 16, fontWeight: '800' },
    secondaryButton: {
      backgroundColor: palette.primaryContainer, borderRadius: 16, minHeight: uiMetrics.minTouch,
      paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center',
    },
    secondaryButtonPressed: { backgroundColor: blend(palette.primary, palette.primaryContainer, 0.2) },
    secondaryButtonText: { color: palette.onPrimaryContainer, fontSize: 16, fontWeight: '800' },
    headerPanel: {
      borderRadius: 20, paddingVertical: 12, paddingHorizontal: 16, gap: 4,
      backgroundColor: withAlpha(world.headerScrim, world.headerScrimAlpha),
    },
    headerTitle: { color: world.skyInk, fontSize: 28, fontWeight: '800', lineHeight: 36 },
    headerSubtitle: { color: world.skyMuted, fontSize: 15, lineHeight: 22 },
    avatarButton: {
      minWidth: uiMetrics.minTouch, minHeight: uiMetrics.minTouch, borderRadius: 24, gap: 2,
      alignItems: 'center', justifyContent: 'center',
    },
    avatarLabelPill: {
      paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999,
      backgroundColor: withAlpha(world.headerScrim, world.headerScrimAlpha),
    },
    avatarLabel: { color: world.skyInk, fontSize: 12, fontWeight: '800', lineHeight: 16 },
    backButton: {
      minWidth: uiMetrics.minTouch, minHeight: uiMetrics.minTouch, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
      backgroundColor: world.card,
      shadowColor: world.cardShadow, shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2,
    },
    backGlyph: { color: world.cardInk, fontSize: 28, fontWeight: '700', lineHeight: 32 },
    backTitle: { color: world.skyInk, fontSize: 22, fontWeight: '800', lineHeight: 30 },
    // Loading, error and empty scenes sit on the card surface (StateScene draws it), so these pairs are checked on world.card.
    sceneContent: { alignItems: 'center', gap: 10, paddingVertical: 8 },
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
    stampArt: { width: 52, height: 52, borderRadius: 26 },
    stampMark: { color: world.stampInk, fontSize: 16, fontWeight: '900', textAlign: 'center' },
    stampMystery: { color: world.paperInk, fontSize: 24, fontWeight: '900' },
    stampName: { color: world.paperInk, fontSize: 13, fontWeight: '800', lineHeight: 18, textAlign: 'center' },
    stampStatus: { color: world.paperInk, fontSize: 11, lineHeight: 16, textAlign: 'center' },
  } satisfies Record<string, ImageStyle | TextStyle | ViewStyle>;
}
