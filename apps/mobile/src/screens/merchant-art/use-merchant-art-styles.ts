import { useMemo } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';

import { colorsForScheme } from '../../theme/palette';
import { worldForScheme } from '../../theme/world';
import { makeMerchantArtStyles } from './styles';

export function useMerchantArtStyles() {
  const scheme = useColorScheme();
  return useMemo(() => StyleSheet.create(makeMerchantArtStyles(colorsForScheme(scheme), worldForScheme(scheme))), [scheme]);
}
