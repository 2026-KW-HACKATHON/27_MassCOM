import React from 'react';
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';
import { View, Text } from 'react-native';
import type { TmapMapProps } from './tmap-view';

const NativeMap: React.ComponentType<any> | null = requireOptionalNativeModule('MasscomTmapMap')
  ? requireNativeViewManager('MasscomTmapMap') : null;

export function TmapMap({ onReady, onError, onViewport, onSelect, onCluster, ...props }: TmapMapProps) {
  const key = process.env.EXPO_PUBLIC_TMAP_MAP_APP_KEY?.trim();
  const missingCode = !key ? 'MAP_NOT_CONFIGURED' : !NativeMap ? 'MAP_NATIVE_UNAVAILABLE' : null;
  const reported = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (missingCode && reported.current !== missingCode) {
      reported.current = missingCode;
      onError?.({ code: missingCode, retryable: false });
    }
  }, [missingCode, onError]);
  if (!key || !NativeMap) return <View style={props.style} accessibilityRole="alert"><Text>지도를 사용할 수 없습니다.</Text></View>;
  return <NativeMap {...props} appKey={key}
    onReady={() => onReady?.()}
    onError={(event: { nativeEvent: { code: string; retryable: boolean } }) => onError?.(event.nativeEvent)}
    onViewport={(event: { nativeEvent: Parameters<NonNullable<TmapMapProps['onViewport']>>[0] }) => onViewport?.(event.nativeEvent)}
    onSelect={(event: { nativeEvent: { id: string } }) => onSelect?.(event.nativeEvent.id)}
    onCluster={(event: { nativeEvent: { ids: string[] } }) => onCluster?.(event.nativeEvent.ids)} />;
}
