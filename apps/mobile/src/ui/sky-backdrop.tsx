import type { ReactNode } from 'react';
import { StyleSheet, View, useColorScheme } from 'react-native';

import { worldForScheme } from '../theme/world';

/**
 * The page colour a sky-town screen sits on. The illustration is not drawn here: it belongs to the header at the top of the
 * scroll content (AppHeader / BackHeader), so it scrolls away with the screen. Below it the page is plain sky[2].
 */
export function SkyBackdrop({ children }: { children?: ReactNode }) {
  const world = worldForScheme(useColorScheme());
  return <View style={[styles.root, { backgroundColor: world.sky[2] }]}>{children}</View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
