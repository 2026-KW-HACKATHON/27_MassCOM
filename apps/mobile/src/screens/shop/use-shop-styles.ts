import { useMemo } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';

import { colorsForScheme } from '../../theme/palette';
import { worldForScheme } from '../../theme/world';
import { makeShopStyles } from './styles';

export function useShopStyles() {
  const scheme = useColorScheme();
  return useMemo(() => StyleSheet.create(makeShopStyles(colorsForScheme(scheme), worldForScheme(scheme))), [scheme]);
}
