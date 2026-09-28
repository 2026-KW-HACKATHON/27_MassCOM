import type { ImageStyle, TextStyle, ViewStyle } from 'react-native';
import { type AppColors } from '../../theme/palette';

export function makeMerchantClaimStyles(palette: AppColors, hairlineWidth = 1) {
  return {

  content: { gap: 18, padding: 20, paddingBottom: 48, backgroundColor: palette.background },
  hero: { gap: 10 },
  eyebrow: { color: palette.primary, fontSize: 13, fontWeight: '900' },
  title: { color: palette.label, fontSize: 31, fontWeight: '900', lineHeight: 39, letterSpacing: -0.6 },
  body: { color: palette.secondaryLabel, fontSize: 15, lineHeight: 24 },
  contextCard: { gap: 8, padding: 18, borderRadius: 20, backgroundColor: palette.primaryContainer },
  formCard: { gap: 14, padding: 18, borderRadius: 20, backgroundColor: palette.surface },
  cardLabel: { color: palette.label, fontSize: 17, fontWeight: '900' },
  infoRow: { flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
  infoLabel: { color: palette.onPrimaryContainer, fontSize: 13, fontWeight: '700' },
  infoValue: { flex: 1, color: palette.onPrimaryContainer, fontSize: 13, fontWeight: '800', textAlign: 'right' },
  inputGroup: { gap: 7 },
  inputLabel: { color: palette.label, fontSize: 13, fontWeight: '800' },
  input: { minHeight: 50, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: palette.separator, color: palette.label, backgroundColor: palette.background, fontSize: 15 },
  help: { color: palette.secondaryLabel, fontSize: 12, lineHeight: 19 },
  button: { minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, borderRadius: 14, backgroundColor: palette.primary },
  secondaryButton: { borderWidth: 1, borderColor: palette.primary, backgroundColor: 'transparent' },
  buttonText: { color: palette.onPrimary, fontSize: 14, fontWeight: '900', textAlign: 'center' },
  secondaryButtonText: { color: palette.primary },
  disabled: { opacity: 0.42 },
  message: { padding: 13, borderRadius: 14, color: palette.onPrimaryContainer, backgroundColor: palette.primaryContainer, fontSize: 13, lineHeight: 20 },
  errorText: { color: palette.onErrorContainer, fontSize: 13, lineHeight: 20 },
  qr: { alignItems: 'center', paddingVertical: 8 },
  tokenCard: { gap: 14, padding: 18, borderRadius: 20, backgroundColor: palette.surface },
  tokenTopline: { gap: 4 },
  tokenLabel: { color: palette.primary, fontSize: 13, fontWeight: '900' },
  expiry: { color: palette.secondaryLabel, fontSize: 12 },
  token: { padding: 13, borderRadius: 12, color: palette.label, backgroundColor: palette.background, fontFamily: 'monospace', fontSize: 13, lineHeight: 20 },
  actions: { gap: 10 },
  couponRow: { gap: 8, padding: 14, borderRadius: 14, backgroundColor: palette.background },
  couponTitle: { color: palette.label, fontSize: 15, fontWeight: '900' },
} satisfies Record<string, ImageStyle | TextStyle | ViewStyle>;
}
