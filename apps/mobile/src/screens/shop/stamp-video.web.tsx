import { Asset } from 'expo-asset';
import { useCallback, useEffect, useRef, type CSSProperties } from 'react';
import { StyleSheet, View, type ImageSourcePropType, type ViewStyle } from 'react-native';

import type { StampVideoProps } from './stamp-video';

const TRUSTED_RETRY_EVENTS = ['pointerdown', 'keydown', 'touchstart'] as const;

function sourceUri(source: ImageSourcePropType): string | undefined {
  if (typeof source === 'string') return source;
  if (typeof source === 'object' && source && 'uri' in source) return source.uri;
  try {
    const asset = Asset.fromModule(source as number);
    return asset.localUri ?? asset.uri;
  } catch {
    return undefined;
  }
}

export function StampVideo({ source, posterSource, playing, loop, muted, volume, style, onReady, onEnded, onError }: StampVideoProps) {
  const video = useRef<HTMLVideoElement | null>(null);
  const callbacks = useRef({ onReady, onEnded, onError });
  const state = useRef({ playing, muted, volume });
  const retryHandler = useRef<(event: Event) => void>(() => undefined);
  const retryArmed = useRef(false);
  const playbackGeneration = useRef(0);

  useEffect(() => { callbacks.current = { onReady, onEnded, onError }; }, [onReady, onEnded, onError]);
  useEffect(() => { state.current = { playing, muted, volume }; }, [muted, playing, volume]);

  const handleTrustedRetry = useCallback((event: Event) => retryHandler.current(event), []);

  const disarmTrustedRetry = useCallback(() => {
    if (!retryArmed.current || typeof document === 'undefined') return;
    retryArmed.current = false;
    TRUSTED_RETRY_EVENTS.forEach((event) => document.removeEventListener(event, handleTrustedRetry, true));
  }, [handleTrustedRetry]);

  const armTrustedRetry = useCallback(() => {
    if (state.current.muted || retryArmed.current || typeof document === 'undefined') return;
    retryArmed.current = true;
    TRUSTED_RETRY_EVENTS.forEach((event) => document.addEventListener(event, handleTrustedRetry, true));
  }, [handleTrustedRetry]);

  const attemptPlay = useCallback((allowMutedFallback: boolean) => {
    const element = video.current;
    if (!element || !state.current.playing) return;
    const generation = playbackGeneration.current;
    const result = element.play();
    if (!result || typeof result.catch !== 'function') return;
    result.catch((error: unknown) => {
      if (!video.current || video.current !== element || !state.current.playing || playbackGeneration.current !== generation) return;
      if (allowMutedFallback && !element.muted) {
        element.muted = true;
        element.play()?.catch(() => undefined);
        armTrustedRetry();
        return;
      }
      callbacks.current.onError?.(error);
    });
  }, [armTrustedRetry]);

  useEffect(() => {
    retryHandler.current = (event: Event) => {
      if (!event.isTrusted || state.current.muted) return;
      const element = video.current;
      if (!element) return;
      element.muted = false;
      element.volume = state.current.volume;
      attemptPlay(false);
    };
  }, [attemptPlay]);

  useEffect(() => {
    const element = video.current;
    const uri = sourceUri(source);
    if (element && uri && element.getAttribute('src') !== uri) element.setAttribute('src', uri);
    return () => {
      if (!element) return;
      playbackGeneration.current += 1;
      element.pause();
      element.removeAttribute('src');
      element.load();
    };
  }, [source]);

  useEffect(() => disarmTrustedRetry, [disarmTrustedRetry]);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.loop = loop;
    element.muted = muted;
    element.volume = Math.max(0, Math.min(1, volume));
    if (playing) {
      playbackGeneration.current += 1;
      attemptPlay(true);
    }
    else {
      playbackGeneration.current += 1;
      disarmTrustedRetry();
      element.pause();
    }
  }, [attemptPlay, disarmTrustedRetry, loop, muted, playing, volume]);

  return <View pointerEvents="none" style={[styles.frame, style]}>
    {/** React Native Web does not type DOM tags as native components, so create the video element directly. */}
    {(
      <video
        ref={video}
        src={sourceUri(source)}
        poster={sourceUri(posterSource)}
        playsInline
        preload="auto"
        controls={false}
        muted={muted}
        loop={loop}
        onCanPlay={() => callbacks.current.onReady?.()}
        onEnded={() => callbacks.current.onEnded?.()}
        onError={(event) => callbacks.current.onError?.(event)}
        style={styles.video as CSSProperties}
      />
    )}
  </View>;
}

const styles = StyleSheet.create({
  frame: { width: '100%', height: '100%', backgroundColor: '#000000' },
  video: { width: '100%', height: '100%', objectFit: 'contain', display: 'block', backgroundColor: '#000000' } as unknown as ViewStyle,
});
