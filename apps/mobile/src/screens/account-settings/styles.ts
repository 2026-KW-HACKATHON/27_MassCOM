import type { ImageStyle, TextStyle, ViewStyle } from 'react-native';
import type { AppColors } from '../../theme/palette';
import { uiMetrics } from '../../theme/ui-metrics';

export function makeAccountSettingsStyles(palette: AppColors, hairlineWidth = 1) {
  return {
  content: { gap: 14, padding: uiMetrics.pageInset, paddingBottom: 52, backgroundColor: palette.background },
  eyebrow: { color: palette.primary, fontSize: 14, fontWeight: '800' },
  title: { color: palette.label, fontSize: 26, lineHeight: 34, fontWeight: '800', letterSpacing: -0.4 },
  intro: { color: palette.secondaryLabel, fontSize: 14, lineHeight: 21 },
  accountDiagnostic: { color: palette.secondaryLabel, fontSize: 12, lineHeight: 18 },
  sessionActions: { gap: 10 },
  sessionButtonHost: { minHeight: uiMetrics.minTouch },
  toolsSection: { gap: 8, paddingVertical: 10 },
  sectionTitle: { color: palette.label, fontSize: 18, fontWeight: '800' },
  secondaryLink: { minHeight: uiMetrics.minTouch, alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: palette.primary },
  secondaryLinkText: { color: palette.primary, fontSize: 14, fontWeight: '800' },
  card: { gap: 7, paddingVertical: 14, borderTopWidth: hairlineWidth, borderTopColor: palette.separator },
  cardTitle: { color: palette.label, fontSize: 16, fontWeight: '900' },
  cardBody: { color: palette.secondaryLabel, fontSize: 14, lineHeight: 22 },
  statusCard: { gap: 7, padding: 18, borderRadius: 18, backgroundColor: palette.primaryContainer },
  statusTitle: { color: palette.onPrimaryContainer, fontSize: 16, fontWeight: '900' },
  statusBody: { color: palette.onPrimaryContainer, fontSize: 13, lineHeight: 20 },
  error: { padding: 14, borderRadius: 14, color: palette.onErrorContainer, backgroundColor: palette.errorContainer, lineHeight: 20 },
  message: { padding: 14, borderRadius: 14, color: palette.onPrimaryContainer, backgroundColor: palette.primaryContainer, lineHeight: 20 },
  liveRegion: { gap: 10 },
  deleteButton: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: palette.errorContainer },
  deleteButtonText: { color: palette.onErrorContainer, fontSize: 15, fontWeight: '900' },
  disabled: { opacity: 0.45 },
  note: { color: palette.secondaryLabel, fontSize: 12, lineHeight: 19 },
  blockedCard: { gap: 8, padding: 18, borderRadius: 18, backgroundColor: palette.errorContainer },
  blockedTitle: { color: palette.onErrorContainer, fontSize: 15, fontWeight: '900' },
  blockedBody: { color: palette.onErrorContainer, fontSize: 13, lineHeight: 21 },
  } satisfies Record<string, ImageStyle | TextStyle | ViewStyle>;
}
