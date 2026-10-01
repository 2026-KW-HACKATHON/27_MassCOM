import { StyleSheet, useColorScheme } from 'react-native';
import { colorsForScheme } from '../../theme/palette';
import { worldForScheme } from '../../theme/world';
import { makeCollectionStyles } from './styles';

// A separate module from styles.ts (which stays a plain pure module: styles.test.ts imports makeCollectionStyles
// directly, and a react-native runtime import there breaks that plain node:test run — see #296 commit notes).
// One StyleSheet per colour scheme instead of one per render of every card. Shared by the screen and by
// CollectibleBrowser, which draws the merged album's NFT status/mint rows with the same look.
const styleCache = new Map<'light' | 'dark', ReturnType<typeof createCollectionStyles>>();
function createCollectionStyles(scheme: 'light' | 'dark') {
  return StyleSheet.create(makeCollectionStyles(colorsForScheme(scheme), worldForScheme(scheme), StyleSheet.hairlineWidth));
}
export function useCollectionStyles() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  let styles = styleCache.get(scheme);
  if (!styles) {
    styles = createCollectionStyles(scheme);
    styleCache.set(scheme, styles);
  }
  return styles;
}
