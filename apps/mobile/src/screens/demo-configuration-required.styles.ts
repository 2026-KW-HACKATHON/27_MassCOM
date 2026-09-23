import type { ImageStyle, TextStyle, ViewStyle } from 'react-native';
import { type AppColors } from '../theme/palette';

export function makeDemoConfigurationRequiredStyles(palette: AppColors, hairlineWidth = 1) {
  return {

  content: { flex: 1, justifyContent: 'center', gap: 16, padding: 24, backgroundColor: palette.background },
  eyebrow: { color: palette.primary, fontSize: 13, fontWeight: '900' },
  title: { color: palette.label, fontSize: 30, fontWeight: '900', lineHeight: 38 },
  body: { color: palette.secondaryLabel, fontSize: 15, lineHeight: 24 },
  card: { gap: 10, padding: 18, borderRadius: 18, backgroundColor: palette.surface },
  code: { color: palette.primary, fontFamily: 'monospace', fontSize: 13, fontWeight: '700' },
} satisfies Record<string, ImageStyle | TextStyle | ViewStyle>;
}
