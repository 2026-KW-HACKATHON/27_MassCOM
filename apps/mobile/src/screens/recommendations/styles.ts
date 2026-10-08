import type { ImageStyle, TextStyle, ViewStyle } from 'react-native';
import { type AppColors } from '../../theme/palette';

export function makeRecommendationsStyles(palette: AppColors, hairlineWidth = 1) {
  return {

  // No page background on `content`/`centered`: the sky page (SkyBackdrop) shows through.
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 28 },
  centeredTitle: { color: palette.label, fontSize: 21, fontWeight: '900', textAlign: 'center' },
  centeredBody: { color: palette.secondaryLabel, fontSize: 14, lineHeight: 22, textAlign: 'center' },
  retryButton: { paddingHorizontal: 18, paddingVertical: 12, borderRadius: 14, backgroundColor: palette.primary },
  retryButtonText: { color: palette.onPrimary, fontSize: 14, fontWeight: '900' },
  content: { gap: 16, padding: 20, paddingBottom: 48 },
  hero: { gap: 8, paddingBottom: 4 },
  eyebrow: { color: palette.primary, fontSize: 13, fontWeight: '900' },
  title: { color: palette.label, fontSize: 25, fontWeight: '900', lineHeight: 33, letterSpacing: -0.5 },
  body: { color: palette.secondaryLabel, fontSize: 15, lineHeight: 24 },
  courseListLink: { alignSelf: 'flex-start', paddingVertical: 8 },
  courseListLinkText: { color: palette.primary, fontSize: 14, fontWeight: '900' },
  rotationNote: { color: palette.secondaryLabel, fontSize: 12, lineHeight: 18 },
  inlineError: { padding: 12, borderRadius: 12, color: palette.onErrorContainer, backgroundColor: palette.errorContainer, fontSize: 13 },
  emptyCard: { gap: 8 },
  emptyTitle: { color: palette.label, fontSize: 18, fontWeight: '900' },
  emptyBody: { color: palette.secondaryLabel, fontSize: 14, lineHeight: 22 },
  card: { gap: 11 },
  cardTopline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  reasonCode: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, color: palette.onSuccessContainer, backgroundColor: palette.successContainer, fontSize: 12, fontWeight: '900' },
  demo: { color: palette.onPrimaryContainer, fontSize: 12, fontWeight: '900' },
  cardNameRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardTitle: { color: palette.label, fontSize: 24, fontWeight: '900' },
  reason: { color: palette.label, fontSize: 16, lineHeight: 24, fontWeight: '700' },
  courseChip: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: palette.primaryContainer },
  courseChipText: { color: palette.onPrimaryContainer, fontSize: 13, fontWeight: '900' },
  meta: { color: palette.secondaryLabel, fontSize: 12 },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingTop: 10, borderTopWidth: hairlineWidth, borderTopColor: palette.separator },
  progress: { color: palette.secondaryLabel, fontSize: 12, fontWeight: '700' },
  goal: { flex: 1, color: palette.label, fontSize: 12, fontWeight: '800', textAlign: 'right' },
  openDetail: { color: palette.primary, fontSize: 13, fontWeight: '900', textAlign: 'right' },
} satisfies Record<string, ImageStyle | TextStyle | ViewStyle>;
}
