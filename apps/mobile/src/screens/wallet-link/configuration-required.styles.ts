import type { ImageStyle, TextStyle, ViewStyle } from 'react-native';
import { type AppColors } from '../../theme/palette';

export function makeWalletConfigurationRequiredStyles(palette: AppColors, hairlineWidth = 1) {
  return {

  // No page background: the sky page (SkyBackdrop) shows through. `card` is a FloatingCard, which owns its surface.
  content: {
    flexGrow: 1,
    gap: 18,
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: palette.errorContainer,
  },
  badgeText: {
    color: palette.onErrorContainer,
    fontSize: 12,
    fontWeight: '800',
  },
  title: {
    color: palette.label,
    fontSize: 30,
    fontWeight: '800',
    lineHeight: 38,
  },
  body: {
    color: palette.secondaryLabel,
    fontSize: 17,
    lineHeight: 27,
  },
  card: { gap: 10 },
  cardTitle: {
    color: palette.label,
    fontSize: 16,
    fontWeight: '700',
  },
  code: {
    color: palette.primary,
    fontFamily: 'monospace',
    fontSize: 14,
  },
  note: {
    color: palette.secondaryLabel,
    fontSize: 14,
  },
} satisfies Record<string, ImageStyle | TextStyle | ViewStyle>;
}
