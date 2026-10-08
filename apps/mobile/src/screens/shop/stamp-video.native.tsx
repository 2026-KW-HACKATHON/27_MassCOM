import { Asset } from 'expo-asset';
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';
import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, View, type ImageSourcePropType } from 'react-native';

import type { StampVideoProps } from './stamp-video';

type NativeStampVideoProps = {
  uri: string;
  playing: boolean;
  loop: boolean;
  muted: boolean;
  volume: number;
  style?: StampVideoProps['style'];
  onReady?: () => void;
  onEnded?: () => void;
  onError?: (event: { nativeEvent?: unknown }) => void;
};

const nativeModule = requireOptionalNativeModule('MasscomStampVideo') as { supportsPlayback?: boolean } | null;
const NativeStampVideo: React.ComponentType<NativeStampVideoProps> | null = nativeModule?.supportsPlayback
  ? requireNativeViewManager('MasscomStampVideo')
  : null;

function moduleAsset(source: ImageSourcePropType) {
  return Asset.fromModule(source as number);
}

function initialAssetUri(source: ImageSourcePropType): string | null {
  const asset = moduleAsset(source);
  return asset.localUri ?? null;
}

function useAssetUri(source: ImageSourcePropType, onError?: (error: unknown) => void): string | null {
  const [uri, setUri] = useState<string | null>(() => initialAssetUri(source));

  useEffect(() => {
    let alive = true;
    const asset = moduleAsset(source);
    asset.downloadAsync().then((downloaded) => {
      if (alive) setUri(downloaded.localUri ?? null);
    }, (error: unknown) => {
      if (alive) onError?.(error);
    });
    return () => { alive = false; };
  }, [onError, source]);

  return uri;
}

export function StampVideo({ source, posterSource, playing, loop, muted, volume, style, onReady, onEnded, onError }: StampVideoProps) {
  const uri = useAssetUri(source, onError);

  useEffect(() => {
    if (NativeStampVideo || !playing || loop) return;
    onError?.(new Error('STAMP_VIDEO_NATIVE_UNAVAILABLE'));
  }, [loop, onError, playing]);

  if (!NativeStampVideo || !uri) return <View style={[styles.frame, style]}><Image source={posterSource} resizeMode="contain" style={styles.poster} /></View>;
  return <NativeStampVideo
    uri={uri}
    playing={playing}
    loop={loop}
    muted={muted}
    volume={volume}
    style={style}
    onReady={onReady}
    onEnded={onEnded}
    onError={(event) => {
      if (!uri) return;
      onError?.(event.nativeEvent ?? event);
    }}
  />;
}

const styles = StyleSheet.create({
  frame: { width: '100%', height: '100%', backgroundColor: '#000000' },
  poster: { width: '100%', height: '100%' },
});
