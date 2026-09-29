import { useMemo } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';

import { colorsForScheme } from '../../theme/palette';
import { worldForScheme } from '../../theme/world';
import { makeTownMapStyles } from './styles';

export function useTownMapStyles() {
  const scheme = useColorScheme();
  return useMemo(() => StyleSheet.create(makeTownMapStyles(colorsForScheme(scheme), worldForScheme(scheme))), [scheme]);
}
