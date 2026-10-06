import React from 'react';
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';
import { View, Text } from 'react-native';
import type { TmapMapProps } from './tmap-view';

const TmapNative: React.ComponentType<any> | null = requireOptionalNativeModule('MasscomTmapMap')
  ? requireNativeViewManager('MasscomTmapMap') : null;
const NaverNative: React.ComponentType<any> | null = requireOptionalNativeModule('MasscomNaverMap')
  ? requireNativeViewManager('MasscomNaverMap') : null;

type Provider = 'TMAP' | 'NAVER';
type MapError = Parameters<NonNullable<TmapMapProps['onError']>>[0];

export function TmapMap({ onReady, onProviderReady, onError, onViewport, onSelect, onCluster, ...props }: TmapMapProps) {
  const tmapKey = process.env.EXPO_PUBLIC_TMAP_MAP_APP_KEY?.trim();
  const naverId = process.env.EXPO_PUBLIC_NAVER_MAP_CLIENT_ID?.trim();
  const tmapAvailable = !!tmapKey && !!TmapNative;
  const naverAvailable = !!naverId && !!NaverNative;
  const [provider, setProvider] = React.useState<Provider | null>(tmapAvailable ? 'TMAP' : naverAvailable ? 'NAVER' : null);
  const [ready, setReady] = React.useState(false);
  const [failure, setFailure] = React.useState<MapError | null>(null);
  const currentProvider = React.useRef<Provider | null>(tmapAvailable ? 'TMAP' : naverAvailable ? 'NAVER' : null);
  const pending = React.useRef<MapError | null>(null);
  const reported = React.useRef(false);
  const callbacks = React.useRef({ onReady, onProviderReady, onError, onViewport, onSelect, onCluster });
  React.useEffect(() => {
    callbacks.current = { onReady, onProviderReady, onError, onViewport, onSelect, onCluster };
  }, [onReady, onProviderReady, onError, onViewport, onSelect, onCluster]);

  const fail = React.useCallback((source: Provider, error: MapError) => {
    if (source !== currentProvider.current) return;
    if (!props.active) { pending.current = error; return; }
    if (source === 'TMAP' && naverAvailable) {
      currentProvider.current = 'NAVER';
      pending.current = null;
      setReady(false);
      setFailure(null);
      setProvider('NAVER');
      return;
    }
    currentProvider.current = null;
    setFailure(error);
    if (!reported.current) { reported.current = true; callbacks.current.onError?.(error); }
  }, [naverAvailable, props.active]);

  React.useEffect(() => {
    if (!props.active || !pending.current || !provider) return;
    const error = pending.current;
    pending.current = null;
    fail(provider, error);
  }, [props.active, provider, fail]);

  React.useEffect(() => {
    if (!props.active || !provider || ready || failure) return;
    const timer = setTimeout(() => fail(provider, { code: 'MAP_READY_TIMEOUT', retryable: true }), 10_000);
    return () => clearTimeout(timer);
  }, [props.active, provider, ready, failure, fail]);

  React.useEffect(() => {
    if (!props.active || provider || reported.current) return;
    reported.current = true;
    callbacks.current.onError?.({ code: !tmapKey && !naverId ? 'MAP_NOT_CONFIGURED' : 'MAP_NATIVE_UNAVAILABLE', retryable: false });
  }, [props.active, provider, tmapKey, naverId]);

  if (!provider || failure) return <View style={props.style} accessibilityRole="alert"><Text>지도를 사용할 수 없습니다. 가게 목록은 계속 볼 수 있습니다.</Text></View>;
  const NativeMap = provider === 'TMAP' ? TmapNative : NaverNative;
  if (!NativeMap) return <View style={props.style} accessibilityRole="alert"><Text>지도를 사용할 수 없습니다. 가게 목록은 계속 볼 수 있습니다.</Text></View>;
  return <View style={props.style}>
    <NativeMap {...props} style={{ flex: 1 }} {...(provider === 'TMAP' ? { appKey: tmapKey } : { clientId: naverId })}
      onReady={() => { if (currentProvider.current !== provider) return; setReady(true); callbacks.current.onProviderReady?.(provider); callbacks.current.onReady?.(); }}
      onError={(event: { nativeEvent: MapError }) => fail(provider, event.nativeEvent)}
      onViewport={(event: { nativeEvent: Parameters<NonNullable<TmapMapProps['onViewport']>>[0] }) => { if (currentProvider.current === provider) callbacks.current.onViewport?.(event.nativeEvent); }}
      onSelect={(event: { nativeEvent: { id: string } }) => { if (currentProvider.current === provider) callbacks.current.onSelect?.(event.nativeEvent.id); }}
      onCluster={(event: { nativeEvent: { ids: string[] } }) => { if (currentProvider.current === provider) callbacks.current.onCluster?.(event.nativeEvent.ids); }} />
    {provider === 'NAVER' ? <Text pointerEvents="none" accessibilityLabel="네이버 지도 대체 연결" style={{ position: 'absolute', top: 8, left: 8, padding: 4, borderRadius: 4, color: '#263d50', backgroundColor: '#ffffffdd', fontSize: 11 }}>네이버 지도 대체 연결</Text> : null}
  </View>;
}
