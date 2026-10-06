import React from 'react';
import { Text, View } from 'react-native';
import type { TmapMapProps } from './tmap-view';
import { loadTmapWebSdk } from './tmap-web-sdk';
import { TmapWebSession } from './tmap-web-session';
import { loadNaverWebSdk } from './naver-web-sdk';
import { NaverWebSession } from './naver-web-session';
import { MapFallback } from './map-fallback';

let nextId = 0;

export function TmapMap(props: TmapMapProps) {
  const tmapKey = process.env.EXPO_PUBLIC_TMAP_MAP_APP_KEY?.trim();
  const naverKey = process.env.EXPO_PUBLIC_NAVER_MAP_CLIENT_ID?.trim();
  if (!tmapKey && !naverKey) return <MissingKey {...props} />;
  if (!props.active) return <View style={props.style} />;
  return <ActiveMap {...props} tmapKey={tmapKey} naverKey={naverKey} />;
}

function MissingKey({ style, onError }: TmapMapProps) {
  const reported = React.useRef(false);
  React.useEffect(() => { if (!reported.current) { reported.current = true; onError?.({ code: 'MAP_NOT_CONFIGURED', retryable: false }); } }, [onError]);
  return <View style={style} accessibilityRole="alert"><Text>지도를 사용할 수 없습니다.</Text></View>;
}

function ActiveMap({ camera, markers, selectedId, route, padding, style, onReady, onError, onViewport, onSelect, onCluster,
  onProviderReady, tmapKey, naverKey }: TmapMapProps & { tmapKey?: string; naverKey?: string }) {
  const [id] = React.useState(() => `masscom-map-${++nextId}`);
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'error'>('loading');
  const [provider, setProvider] = React.useState<'TMAP' | 'NAVER' | null>(null);
  const manager = React.useRef<MapFallback | null>(null);
  const snapshot = React.useRef({ camera, markers, selectedId, route });
  const callbacks = React.useRef({ onReady, onError, onViewport, onSelect, onCluster, onProviderReady });
  React.useEffect(() => { callbacks.current = { onReady, onError, onViewport, onSelect, onCluster, onProviderReady }; },
    [onReady, onError, onViewport, onSelect, onCluster, onProviderReady]);
  React.useEffect(() => {
    snapshot.current = { camera, markers, selectedId, route };
    manager.current?.update(snapshot.current);
  }, [camera, markers, selectedId, route]);

  React.useEffect(() => {
    const managerInstance = new MapFallback(tmapKey, naverKey, async (candidate, ready, failed, isCurrent) => {
      const events = () => ({ onReady: ready,
        onViewport: (value: Parameters<NonNullable<TmapMapProps['onViewport']>>[0]) => callbacks.current.onViewport?.(value),
        onSelect: (value: string) => callbacks.current.onSelect?.(value),
        onCluster: (value: string[]) => callbacks.current.onCluster?.(value) });
      if (candidate === 'TMAP') {
        const sdk = await loadTmapWebSdk(tmapKey!);
        if (!isCurrent()) throw Error('Map attempt cancelled');
        return new TmapWebSession(sdk, id, snapshot.current, events, failed);
      }
      const sdk = await loadNaverWebSdk(naverKey!);
      if (!isCurrent()) throw Error('Map attempt cancelled');
      return new NaverWebSession(sdk, id, snapshot.current, events, failed);
    }, candidate => {
      setProvider(candidate);
      setStatus('ready');
      callbacks.current.onReady?.();
      callbacks.current.onProviderReady?.(candidate);
    }, code => {
      setStatus('error');
      callbacks.current.onError?.({ code, retryable: code !== 'MAP_NOT_CONFIGURED' });
    }, () => document.getElementById(id)?.replaceChildren());
    manager.current = managerInstance;
    managerInstance.start();
    return () => {
      managerInstance.dispose();
      if (manager.current === managerInstance) manager.current = null;
      document.getElementById(id)?.replaceChildren();
    };
  }, [tmapKey, naverKey, id]);

  React.useEffect(() => { manager.current?.resize(); }, [padding]);
  const refreshViewport = () => { window.setTimeout(() => manager.current?.emitViewport(), 150); };
  return <View style={[style, { position: 'relative' }]}>
    <div onPointerUp={refreshViewport} onWheel={refreshViewport} onKeyUp={refreshViewport} id={id}
      style={{ position: 'absolute', left: padding.left, right: padding.right, top: padding.top, bottom: padding.bottom }} />
    {status !== 'ready' && <Text accessibilityRole="alert">{status === 'loading' ? '지도를 불러오는 중입니다.' : '지도를 사용할 수 없습니다.'}</Text>}
    {status === 'ready' && provider === 'NAVER' && <Text style={{ position: 'absolute', right: 8, top: 8, backgroundColor: 'white' }}>네이버 지도 대체 제공</Text>}
  </View>;
}
