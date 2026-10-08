import React, { type ReactNode } from 'react';
import { View } from 'react-native';

export function SafeAreaProvider({ children, style }: { children?: ReactNode; style?: object }) {
  return <View style={style}>{children}</View>;
}

export function useSafeAreaInsets() {
  return { top: 0, right: 0, bottom: 0, left: 0 };
}
