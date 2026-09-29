import type { ImageStyle, TextStyle, ViewStyle } from 'react-native';
import { blend, pressedFill } from '../../theme/contrast';
import type { AppColors } from '../../theme/palette';
import { uiMetrics } from '../../theme/ui-metrics';
import type { WorldTheme } from '../../theme/world';

export function makeMerchantListStyles(palette: AppColors, world: WorldTheme, hairlineWidth = 1) {
  return {
  // No background: the sky backdrop shows through the list.
  content: { flexGrow: 1 },
  header: { gap: 12, paddingHorizontal: uiMetrics.pageInset, marginBottom: 8 },
  heroRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  heroCopy: { flex: 1, minWidth: 176, gap: 10 },
  passportChip: {
    minHeight: uiMetrics.minTouch, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: world.radius.chip, backgroundColor: world.card,
    shadowColor: world.cardShadow, shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2,
  },
  passportChipDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: world.stampOrange },
  passportChipText: { flexShrink: 1, color: world.cardInk, fontSize: 14, fontWeight: '800', lineHeight: 20 },
  discoveryTools: { gap: 12 },
  searchField: {
    minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, borderRadius: 16,
    backgroundColor: world.card,
    // A card-coloured field on the page is only ~1.1:1 apart, so its edge is drawn at 3:1 or more (WCAG 1.4.11).
    borderWidth: 1.5, borderColor: world.cardMuted,
    shadowColor: world.cardShadow, shadowOpacity: 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2,
  },
  searchGlyph: { justifyContent: 'center' },
  searchInput: { flex: 1, minWidth: 0, color: world.cardInk, fontSize: 15, paddingVertical: 10 },
  clearSearch: { minHeight: uiMetrics.minTouch, justifyContent: 'center', paddingHorizontal: 4 },
  clearSearchText: { color: world.cardMuted, fontSize: 13, fontWeight: '700' },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filterChip: { minHeight: uiMetrics.minTouch, justifyContent: 'center', paddingHorizontal: 16, borderRadius: world.radius.chip, borderWidth: 1 },
  // Selected and idle chips, each with a pressed fill: the press shows as a background change, so the label stays fully opaque.
  filterChipOn: { backgroundColor: palette.primary, borderColor: palette.primary },
  filterChipOnPressed: { backgroundColor: pressedFill(palette.primary, palette.onPrimary) },
  filterChipIdle: { backgroundColor: world.card, borderColor: world.cardMuted },
  filterChipIdlePressed: { backgroundColor: blend(world.cardInk, world.card, 0.08) },
  filterText: { fontSize: 13, fontWeight: '800' },
  filterTextOn: { color: palette.onPrimary },
  filterTextIdle: { color: world.cardInk },
  title: { color: palette.label, fontSize: 25, fontWeight: '800', lineHeight: 33, letterSpacing: -0.5 },
  intro: { color: palette.secondaryLabel, fontSize: 14, lineHeight: 20 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  sectionEyebrow: { color: world.skyInk, fontSize: 18, fontWeight: '800' },
  sectionCount: { color: world.skyMuted, fontSize: 13, fontWeight: '700' },
  recommendationAction: {
    minHeight: uiMetrics.minTouch, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14,
    borderRadius: world.radius.chip, backgroundColor: world.card,
  },
  recommendationActionText: { color: palette.primary, fontSize: 13, fontWeight: '800' },
  notice: { padding: 12, borderRadius: 16, backgroundColor: world.card },
  noticeText: { color: world.cardMuted, fontSize: 12, lineHeight: 19 },
  inlineError: { padding: 12, borderRadius: 12, backgroundColor: palette.errorContainer },
  inlineErrorText: { color: palette.onErrorContainer, fontSize: 13, lineHeight: 19 },
  separator: { height: 14 },
  itemWrap: { paddingHorizontal: uiMetrics.pageInset },
  card: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, backgroundColor: world.card },
  crest: {
    width: 64, height: 64, borderRadius: 32, borderWidth: 3, borderColor: world.stampOrange,
    backgroundColor: world.paper, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  crestLetter: { color: world.stampInk, fontSize: 26, fontWeight: '900' },
  crestArt: { width: 58, height: 58 } as ImageStyle,
  cardBody: { flex: 1, minWidth: 0, gap: 6 },
  cardTopline: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7 },
  statusBadge: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, backgroundColor: palette.successContainer },
  statusBadgeText: { color: palette.onSuccessContainer, fontSize: 11, fontWeight: '800' },
  demoBadge: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 999, backgroundColor: palette.primaryContainer },
  demoBadgeText: { color: palette.onPrimaryContainer, fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },
  cardTitle: { color: world.cardInk, fontSize: 18, fontWeight: '800', lineHeight: 25 },
  cardStory: { color: world.cardMuted, fontSize: 14, lineHeight: 21 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardAddress: { flex: 1, color: world.cardInk, fontSize: 13, fontWeight: '600' },
  cardArrow: { color: palette.primary, fontSize: 20, fontWeight: '800' },
  campaignName: { color: world.cardMuted, fontSize: 12 },
  emptyEyebrow: { color: world.cardMuted, fontSize: 12, fontWeight: '900', letterSpacing: 0.3, textAlign: 'center' },
  journey: { alignSelf: 'stretch', gap: 7, paddingTop: 14, borderTopWidth: hairlineWidth, borderTopColor: palette.separator },
  journeyLabel: { color: world.cardInk, fontSize: 12, fontWeight: '900' },
  journeyText: { color: world.cardMuted, fontSize: 13, lineHeight: 21, fontWeight: '700' },
  configurationContent: { flex: 1, justifyContent: 'center', gap: 18, padding: 24, backgroundColor: palette.background },
  configurationCard: { gap: 8, padding: 18, borderRadius: 18, backgroundColor: palette.surface },
  configurationCode: { color: palette.primary, fontFamily: 'monospace', fontSize: 14, fontWeight: '700' },
  configurationHelp: { color: palette.secondaryLabel, fontSize: 13, lineHeight: 20 },
  } satisfies Record<string, ImageStyle | TextStyle | ViewStyle>;
}
