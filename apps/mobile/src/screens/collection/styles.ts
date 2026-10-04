import type { ImageStyle, TextStyle, ViewStyle } from 'react-native';
import { withAlpha } from '../../theme/contrast';
import type { AppColors } from '../../theme/palette';
import { uiMetrics } from '../../theme/ui-metrics';
import type { WorldTheme } from '../../theme/world';

export function makeCollectionStyles(palette: AppColors, world: WorldTheme, hairlineWidth = 1) {
  return {
  // No background: the sky backdrop shows through.
  content: { gap: uiMetrics.sectionGap, padding: uiMetrics.pageInset },
  inlineError: { padding: 12, borderRadius: 12, color: palette.onErrorContainer, backgroundColor: palette.errorContainer, fontSize: 13 },
  inlineMessage: { padding: 12, borderRadius: 12, color: palette.onPrimaryContainer, backgroundColor: palette.primaryContainer, fontSize: 13, lineHeight: 20 },
  recoveryBanner: { gap: 10, padding: 14, borderRadius: 14, backgroundColor: palette.errorContainer },
  recoveryText: { color: palette.onErrorContainer, fontSize: 13, lineHeight: 20 },
  recoveryButton: { minHeight: uiMetrics.minTouch, maxWidth: '100%', alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: 13, paddingVertical: 9, borderRadius: 12, backgroundColor: world.card },
  recoveryButtonText: { color: palette.primary, fontSize: 12, fontWeight: '900' },
  // Compact header strip (#296, Option A): replaces the full PassportHero at the top of the screen.
  passportStrip: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 6, borderRadius: world.radius.chip, backgroundColor: withAlpha(world.headerScrim, world.headerScrimAlpha) },
  passportStripText: { color: world.skyInk, fontSize: 13, fontWeight: '800' },
  section: { gap: 5 },
  sectionTitle: { color: world.skyInk, fontSize: 22, fontWeight: '900' },
  subsectionTitle: { marginTop: 8, color: world.skyInk, fontSize: 17, fontWeight: '800' },
  sectionNote: { color: world.skyMuted, fontSize: 13, lineHeight: 20 },
  sectionBody: { gap: 12, marginTop: 9 },
  collectibleCard: { gap: 9, padding: 18, borderRadius: world.radius.card, backgroundColor: world.card },
  collectibleArt: { borderRadius: 16 } as ImageStyle,
  collectibleArtNote: { color: world.cardMuted, fontSize: 11, lineHeight: 16 } as TextStyle,
  collectibleTopline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  goalBadge: { color: palette.primary, fontSize: 12, fontWeight: '900' },
  appStatus: { color: palette.onSuccessContainer, fontSize: 11, fontWeight: '900' },
  itemTitle: { color: world.cardInk, fontSize: 19, fontWeight: '900' },
  itemMeta: { color: world.cardMuted, fontSize: 12, lineHeight: 18 },
  nftRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 9, borderTopWidth: hairlineWidth, borderTopColor: palette.separator },
  nftLabel: { color: world.cardMuted, fontSize: 12, fontWeight: '700' },
  nftValue: { color: world.cardInk, fontSize: 12, fontWeight: '900' },
  recipient: { color: world.cardMuted, fontFamily: 'monospace', fontSize: 11 },
  nftIdentity: { color: palette.primary, fontFamily: 'monospace', fontSize: 11, lineHeight: 17 },
  mintButton: { minHeight: uiMetrics.minTouch, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, borderRadius: 14, backgroundColor: palette.primary },
  mintButtonText: { color: palette.onPrimary, fontSize: 13, fontWeight: '900', textAlign: 'center' },
  walletButton: { minHeight: uiMetrics.minTouch, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, borderRadius: 14, borderWidth: 1, borderColor: palette.primary },
  walletButtonText: { color: palette.primary, fontSize: 13, fontWeight: '900', textAlign: 'center' },
  primaryButton: { minHeight: uiMetrics.minTouch, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, paddingVertical: 12, borderRadius: 14, backgroundColor: palette.primary },
  primaryButtonText: { color: palette.onPrimary, fontSize: 14, fontWeight: '900', textAlign: 'center' },
  disabled: { opacity: 0.42 },
  visitRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 14, padding: 16, borderRadius: world.radius.card, backgroundColor: world.card },
  visitMerchant: { color: world.cardInk, fontSize: 16, fontWeight: '900' },
  visitLeft: { flex: 1, minWidth: 0 },
  visitRight: { alignItems: 'flex-end', gap: 3, flexShrink: 0 },
  visitDate: { color: world.cardInk, fontSize: 13, fontWeight: '800' },
  progressLabel: { color: palette.primary, fontSize: 11, fontWeight: '800' },
  emptyCopy: { padding: 18, borderRadius: world.radius.card, color: world.cardMuted, backgroundColor: world.card, fontSize: 14, lineHeight: 22 },
  } satisfies Record<string, ImageStyle | TextStyle | ViewStyle>;
}
