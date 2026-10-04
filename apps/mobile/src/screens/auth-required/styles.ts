import type { ImageStyle, TextStyle, ViewStyle } from 'react-native';
import { type AppColors } from '../../theme/palette';

export function makeAuthRequiredStyles(palette: AppColors, hairlineWidth = 1) {
  return {

  // No page background: the sky page (SkyBackdrop) shows through. The status card is a FloatingCard, which owns its surface.
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: 18,
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  eyebrow: { color: palette.primary, fontSize: 14, fontWeight: '800' },
  title: { color: palette.label, fontSize: 30, lineHeight: 38, fontWeight: '900' },
  body: { color: palette.secondaryLabel, fontSize: 16, lineHeight: 25 },
  statusCard: { gap: 10 },
  statusTitle: { color: palette.label, fontSize: 15, lineHeight: 22, fontWeight: '700' },
  buttonHost: { minHeight: 48 },
  actions: { gap: 18 },
  guestActionGroup: { gap: 8 },
  guestButton: { minHeight: 48, justifyContent: 'center', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16 },
  guestButtonLabel: { color: palette.primary, fontSize: 16, fontWeight: '700', textAlign: 'center', flexShrink: 1 },
  guestDescription: { color: palette.secondaryLabel, fontSize: 14, lineHeight: 22, textAlign: 'center' },
} satisfies Record<string, ImageStyle | TextStyle | ViewStyle>;
}
