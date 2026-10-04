import type { ImageStyle, TextStyle, ViewStyle } from 'react-native';
import { type AppColors } from '../../theme/palette';

export function makeWalletLinkStyles(palette: AppColors, hairlineWidth = 1) {
  return {

  // No page background: the sky page (SkyBackdrop) shows through. `card` and `boundaryCard` are FloatingCards, which own their surface.
  content: {
    gap: 20,
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 48,
  },
  hero: { gap: 10 },
  context: { color: palette.primary, fontSize: 14, fontWeight: '700' },
  title: { color: palette.label, fontSize: 32, fontWeight: '800', lineHeight: 40 },
  body: { color: palette.secondaryLabel, fontSize: 17, lineHeight: 27 },
  card: { gap: 2 },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
    paddingVertical: 12,
    borderBottomWidth: hairlineWidth,
    borderBottomColor: palette.separator,
  },
  statusLabel: { color: palette.secondaryLabel, fontSize: 14 },
  statusValue: {
    color: palette.label,
    fontSize: 13,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  address: { paddingTop: 14, color: palette.primary, fontFamily: 'monospace', fontSize: 13 },
  message: { padding: 16, borderRadius: 14, borderCurve: 'continuous', backgroundColor: palette.primaryContainer },
  messageError: { backgroundColor: palette.errorContainer },
  messageText: { color: palette.label, fontSize: 15, lineHeight: 23 },
  actions: { gap: 10 },
  nativeButtonHost: { minHeight: 48 },
  boundaryCard: { gap: 8 },
  boundaryTitle: { color: palette.label, fontSize: 15, fontWeight: '700' },
  boundaryText: { marginBottom: 8, color: palette.secondaryLabel, fontSize: 14, lineHeight: 22 },
} satisfies Record<string, ImageStyle | TextStyle | ViewStyle>;
}
