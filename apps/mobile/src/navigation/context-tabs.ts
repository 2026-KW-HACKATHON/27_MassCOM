export const primaryDestinations = [
  // Qualify the group so Expo's /play base URL stripping cannot consume /play-tab.
  { href: '/(tabs)/search', label: '탐색', glyph: 'map' },
  { href: '/(tabs)/collection', label: '도감', glyph: 'collection' },
  { href: '/(tabs)', label: '홈', glyph: 'home' },
  { href: '/(tabs)/play-tab', label: '놀이', glyph: 'play' },
  { href: '/(tabs)/shop', label: '상점', glyph: 'shop' },
] as const;
export function contextualTab(path: string): number | null {
  if (['/', '/search', '/collection', '/play-tab', '/shop', '/claim', '/play', '/wallet'].includes(path)) return null;
  if (path === '/room-explore' || path === '/map' || path.startsWith('/merchants/') || path === '/recommendations') return 0;
  if (path === '/coin-collection') return 1;
  if (path === '/coin-shop' || path === '/room-inventory') return 4;
  if (path.startsWith('/home/') || path.startsWith('/friends') || path.startsWith('/mail')
    || ['/studio', '/profile', '/appearance', '/settings', '/notifications', '/meal-merchant'].includes(path)) return 2;
  return null;
}
