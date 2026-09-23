import type { ImageStyle, TextStyle, ViewStyle } from 'react-native';
import type { AppColors } from '../../theme/palette';
import { uiMetrics } from '../../theme/ui-metrics';

export function makeClaimRedeemStyles(palette: AppColors, hairlineWidth = 1) {
  return {
  content: { gap: 14, padding: uiMetrics.pageInset, paddingBottom: 48, backgroundColor: palette.background },
  hero: { gap: 8 },
  eyebrow: { color: palette.primary, fontSize: 13, fontWeight: '900' },
  title: { color: palette.label, fontSize: 26, fontWeight: '800', lineHeight: 34, letterSpacing: -0.4 },
  body: { color: palette.secondaryLabel, fontSize: 14, lineHeight: 21 },
  formCard: { gap: 10, padding: 16, borderRadius: uiMetrics.cardRadius, backgroundColor: palette.surface },
  sectionTitle: { color: palette.label, fontSize: 17, fontWeight: '800' },
  securityNote: { color: palette.secondaryLabel, fontSize: 12, lineHeight: 18 },
  inputLabel: { color: palette.label, fontSize: 14, fontWeight: '900' },
  camera: { height: 280, borderRadius: 14, overflow: 'hidden', backgroundColor: '#000000' },
  scanButton: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.primary },
  scanButtonText: { color: palette.primary },
  input: { minHeight: 72, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: palette.separator, color: palette.label, backgroundColor: palette.background, fontFamily: 'monospace', fontSize: 13, textAlignVertical: 'top' },
  button: { minHeight: uiMetrics.minTouch, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, borderRadius: 14, backgroundColor: palette.primary },
  buttonText: { color: palette.onPrimary, fontSize: 14, fontWeight: '900' },
  disabled: { opacity: 0.42 },
  message: { padding: 13, borderRadius: 14, color: palette.onPrimaryContainer, backgroundColor: palette.primaryContainer, fontSize: 13, lineHeight: 20 },
  previewCard: { gap: 10, padding: 18, borderRadius: 20, backgroundColor: palette.surface },
  statusRow: { flexDirection: 'row', gap: 16, justifyContent: 'space-between', paddingBottom: 10, borderBottomWidth: hairlineWidth, borderBottomColor: palette.separator },
  statusLabel: { color: palette.secondaryLabel, fontSize: 13, fontWeight: '700' },
  statusValue: { flex: 1, color: palette.label, fontSize: 13, fontWeight: '800', textAlign: 'right' },
  successCard: { gap: 10, padding: 20, borderRadius: 22, backgroundColor: palette.successContainer },
  successEyebrow: { color: palette.onSuccessContainer, fontSize: 12, fontWeight: '900' },
  successTitle: { color: palette.onSuccessContainer, fontSize: 22, fontWeight: '900' },
  successBody: { color: palette.onSuccessContainer, fontSize: 14, lineHeight: 22 },
  collectionButton: { minHeight: uiMetrics.minTouch, maxWidth: '100%', alignSelf: 'flex-start', justifyContent: 'center', marginTop: 4, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 14, backgroundColor: palette.primary },
  collectionButtonText: { color: palette.onPrimary, fontSize: 14, fontWeight: '900', textAlign: 'center' },
  successActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  } satisfies Record<string, ImageStyle | TextStyle | ViewStyle>;
}
