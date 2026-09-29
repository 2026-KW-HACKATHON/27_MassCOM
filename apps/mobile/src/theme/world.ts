// Issue #224 하늘 동네 세계의 장식 토큰. 의미색(행동·성공·오류)은 palette.ts가 정본이다.
export type WorldTheme = {
  sky: readonly [string, string, string];
  skyInk: string; skyMuted: string;
  /** Frosted panel behind header text: the header art is an opaque picture, so text is only guaranteed over this. */
  headerScrim: string; headerScrimAlpha: number;
  card: string; cardInk: string; cardMuted: string; cardShadow: string;
  paper: string; paperInk: string; paperLine: string;
  stampOrange: string; stampInk: string;
  tabBar: string; tabActive: string; tabInactive: string;
  radius: { card: number; chip: number; tabBar: number };
};

const radius = { card: 24, chip: 999, tabBar: 28 } as const;

export const lightWorld: WorldTheme = {
  sky: ['#BFE3FF', '#E4F3FF', '#F7FBFF'],
  skyInk: '#12294A', skyMuted: '#34506F',
  headerScrim: '#F7FBFF', headerScrimAlpha: 0.88,
  card: '#FFFFFF', cardInk: '#192331', cardMuted: '#55657B', cardShadow: '#1D4E89',
  paper: '#F7EFE0', paperInk: '#4A3317', paperLine: '#A77C46',
  stampOrange: '#CA6E29', stampInk: '#A3401F',
  tabBar: '#FFFFFF', tabActive: '#2456D6', tabInactive: '#55657B',
  radius,
};

export const darkWorld: WorldTheme = {
  sky: ['#1D3A63', '#1A2A45', '#182131'],
  skyInk: '#F3F5F9', skyMuted: '#C4D0E0',
  headerScrim: '#182131', headerScrimAlpha: 0.88,
  card: '#20252F', cardInk: '#F3F5F9', cardMuted: '#B3BCCB', cardShadow: '#000000',
  paper: '#2A2418', paperInk: '#F2E6CF', paperLine: '#8C6A3C',
  stampOrange: '#F0A057', stampInk: '#FFB09A',
  tabBar: '#20252F', tabActive: '#9BB8FF', tabInactive: '#B3BCCB',
  radius,
};

export function worldForScheme(scheme: 'light' | 'dark' | 'unspecified' | null | undefined): WorldTheme {
  return scheme === 'dark' ? darkWorld : lightWorld;
}
