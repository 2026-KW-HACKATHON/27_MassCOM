import type { ImageStyle, TextStyle, ViewStyle } from 'react-native';

import { blend } from '../../theme/contrast';
import type { AppColors } from '../../theme/palette';
import { uiMetrics } from '../../theme/ui-metrics';
import type { WorldTheme } from '../../theme/world';
import { PIN_SIZE, PIN_TOUCH } from './layout';

export function makeTownMapStyles(palette: AppColors, world: WorldTheme) {
  return {
    content: { paddingHorizontal: uiMetrics.pageInset, gap: 16 },
    // Said in the header normally; at 150% text the header drops its subtitle, so the same sentence sits above the map instead.
    disclosure: { color: world.skyMuted, fontSize: 14, lineHeight: 20 },
    mapFrame: {
      borderRadius: world.radius.card, overflow: 'hidden', backgroundColor: world.card,
      shadowColor: world.cardShadow, shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 3,
    },
    // The 48dp target; `left`/`top` are set per pin from its anchor.
    pinTouch: { position: 'absolute', width: PIN_TOUCH, height: PIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
    // Behind a selected pin: a primary ring on a card-coloured disc, so the selection reads over any art colour.
    pinHalo: {
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: PIN_TOUCH / 2,
      borderWidth: 2, borderColor: palette.primary, backgroundColor: world.card,
    },
    pinDisc: {
      width: PIN_SIZE, height: PIN_SIZE, borderRadius: PIN_SIZE / 2, backgroundColor: world.paper,
      alignItems: 'center', justifyContent: 'center',
      shadowColor: world.cardShadow, shadowOpacity: 0.3, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 4,
    },
    // Visited: a solid double ring like the passport stamp. Not yet: one dashed ring. The shape carries the meaning, not the colour.
    pinDiscVisited: { borderWidth: 3, borderColor: world.stampInk },
    pinDiscNone: { borderWidth: 2, borderStyle: 'dashed', borderColor: world.paperLine },
    // Press feedback that does not depend on motion: the fill shifts and the glyph keeps its contrast.
    pinDiscPressed: { backgroundColor: blend(world.paperInk, world.paper, 0.08) },
    pinInnerRing: {
      width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: world.stampInk,
      alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    },
    pinArt: { width: 30, height: 30, borderRadius: 15 } as ImageStyle,
    // A shop's illustration on a pin whose stamp is not collected yet is paler, and the ring is dashed.
    pinArtNone: { width: 34, height: 34, borderRadius: 17, opacity: 0.6 } as ImageStyle,
    pinGlyphVisited: { color: world.stampInk, fontSize: 13, fontWeight: '900', textAlign: 'center' },
    pinGlyphNone: { color: world.paperInk, fontSize: 13, fontWeight: '800', textAlign: 'center' },
    pinCheck: {
      position: 'absolute', top: 0, right: 0, width: 18, height: 18, borderRadius: 9,
      backgroundColor: world.stampInk, borderWidth: 1.5, borderColor: world.paper, alignItems: 'center', justifyContent: 'center',
    },
    // Under the picture, on the frame's card colour: what the two ring shapes mean, in words as well.
    legend: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 16, paddingHorizontal: 14, paddingVertical: 10 },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    legendVisited: {
      width: 22, height: 22, borderRadius: 11, backgroundColor: world.paper, borderWidth: 2, borderColor: world.stampInk,
      alignItems: 'center', justifyContent: 'center',
    },
    legendNone: { width: 22, height: 22, borderRadius: 11, backgroundColor: world.paper, borderWidth: 1.5, borderStyle: 'dashed', borderColor: world.paperLine },
    legendText: { color: world.cardMuted, fontSize: 13, lineHeight: 18 },
    // The bottom sheet: a floating card above the tab bar.
    sheetWrap: { position: 'absolute', left: uiMetrics.pageInset, right: uiMetrics.pageInset },
    sheetTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    sheetName: { flex: 1, minWidth: 0, color: world.cardInk, fontSize: 18, fontWeight: '800', lineHeight: 26 },
    closeButton: { minWidth: uiMetrics.minTouch, minHeight: uiMetrics.minTouch, alignItems: 'center', justifyContent: 'center', marginTop: -8, marginRight: -8 },
    closeText: { color: world.cardMuted, fontSize: 14, fontWeight: '800' },
    sheetAddress: { color: world.cardMuted, fontSize: 15, lineHeight: 22 },
    sheetStatus: { color: world.cardInk, fontSize: 15, fontWeight: '800', lineHeight: 22 },
    sheetGoal: { color: world.cardMuted, fontSize: 14, lineHeight: 20 },
    sheetNotice: { color: world.cardMuted, fontSize: 14, lineHeight: 20 },
    sheetBody: { gap: 8 },
    sheetActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
    sheetAction: { flex: 1 },
    // Shops that did not fit on the picture.
    overflowList: { gap: 4 },
    overflowRow: {
      minHeight: uiMetrics.minTouch, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 8,
    },
    overflowName: { flex: 1, minWidth: 0, color: world.cardInk, fontSize: 16, fontWeight: '800', lineHeight: 22 },
    overflowState: { color: world.cardMuted, fontSize: 14, lineHeight: 20 },
    banner: { color: world.skyMuted, fontSize: 14, lineHeight: 20 },
    retry: { minHeight: uiMetrics.minTouch, justifyContent: 'center', alignItems: 'center' },
    retryText: { color: world.skyInk, fontSize: 15, fontWeight: '800', lineHeight: 22, textAlign: 'center', textDecorationLine: 'underline' },
  } satisfies Record<string, ImageStyle | TextStyle | ViewStyle>;
}
