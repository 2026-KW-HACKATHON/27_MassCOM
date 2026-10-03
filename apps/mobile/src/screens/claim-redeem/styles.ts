import type { ImageStyle, TextStyle, ViewStyle } from 'react-native';
import type { AppColors } from '../../theme/palette';
import { uiMetrics } from '../../theme/ui-metrics';
import type { WorldTheme } from '../../theme/world';

export function makeClaimRedeemStyles(palette: AppColors, world: WorldTheme, hairlineWidth = 1) {
  return {
  // No background: the sky backdrop shows through.
  content: { gap: 14, paddingHorizontal: uiMetrics.pageInset, paddingTop: 4 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heroBubble: { flex: 1, padding: 14, borderRadius: world.radius.card, backgroundColor: world.card },
  heroBubbleText: { color: world.cardInk, fontSize: 14, lineHeight: 21 },
  // A dashed paper-line edge makes the panel read as a stamp card.
  formCard: {
    gap: 10, padding: 16, borderRadius: world.radius.card, backgroundColor: world.card,
    borderWidth: 2, borderStyle: 'dashed', borderColor: world.paperLine,
  },
  sectionTitle: { color: world.cardInk, fontSize: 17, fontWeight: '800' },
  securityNote: { color: world.cardMuted, fontSize: 12, lineHeight: 18 },
  inputLabel: { color: world.cardInk, fontSize: 14, fontWeight: '900' },
  camera: { height: 280, borderRadius: 14, overflow: 'hidden', backgroundColor: '#000000' },
  scanButton: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.primary },
  scanButtonText: { color: palette.primary },
  // The edge is world.cardMuted at 1.5dp: the old 1px separator was 1.29:1 against the white card (WCAG 1.4.11 wants 3:1).
  input: { minHeight: 72, padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: world.cardMuted, color: palette.label, backgroundColor: palette.background, fontFamily: 'monospace', fontSize: 13, textAlignVertical: 'top' },
  button: { minHeight: uiMetrics.minTouch, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, borderRadius: 14, backgroundColor: palette.primary },
  buttonText: { color: palette.onPrimary, fontSize: 14, fontWeight: '900' },
  disabled: { opacity: 0.42 },
  message: { padding: 13, borderRadius: 14, color: palette.onPrimaryContainer, backgroundColor: palette.primaryContainer, fontSize: 13, lineHeight: 20 },
  previewCard: { gap: 10, padding: 18, borderRadius: world.radius.card, backgroundColor: world.card },
  statusRow: { flexDirection: 'row', gap: 16, justifyContent: 'space-between', paddingBottom: 10, borderBottomWidth: hairlineWidth, borderBottomColor: palette.separator },
  statusLabel: { color: world.cardMuted, fontSize: 13, fontWeight: '700' },
  statusValue: { flex: 1, color: world.cardInk, fontSize: 13, fontWeight: '800', textAlign: 'right' },
  successCard: { gap: 10, padding: 20, borderRadius: world.radius.card, backgroundColor: palette.successContainer },
  successEyebrow: { color: palette.onSuccessContainer, fontSize: 12, fontWeight: '900' },
  successTitle: { color: palette.onSuccessContainer, fontSize: 22, fontWeight: '900' },
  successBody: { color: palette.onSuccessContainer, fontSize: 14, lineHeight: 22 },
  successHighlight: { color: palette.onSuccessContainer, fontSize: 15, lineHeight: 22, fontWeight: '900' },
  collectionButton: { minHeight: uiMetrics.minTouch, maxWidth: '100%', alignSelf: 'flex-start', justifyContent: 'center', marginTop: 4, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 14, backgroundColor: palette.primary },
  collectionButtonText: { color: palette.onPrimary, fontSize: 14, fontWeight: '900', textAlign: 'center' },
  successActions: { gap: 6 },
  secondaryLinks: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 2 },
  textLink: { minHeight: uiMetrics.minTouch, justifyContent: 'center', paddingHorizontal: 4 },
  textLinkText: { color: palette.primary, fontSize: 14, fontWeight: '700' },
  linkSeparator: { color: palette.secondaryLabel, fontSize: 14 },
  // #295 "테스트 방문 만들기": 시연·로컬 개발 빌드에만 보이는 가상 점포 선택 알약.
  testVisitChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  testVisitChip: { minHeight: uiMetrics.minTouch, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.5, borderColor: world.cardMuted, backgroundColor: palette.background },
  testVisitChipSelected: { borderColor: palette.primary, backgroundColor: palette.primaryContainer },
  testVisitChipText: { color: world.cardInk, fontSize: 13, fontWeight: '700' },
  testVisitChipTextSelected: { color: palette.onPrimaryContainer },
  } satisfies Record<string, ImageStyle | TextStyle | ViewStyle>;
}
