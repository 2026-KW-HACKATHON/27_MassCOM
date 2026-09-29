import { BottomTabBarHeightContext } from 'expo-router/tabs';
import { useContext } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Space a scrolling screen must leave at its bottom so nothing hides behind the floating tab bar.
 * The bar reports its own footprint to the navigator; outside the tabs (or while the bar is away) only the inset is left.
 */
export function useTabBarClearance(): number {
  const barFootprint = useContext(BottomTabBarHeightContext);
  const insets = useSafeAreaInsets();
  return (barFootprint ? barFootprint : insets.bottom) + 16;
}
