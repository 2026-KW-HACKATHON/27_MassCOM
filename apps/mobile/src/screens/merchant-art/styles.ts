import type { ImageStyle, TextStyle, ViewStyle } from 'react-native';

import { blend } from '../../theme/contrast';
import type { AppColors } from '../../theme/palette';
import { uiMetrics } from '../../theme/ui-metrics';
import type { WorldTheme } from '../../theme/world';
import { CURRENT_ART_SIZE, TILE_GAP } from './layout';

export const TILE_BORDER = 4;

export function makeMerchantArtStyles(palette: AppColors, world: WorldTheme) {
  return {
    // No background: the sky page shows through between the cards.
    content: { gap: 16, paddingHorizontal: uiMetrics.pageInset },
    cardStack: { gap: 12 },
    cardTitle: { color: world.cardInk, fontSize: 18, fontWeight: '900', lineHeight: 26 },
    cardBody: { color: world.cardMuted, fontSize: 14, lineHeight: 21 },
    quota: { color: world.cardInk, fontSize: 14, fontWeight: '800', lineHeight: 21 },
    disclosure: { color: world.cardMuted, fontSize: 13, lineHeight: 19 },
    hint: { color: world.cardMuted, fontSize: 13, lineHeight: 19 },
    currentRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    currentFrame: { width: CURRENT_ART_SIZE, height: CURRENT_ART_SIZE, borderRadius: 20, overflow: 'hidden', backgroundColor: world.paper },
    currentArt: { width: CURRENT_ART_SIZE, height: CURRENT_ART_SIZE },
    // The default stamp (no picture) is written out on cream paper, like the passport page it stands for.
    currentPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 10 },
    currentPlaceholderText: { color: world.paperInk, fontSize: 14, fontWeight: '800', lineHeight: 20, textAlign: 'center' },
    currentCopy: { flex: 1, gap: 6 },
    notice: { minHeight: uiMetrics.minTouch, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, backgroundColor: palette.errorContainer },
    noticeText: { color: palette.onErrorContainer, fontSize: 14, lineHeight: 21, fontWeight: '700' },
    failure: { padding: 12, borderRadius: 12, backgroundColor: palette.errorContainer },
    failureText: { color: palette.onErrorContainer, fontSize: 14, lineHeight: 21, fontWeight: '700' },
    generating: { alignItems: 'center', gap: 10, paddingVertical: 8 },
    generatingTitle: { color: world.cardInk, fontSize: 18, fontWeight: '900', lineHeight: 26, textAlign: 'center' },
    generatingBody: { color: world.cardMuted, fontSize: 15, lineHeight: 22, textAlign: 'center' },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: TILE_GAP },
    // The border is always as thick as a chosen one's, so picking a draft never shifts its picture; only its colour changes.
    tile: { borderWidth: TILE_BORDER, borderColor: world.card, borderRadius: 22, overflow: 'hidden', backgroundColor: world.card },
    tileSelected: { borderColor: palette.primary },
    tileImage: { width: '100%', aspectRatio: 1, borderRadius: 14 } satisfies ImageStyle,
    tileLabelRow: { minHeight: uiMetrics.minTouch, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, paddingVertical: 6 },
    tileLabel: { color: world.cardInk, fontSize: 15, fontWeight: '800', lineHeight: 21, textAlign: 'center' },
    tileLabelSelected: { color: palette.primary },
    check: { position: 'absolute', top: 8, right: 8, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.primary },
    finalArt: { width: '100%', aspectRatio: 1, borderRadius: 20, backgroundColor: world.paper },
    entryCard: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: uiMetrics.minTouch, padding: 16, borderRadius: 20, backgroundColor: palette.surface },
    entryCardPressed: { backgroundColor: blend(palette.label, palette.surface, 0.08) },
    entryThumb: { width: 72, height: 72, borderRadius: 16, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: palette.primaryContainer },
    entryThumbImage: { width: 72, height: 72 },
    entryThumbGlyph: { color: palette.onPrimaryContainer, fontSize: 24, fontWeight: '900' },
    entryCopy: { flex: 1, gap: 4 },
    entryTitle: { color: palette.label, fontSize: 17, fontWeight: '900', lineHeight: 24 },
    entryBody: { color: palette.secondaryLabel, fontSize: 13, lineHeight: 19 },
    entryChevron: { color: palette.primary, fontSize: 24, fontWeight: '700' },
  } satisfies Record<string, ImageStyle | TextStyle | ViewStyle>;
}
