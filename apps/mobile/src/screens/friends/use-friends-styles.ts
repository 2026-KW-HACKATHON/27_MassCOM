import { useMemo } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';

import { colorsForScheme } from '../../theme/palette';
import { worldForScheme } from '../../theme/world';
import { makeFriendsStyles } from './styles';

export function useFriendsStyles() {
  const scheme = useColorScheme();
  return useMemo(() => StyleSheet.create(makeFriendsStyles(colorsForScheme(scheme), worldForScheme(scheme))), [scheme]);
}
