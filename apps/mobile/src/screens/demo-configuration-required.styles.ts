import type { ImageStyle, TextStyle, ViewStyle } from 'react-native';
import { type AppColors } from '../theme/palette';

export function makeDemoConfigurationRequiredStyles(palette: AppColors, hairlineWidth = 1) {
  return {

  // No page colour of its own: it sits on the sky page inside a tab, and on the stack's own background elsewhere.
  content: { flex: 1, justifyContent: 'center', gap: 16, padding: 24 },
  eyebrow: { color: palette.primary, fontSize: 13, fontWeight: '900' },
  title: { color: palette.label, fontSize: 30, fontWeight: '900', lineHeight: 38 },
  body: { color: palette.secondaryLabel, fontSize: 15, lineHeight: 24 },
  // A FloatingCard: it owns the surface, radius, padding and shadow.
  card: { gap: 10 },
  code: { color: palette.primary, fontFamily: 'monospace', fontSize: 13, fontWeight: '700' },
} satisfies Record<string, ImageStyle | TextStyle | ViewStyle>;
}
