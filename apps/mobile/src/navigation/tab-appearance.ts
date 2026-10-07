export type TabAppearance = { theme: 'mint' | 'wood' | 'night'; accent: 'mint' | 'blue' | 'rose'; icons: 'line' | 'filled' };
export const defaultTabAppearance: TabAppearance = { theme: 'mint', accent: 'mint', icons: 'filled' };
export function parseTabAppearance(value: unknown): TabAppearance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_TAB_APPEARANCE');
  const v = value as Record<string, unknown>;
  if (!['mint', 'wood', 'night'].includes(v.theme as string) || !['mint', 'blue', 'rose'].includes(v.accent as string)
    || !['line', 'filled'].includes(v.icons as string)) throw new Error('INVALID_TAB_APPEARANCE');
  return { theme: v.theme as TabAppearance['theme'], accent: v.accent as TabAppearance['accent'], icons: v.icons as TabAppearance['icons'] };
}
export function tabAppearanceColors(appearance: TabAppearance, dark: boolean) {
  const night = dark || appearance.theme === 'night';
  return {
    background: night ? '#203B34' : appearance.theme === 'wood' ? '#F1E1C8' : '#FFFFFC',
    active: night ? { mint: '#83DCCA', blue: '#AFCBFF', rose: '#FFB9CA' }[appearance.accent]
      : { mint: '#076F64', blue: '#315E9F', rose: '#9D4165' }[appearance.accent],
    selected: night ? '#304F45' : { mint: '#DDF6ED', blue: '#E1EDFF', rose: '#FCE5EE' }[appearance.accent],
    inactive: night ? '#C3D3CA' : '#435E64',
  };
}
