import { useMemo } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';

import { colorsForScheme } from '../../theme/palette';
import { worldForScheme } from '../../theme/world';
import { makeMerchantListStyles } from './styles';

export function useMerchantListStyles() {
  const scheme = useColorScheme();
  return useMemo(
    () => StyleSheet.create(makeMerchantListStyles(colorsForScheme(scheme), worldForScheme(scheme), StyleSheet.hairlineWidth)),
    [scheme],
  );
}
