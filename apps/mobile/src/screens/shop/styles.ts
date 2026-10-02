import type { ImageStyle, TextStyle, ViewStyle } from 'react-native';

import type { AppColors } from '../../theme/palette';
import { uiMetrics } from '../../theme/ui-metrics';
import type { WorldTheme } from '../../theme/world';

export function makeShopStyles(palette: AppColors, world: WorldTheme) {
  return {
    content: { gap: uiMetrics.sectionGap, padding: uiMetrics.pageInset },
    hero: { flexDirection: 'row', justifyContent: 'flex-end' },
    section: { gap: 5 },
    sectionTitle: { color: world.skyInk, fontSize: 22, fontWeight: '900' },
    card: { gap: 12, padding: 18 },
    mileageRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    coin: { width: 40, height: 40 },
    balance: { flex: 1, color: world.cardInk, fontSize: 26, fontWeight: '900' },
    rulesText: { color: world.cardMuted, fontSize: 13, lineHeight: 20 },
    gradeHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    ticket: { width: 48, height: 48 },
    gradeCopy: { flex: 1, minWidth: 0, gap: 2 },
    gradeName: { color: world.cardInk, fontSize: 16, fontWeight: '800' },
    gradePrice: { color: world.cardMuted, fontSize: 13 },
    disclosure: { color: world.cardMuted, fontSize: 13, lineHeight: 19 },
    disabledReason: { color: palette.error, fontSize: 12, fontWeight: '700' },
    primaryButton: { minHeight: uiMetrics.minTouch, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, borderRadius: 14, backgroundColor: palette.primary },
    primaryButtonText: { color: palette.onPrimary, fontSize: 14, fontWeight: '900', textAlign: 'center' },
    disabled: { opacity: 0.42 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'flex-start' },
    cell: { width: 88, alignItems: 'center', gap: 6, minHeight: uiMetrics.minTouch, paddingVertical: 6 },
    cellRing: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: world.card },
    cellRingAvatar: { borderWidth: 3, borderColor: palette.primary },
    cellArt: { width: 48, height: 48 },
    cellSilhouette: { color: world.cardMuted, fontSize: 24, fontWeight: '900' },
    cellName: { color: world.cardInk, fontSize: 12, fontWeight: '700', textAlign: 'center' },
    cellNameUnowned: { color: world.cardMuted },
    avatarChip: { marginTop: -2, paddingHorizontal: 8, paddingVertical: 1, borderRadius: 999, backgroundColor: palette.primaryContainer },
    avatarChipText: { color: palette.onPrimaryContainer, fontSize: 10, fontWeight: '900' },
    successMessage: { padding: 12, borderRadius: 12, color: palette.onPrimaryContainer, backgroundColor: palette.primaryContainer, fontSize: 13, lineHeight: 20 },
    errorMessage: { padding: 12, borderRadius: 12, color: palette.onErrorContainer, backgroundColor: palette.errorContainer, fontSize: 13, lineHeight: 20 },
    historyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
    historyCopy: { flex: 1, minWidth: 0 },
    historyName: { color: world.cardInk, fontSize: 14, fontWeight: '800' },
    historyMeta: { color: world.cardMuted, fontSize: 12 },
    historyAmount: { color: palette.error, fontSize: 14, fontWeight: '800' },
    historyEmpty: { color: world.cardMuted, fontSize: 13, textAlign: 'center', paddingVertical: 12 },
    loadMore: { minHeight: uiMetrics.minTouch, alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
    loadMoreText: { color: palette.primary, fontSize: 13, fontWeight: '800' },
  } satisfies Record<string, ImageStyle | TextStyle | ViewStyle>;
}
