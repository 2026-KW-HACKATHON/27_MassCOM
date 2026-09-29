import { useMemo } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';

import { colorsForScheme } from '../theme/palette';
import { worldForScheme } from '../theme/world';
import { makeUiStyles } from './styles';

export function useUiStyles() {
  const scheme = useColorScheme();
  return useMemo(() => StyleSheet.create(makeUiStyles(colorsForScheme(scheme), worldForScheme(scheme))), [scheme]);
}
