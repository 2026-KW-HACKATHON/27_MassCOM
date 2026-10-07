// Issue #224 하늘 동네 세계의 장식 토큰. 의미색(행동·성공·오류)은 palette.ts가 정본이다.
export type WorldTheme = {
  sky: readonly [string, string, string];
  /** The page colour under the header art (sky[1]): the scroll area, the tab-bar mask and everything drawn straight on the page. */
  page: string;
  skyInk: string; skyMuted: string;
  /** Frosted panel behind header text: the header art is an opaque picture, so text is only guaranteed over this. */
  headerScrim: string; headerScrimAlpha: number;
  /** Solid scrim under the status bar once content scrolls beneath it (sky[2] at this alpha). */
  statusScrimAlpha: number;
  card: string; cardInk: string; cardMuted: string; cardShadow: string;
  /** 1px top highlight on a card: the dark card is only ~1.05:1 against the dark page, so its edge is drawn (alpha 0 in light). */
  cardEdge: string; cardEdgeAlpha: number;
  paper: string; paperInk: string; paperLine: string;
  stampOrange: string; stampInk: string;
  tabBar: string; tabActive: string; tabInactive: string;
  radius: { card: number; chip: number; tabBar: number };
};

const radius = { card: 22, chip: 999, tabBar: 24 } as const;

export const lightWorld: WorldTheme = {
  sky: ['#EFF8F1', '#F1F5ED', '#FFFFFB'],
  page: '#F1F5ED',
  skyInk: '#123E49', skyMuted: '#49666D',
  headerScrim: '#FFFFFB', headerScrimAlpha: 0.88,
  statusScrimAlpha: 0.94,
  card: '#FFFFFF', cardInk: '#163D46', cardMuted: '#567078', cardShadow: '#29493D',
  cardEdge: '#FFFFFF', cardEdgeAlpha: 0,
  paper: '#F7EFE0', paperInk: '#4A3317', paperLine: '#A77C46',
  stampOrange: '#CA6E29', stampInk: '#A3401F',
  tabBar: '#FFFFFF', tabActive: '#076F64', tabInactive: '#567078',
  radius,
};

export const darkWorld: WorldTheme = {
  sky: ['#183630', '#142A26', '#112420'],
  page: '#142A26',
  skyInk: '#F0F7F1', skyMuted: '#C4D6CD',
  headerScrim: '#112420', headerScrimAlpha: 0.88,
  statusScrimAlpha: 0.94,
  card: '#203B34', cardInk: '#F0F7F1', cardMuted: '#BDCEC4', cardShadow: '#000000',
  cardEdge: '#FFFFFF', cardEdgeAlpha: 0.1,
  paper: '#2A2418', paperInk: '#F2E6CF', paperLine: '#B28D59',
  stampOrange: '#F0A057', stampInk: '#FFB09A',
  tabBar: '#203B34', tabActive: '#83DCCA', tabInactive: '#BDCEC4',
  radius,
};

export function worldForScheme(scheme: 'light' | 'dark' | 'unspecified' | null | undefined): WorldTheme {
  return scheme === 'dark' ? darkWorld : lightWorld;
}
