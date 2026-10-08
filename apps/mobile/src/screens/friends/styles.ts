import type { ImageStyle, TextStyle, ViewStyle } from 'react-native';
import type { AppColors } from '../../theme/palette';
import { uiMetrics } from '../../theme/ui-metrics';
import type { WorldTheme } from '../../theme/world';

export function makeFriendsStyles(palette: AppColors, world: WorldTheme) {
  return {
  // No background: the sky backdrop shows through.
  content: { gap: uiMetrics.sectionGap, padding: uiMetrics.pageInset },
  section: { gap: 5 },
  sectionTitle: { color: world.skyInk, fontSize: 22, fontWeight: '900' },
  sectionNote: { color: world.skyMuted, fontSize: 13, lineHeight: 20 },
  sectionBody: { gap: 12, marginTop: 9 },
  card: { gap: 12, padding: 18 },
  eyebrow: { color: world.cardMuted, fontSize: 12, fontWeight: '800' },
  nicknameRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  nickname: { flex: 1, minWidth: 0, color: world.cardInk, fontSize: 20, fontWeight: '900' },
  introText: { flex: 1, minWidth: 0, color: world.cardMuted, fontSize: 14, lineHeight: 21 },
  codeBlock: { alignItems: 'center', gap: 6, paddingVertical: 4 },
  code: { color: world.cardInk, fontFamily: 'monospace', fontSize: 32, fontWeight: '900', letterSpacing: 2, textAlign: 'center' },
  qrBox: { alignItems: 'center', paddingVertical: 4 },
  note: { color: world.cardMuted, fontSize: 13, lineHeight: 20 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  action: { flexGrow: 1, flexBasis: 140 },
  inputLabel: { color: world.cardInk, fontSize: 14, fontWeight: '900' },
  // The edge is world.cardMuted at 1.5dp so the field reads against the white card (WCAG 1.4.11 wants 3:1).
  input: { minHeight: 56, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, borderWidth: 1.5, borderColor: world.cardMuted, color: palette.label, backgroundColor: palette.background, fontSize: 18 },
  codeInput: { fontFamily: 'monospace', fontWeight: '800', letterSpacing: 2 },
  camera: { height: 280, borderRadius: 14, overflow: 'hidden', backgroundColor: '#000000' },
  primaryButton: { minHeight: uiMetrics.minTouch, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, borderRadius: 14, backgroundColor: palette.primary },
  primaryButtonText: { color: palette.onPrimary, fontSize: 14, fontWeight: '900', textAlign: 'center' },
  outlineButton: { minHeight: uiMetrics.minTouch, minWidth: uiMetrics.minTouch, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, borderRadius: 14, borderWidth: 1.5, borderColor: palette.primary, backgroundColor: palette.background },
  outlineButtonText: { color: palette.primary, fontSize: 14, fontWeight: '900', textAlign: 'center' },
  dangerButton: { minHeight: uiMetrics.minTouch, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, borderRadius: 14, borderWidth: 1.5, borderColor: palette.error, backgroundColor: palette.background },
  dangerButtonText: { color: palette.error, fontSize: 14, fontWeight: '900', textAlign: 'center' },
  disabled: { opacity: 0.42 },
  successMessage: { padding: 12, borderRadius: 12, color: palette.onPrimaryContainer, backgroundColor: palette.primaryContainer, fontSize: 13, lineHeight: 20 },
  errorMessage: { padding: 12, borderRadius: 12, color: palette.onErrorContainer, backgroundColor: palette.errorContainer, fontSize: 13, lineHeight: 20 },
  rankRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, minHeight: 64 },
  // Two things mark my own row besides colour: a thicker edge and the 나 chip.
  rankRowMe: { borderWidth: 2, borderColor: palette.primary },
  rankBadge: { minWidth: 36, height: 36, paddingHorizontal: 6, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.primaryContainer },
  rankBadgeText: { color: palette.onPrimaryContainer, fontSize: 15, fontWeight: '900' },
  rowCopy: { flex: 1, minWidth: 0, gap: 4 },
  rowNameLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  rowName: { flexShrink: 1, color: world.cardInk, fontSize: 16, fontWeight: '800' },
  rowMeta: { color: world.cardMuted, fontSize: 13 },
  meChip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: palette.primaryContainer },
  meChipText: { color: palette.onPrimaryContainer, fontSize: 12, fontWeight: '900' },
  chevron: { color: world.cardMuted, fontSize: 24, fontWeight: '700' },
  dots: { flexDirection: 'row', gap: 4 },
  passportHero: { gap: 6, alignItems: 'center', padding: 18 },
  passportRank: { color: world.cardInk, fontSize: 15, fontWeight: '800' },
  passportNickname: { color: world.cardInk, fontSize: 24, fontWeight: '900', textAlign: 'center' },
  medalRow: { flexDirection: 'row', gap: 10 },
  medalRowStacked: { flexDirection: 'column' },
  medalCard: { flex: 1, minWidth: 0, padding: 12 },
  medalName: { color: world.cardInk, fontSize: 14, fontWeight: '800', lineHeight: 19, textAlign: 'center' },
  medalNameStacked: { textAlign: 'left' },
  emptyPaper: { padding: 18, borderRadius: 20, borderWidth: 2, borderStyle: 'dashed', borderColor: world.paperLine, backgroundColor: world.paper },
  emptyPaperText: { color: world.paperInk, fontSize: 14, lineHeight: 22, textAlign: 'center' },
  stampSlotStatic: { alignItems: 'center', gap: 4, paddingVertical: 8, paddingHorizontal: 4 },
  } satisfies Record<string, ImageStyle | TextStyle | ViewStyle>;
}
