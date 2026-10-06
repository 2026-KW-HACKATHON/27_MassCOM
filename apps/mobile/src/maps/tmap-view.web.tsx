import React from 'react';
import { Text, View } from 'react-native';
import type { TmapMapProps } from './tmap-view';
import { loadTmapWebSdk } from './tmap-web-sdk';
import { TmapWebSession } from './tmap-web-session';

let nextId = 0;

export function TmapMap(props: TmapMapProps) {
  const key = process.env.EXPO_PUBLIC_TMAP_MAP_APP_KEY?.trim();
  if (!key) return <MissingKey {...props} />;
  if (!props.active) return <View style={props.style} />;
  return <ActiveMap {...props} sdkKey={key} />;
}

function MissingKey({ style, onError }: TmapMapProps) {
  const reported = React.useRef(false);
  React.useEffect(() => { if (!reported.current) { reported.current = true; onError?.({ code: 'MAP_NOT_CONFIGURED', retryable: false }); } }, [onError]);
  return <View style={style} accessibilityRole="alert"><Text>지도를 사용할 수 없습니다.</Text></View>;
}

function ActiveMap({ camera, markers, selectedId, route, padding, style, onReady, onError, onViewport, onSelect, onCluster, sdkKey }: TmapMapProps & { sdkKey: string }) {
  const [id] = React.useState(() => `masscom-tmap-${++nextId}`);
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'error'>('loading');
  const session = React.useRef<TmapWebSession | null>(null);
  const snapshot = React.useRef({ camera, markers, selectedId, route });
  const callbacks = React.useRef({ onReady, onViewport, onSelect, onCluster, onError });
  React.useEffect(() => { callbacks.current = { onReady, onViewport, onSelect, onCluster, onError }; }, [onReady, onViewport, onSelect, onCluster, onError]);
  React.useEffect(() => {
    snapshot.current = { camera, markers, selectedId, route };
    session.current?.update(snapshot.current);
  }, [camera, markers, selectedId, route]);

  React.useEffect(() => {
    let cancelled = false;
    loadTmapWebSdk(sdkKey).then(sdk => {
      if (cancelled) return;
      session.current = new TmapWebSession(sdk, id, snapshot.current, () => ({
        onReady: () => { setStatus('ready'); callbacks.current.onReady?.(); },
        onViewport: value => callbacks.current.onViewport?.(value),
        onSelect: value => callbacks.current.onSelect?.(value),
        onCluster: value => callbacks.current.onCluster?.(value),
      }));
    }).catch(() => {
      if (!cancelled) { setStatus('error'); callbacks.current.onError?.({ code: 'MAP_WEB_SDK_UNAVAILABLE', retryable: true }); }
    });
    return () => {
      cancelled = true;
      session.current?.dispose();
      session.current = null;
      document.getElementById(id)?.replaceChildren();
    };
  }, [sdkKey, id]);

  React.useEffect(() => { session.current?.resize(); }, [padding]);
  const refreshViewport = () => { window.setTimeout(() => session.current?.emitViewport(), 150); };
  return <View style={[style, { position: 'relative' }]}>
    <div onPointerUp={refreshViewport} onWheel={refreshViewport} onKeyUp={refreshViewport} id={id}
      style={{ position: 'absolute', left: padding.left, right: padding.right, top: padding.top, bottom: padding.bottom }} />
    {status !== 'ready' && <Text accessibilityRole="alert">{status === 'loading' ? '지도를 불러오는 중입니다.' : '지도를 사용할 수 없습니다.'}</Text>}
  </View>;
}
