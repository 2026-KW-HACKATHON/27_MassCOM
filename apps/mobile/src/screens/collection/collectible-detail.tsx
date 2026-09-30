import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Image, PanResponder, Pressable, ScrollView, StyleSheet, Switch, Text, View, useColorScheme, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, Image as SvgImage, LinearGradient, Mask, Rect, Stop } from 'react-native-svg';

import type { PublishedCollectible } from '@/commerce/collectible-artwork';
import { CommerceApiError } from '@/commerce/commerce-api';
import { FullScreenModal } from '@/gamification/full-screen-modal';
import { useMotionEnabled } from '@/motion/use-motion';
import { colorsForScheme } from '@/theme/palette';
import { Mascot } from '@/ui/mascot';
import { StateScene } from '@/ui/state-scene';

import { collectibleMotionFrame } from './collectible-motion';

type Props = {
  entitlementId: string;
  merchantName: string;
  load: (entitlementId: string) => Promise<PublishedCollectible>;
  onClose: () => void;
};

/** Mounted for one acquired entitlement; closing it discards pending reads and playback. */
export function CollectibleDetail({ entitlementId, merchantName, load, onClose }: Props) {
  const [snapshot, setSnapshot] = useState<PublishedCollectible>();
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    void load(entitlementId).then((value) => {
      if (active) setSnapshot(value);
    }).catch((caught: unknown) => {
      if (!active) return;
      setError(caught instanceof CommerceApiError && caught.status === 404
        ? '이 수집품을 열 수 없어요. 도감의 보유 기록을 다시 확인해 주세요.'
        : '수집품을 불러오지 못했어요. 보유 기록은 그대로예요.');
    });
    return () => { active = false; };
  }, [entitlementId, load, retry]);

  return (
    <FullScreenModal visible animationType="fade" onRequestClose={onClose}>
      {snapshot ? <DetailBody key={`${snapshot.publicationId}:${snapshot.gradeId}`} snapshot={snapshot} merchantName={merchantName} onClose={onClose} /> : (
        <DetailFrame>
          <StateScene kind={error ? 'error' : 'loading'} title={error ? '수집품을 열지 못했어요' : '가게 수집품을 펼치는 중'} body={error}
            action={error ? { label: '다시 불러오기', onPress: () => { setError(undefined); setRetry((value) => value + 1); } } : undefined} />
          <Control label="도감으로 돌아가기" onPress={onClose} />
        </DetailFrame>
      )}
    </FullScreenModal>
  );
}

function DetailFrame({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const palette = colorsForScheme(useColorScheme());
  return <ScrollView style={{ flex: 1, backgroundColor: palette.background }} contentContainerStyle={[styles.body, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 28 }]}>{children}</ScrollView>;
}

function Control({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  const palette = colorsForScheme(useColorScheme());
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
    style={[styles.control, { backgroundColor: palette.primaryContainer, opacity: disabled ? .5 : 1 }]}>
    <Text style={[styles.controlText, { color: palette.onPrimaryContainer }]}>{label}</Text>
  </Pressable>;
}

function DetailBody({ snapshot, merchantName, onClose }: { snapshot: PublishedCollectible; merchantName: string; onClose: () => void }) {
  const palette = colorsForScheme(useColorScheme());
  const { width } = useWindowDimensions();
  const size = Math.max(160, Math.min(360, width - 48));
  const motionAllowed = useMotionEnabled();
  const [reduceMotion, setReduceMotion] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [activeAnimation, setActiveAnimation] = useState(snapshot.animation);
  const [animationTime, setAnimationTime] = useState(0);
  const [animationReplay, setAnimationReplay] = useState(0);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [angle, setAngle] = useState(snapshot.angle);
  const [draftAngle, setDraftAngle] = useState(snapshot.angle);
  const [dragging, setDragging] = useState(false);
  const [trackWidth, setTrackWidth] = useState(240);
  const [scene, setScene] = useState(false);
  const [sceneProgress, setSceneProgress] = useState(0);
  const [sceneReplay, setSceneReplay] = useState(0);
  const [muted, setMuted] = useState(false);
  const [audioError, setAudioError] = useState<string>();
  const [imageFailed, setImageFailed] = useState(false);
  const player = useAudioPlayer(snapshot.audio ? { uri: snapshot.audio.dataUrl } : null);
  const audioStatus = useAudioPlayerStatus(player);
  const alive = useRef(true);
  const audioAction = useRef(0);
  const gesture = useRef({ initialX: 0, width: 240, angle: snapshot.angle });
  const angleRef = useRef(snapshot.angle);
  const moving = motionAllowed && !reduceMotion && foreground;

  const pause = useCallback(() => {
    audioAction.current += 1;
    setPlaying(false);
    setScene(false);
    try { player.pause(); } catch { /* Hook may already have released a player on unmount. */ }
  }, [player]);

  useEffect(() => {
    alive.current = true;
    const listener = AppState.addEventListener('change', (state) => {
      setForeground(state === 'active');
      if (state !== 'active') pause();
    });
    return () => {
      alive.current = false;
      audioAction.current += 1;
      listener.remove();
      try { player.pause(); } catch { /* useAudioPlayer owns release. */ }
    };
  }, [pause, player]);

  useEffect(() => {
    if (moving) return;
    const timer = setTimeout(() => setPlaying(false), 0);
    return () => clearTimeout(timer);
  }, [moving]);

  useEffect(() => {
    if (!playing || !moving || dragging || scene) return;
    const started = Date.now();
    const startAngle = angleRef.current;
    const timer = setInterval(() => {
      const now = Date.now();
      setAnimationTime(now - started);
      if (activeAnimation === 'rotate') {
        angleRef.current = ((startAngle + (now - started) / 90 + 180) % 360) - 180;
        setAngle(angleRef.current);
        setDraftAngle(angleRef.current);
        gesture.current.angle = angleRef.current;
      }
    }, 60);
    return () => clearInterval(timer);
  }, [playing, moving, dragging, scene, activeAnimation, animationReplay]);

  useEffect(() => {
    if (!scene) return;
    if (!moving) return;
    const started = Date.now();
    const timer = setInterval(() => {
      const progress = Math.min(1, (Date.now() - started) / 6000);
      setSceneProgress(progress);
      if (progress === 1) { clearInterval(timer); setScene(false); }
    }, 60);
    return () => clearInterval(timer);
  }, [scene, moving, sceneReplay]);

  const setDraft = useCallback((x: number) => {
    const value = Math.round(Math.max(-180, Math.min(180, x / gesture.current.width * 360 - 180)));
    gesture.current.angle = value;
    setDraftAngle(value);
  }, []);
  // PanResponder registers these functions; it reads refs only during native gesture events.
  // eslint-disable-next-line react-hooks/refs
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) => {
      setPlaying(false); setScene(false); setDragging(true);
      gesture.current.initialX = event.nativeEvent.locationX;
      setDraft(gesture.current.initialX);
    },
    onPanResponderMove: (_event, state) => setDraft(gesture.current.initialX + state.dx),
    onPanResponderRelease: () => {
      angleRef.current = gesture.current.angle;
      setAngle(gesture.current.angle); setDragging(false);
    },
    onPanResponderTerminate: () => {
      gesture.current.angle = angleRef.current;
      setDraftAngle(angleRef.current); setDragging(false);
    },
  }), [setDraft]);

  const stepAngle = (increment: number) => {
    setPlaying(false); setScene(false);
    const value = Math.max(-180, Math.min(180, angleRef.current + increment));
    angleRef.current = value; gesture.current.angle = value;
    setAngle(value); setDraftAngle(value);
  };
  const replayAudio = async () => {
    if (muted || !snapshot.audio || !foreground) return;
    const currentAction = ++audioAction.current;
    setAudioError(undefined);
    try {
      await setAudioModeAsync({ shouldPlayInBackground: false, allowsRecording: false });
      await player.seekTo(0);
      if (alive.current && currentAction === audioAction.current) player.play();
    } catch {
      if (alive.current && currentAction === audioAction.current) setAudioError('음성을 재생하지 못했어요. 아래 대사는 읽을 수 있어요.');
    }
  };
  const close = () => { pause(); onClose(); };
  const radians = angle * Math.PI / 180;
  const scaleX = Math.max(.04, Math.abs(Math.cos(radians)));
  const depth = Math.abs(Math.sin(radians)) * snapshot.thickness * size / 512;
  const reverse = Math.cos(radians) < 0;
  const picture = imageFailed ? snapshot.thumbnailDataUrl : snapshot.imageDataUrl;
  const animationFrame = collectibleMotionFrame(playing && moving ? activeAnimation : 'still', animationTime, size);
  const frames = snapshot.story.frames;
  const shownProgress = moving ? sceneProgress : .75;
  const frameIndex = Math.min(frames.length - 1, Math.floor(shownProgress * frames.length));
  const sceneUri = snapshot.story.type === 'zoom' ? snapshot.imageDataUrl : frames[frameIndex]?.dataUrl ?? snapshot.imageDataUrl;
  const sceneScale = snapshot.story.type === 'zoom' ? 1 + shownProgress * .55 : snapshot.story.type === 'wide' ? 1.55 - shownProgress * .55 : 1;
  const scenePan = snapshot.story.type === 'follow' ? Math.sin(shownProgress * Math.PI) * size * .07 : 0;

  return (
    <DetailFrame>
      <Text accessibilityRole="header" style={[styles.title, { color: palette.label }]}>{snapshot.name}</Text>
      <Text selectable style={[styles.meta, { color: palette.secondaryLabel }]}>{merchantName} · {snapshot.gradeName} · {snapshot.theme.name}</Text>
      <View style={[styles.stage, { width: size, height: size, backgroundColor: palette.surface }]}>
        {scene ? (
          <>
            <Image source={{ uri: sceneUri }} resizeMode="cover" accessibilityLabel={`${merchantName} 가게 이야기`}
              style={{ width: size, height: size, transform: [{ scale: sceneScale }, { translateX: scenePan }] }} />
            {snapshot.story.type === 'follow' ? <View style={{ position: 'absolute', left: size * (.1 + shownProgress * .65), bottom: size * .1 }}><Mascot pose="wave" size={size * .16} breathe={false} /></View> : null}
          </>
        ) : (
          <View style={{ width: size, height: size, transform: [{ translateY: animationFrame.lift }, { scale: animationFrame.scale }] }} accessible accessibilityLabel={`${snapshot.gradeName} ${shapeName(snapshot.shape)}, 두께 ${snapshot.thickness}, 각도 ${Math.round(angle)}도`}>
            {[1, .8, .6, .4, .2].map((fraction) => <Image key={fraction} source={{ uri: picture }} resizeMode="contain" accessible={false}
              style={{ position: 'absolute', width: size * .82, height: size * .82, top: size * .09, left: size * .09 + depth * fraction, tintColor: '#765931', transform: [{ scaleX }] }} />)}
            <Image source={{ uri: picture }} resizeMode="contain" accessible={false} onError={() => setImageFailed(true)}
              style={{ position: 'absolute', width: size * .82, height: size * .82, top: size * .09, left: size * .09, tintColor: reverse ? '#bf8149' : undefined, transform: [{ scaleX }] }} />
            {reverse ? <Text style={{ position: 'absolute', top: size * .46, left: size * .18, width: size * .64, textAlign: 'center', color: palette.label, fontWeight: '700' }}>{merchantName}</Text> : null}
            {animationFrame.light && !reverse ? <Svg pointerEvents="none" width={size * .82} height={size * .82} style={{ position: 'absolute', top: size * .09, left: size * .09, transform: [{ scaleX }] }}>
              <Defs>
                <Mask id="collectible-light-mask" maskType="alpha"><SvgImage href={{ uri: picture }} width={size * .82} height={size * .82} /></Mask>
                <LinearGradient id="collectible-light" x1={animationFrame.lightX} y1={0} x2={animationFrame.lightX + size * .28} y2={0} gradientUnits="userSpaceOnUse">
                  <Stop offset="0" stopColor="#fff" stopOpacity="0" /><Stop offset=".5" stopColor="#fff" stopOpacity="1" /><Stop offset="1" stopColor="#fff" stopOpacity="0" />
                </LinearGradient>
              </Defs>
              <Rect width={size * .82} height={size * .82} fill="url(#collectible-light)" mask="url(#collectible-light-mask)" opacity={animationFrame.lightOpacity} />
            </Svg> : null}
            {animationFrame.particles ? Array.from({ length: 15 }, (_, index) => <View key={index} pointerEvents="none" style={{ position: 'absolute', width: 4, height: 6,
              left: size / 2 + Math.sin(index * 7) * size * .42 * animationFrame.particlePhase,
              top: size / 2 + Math.cos(index * 3) * size * .42 * animationFrame.particlePhase + animationFrame.particlePhase ** 2 * size * .3,
              backgroundColor: ['#d89944', '#56ab8e', '#b475b8'][index % 3], transform: [{ rotate: `${index * 23}deg` }] }} />) : null}
          </View>
        )}
      </View>
      {!scene ? <>
        <Text style={[styles.meta, { color: palette.label }]}>각도 {Math.round(draftAngle)}° · 두께 {snapshot.thickness}</Text>
        <View {...responder.panHandlers} accessibilityRole="adjustable" accessibilityLabel="수집품 회전 각도"
          accessibilityValue={{ min: -180, max: 180, now: Math.round(draftAngle), text: `${Math.round(draftAngle)}도` }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(event) => stepAngle(event.nativeEvent.actionName === 'increment' ? 15 : -15)}
          onLayout={(event) => { gesture.current.width = event.nativeEvent.layout.width; setTrackWidth(event.nativeEvent.layout.width); }}
          style={[styles.slider, { backgroundColor: palette.surface }]}>
          <View pointerEvents="none" style={[styles.track, { backgroundColor: palette.separator }]} />
          <View pointerEvents="none" style={[styles.thumb, { backgroundColor: palette.primary, left: Math.max(0, Math.min(trackWidth - 24, (draftAngle + 180) / 360 * trackWidth - 12)) }]} />
        </View>
        <Text style={[styles.meta, { color: palette.secondaryLabel }]}>놓으면 수집품의 각도가 바뀌어요.</Text>
        <View style={styles.controls}>
          <Control label="왼쪽으로 15도" onPress={() => stepAngle(-15)} />
          <Control label="오른쪽으로 15도" onPress={() => stepAngle(15)} />
          <Control label={playing ? '동작 정지' : '천천히 회전'} disabled={!moving} onPress={() => { setActiveAnimation('rotate'); setAnimationTime(0); setPlaying((value) => !value); }} />
          <Control label={snapshot.animation === 'still' ? '정지 동작' : '설정한 동작 다시 보기'} disabled={!moving || snapshot.animation === 'still'}
            onPress={() => { setActiveAnimation(snapshot.animation); setAnimationTime(0); setAnimationReplay((value) => value + 1); setPlaying(true); }} />
          <Control label="정면 다시 보기" onPress={() => { pause(); stepAngle(-angleRef.current); }} />
        </View>
      </> : null}
      <View style={styles.toggle}><Text style={[styles.controlText, { color: palette.label }]}>동작 줄이기</Text><Switch accessibilityLabel="수집품 동작 줄이기" value={reduceMotion || !motionAllowed} disabled={!motionAllowed} onValueChange={setReduceMotion} /></View>
      {snapshot.greeting ? <Text selectable style={[styles.greeting, { color: palette.label }]}>{snapshot.greeting}</Text> : null}
      {snapshot.audio ? <>
        <View style={styles.toggle}><Text style={[styles.controlText, { color: palette.label }]}>소리 끄기</Text><Switch accessibilityLabel="사장님 음성 소리 끄기" value={muted} onValueChange={(value) => { audioAction.current += 1; player.pause(); setMuted(value); }} /></View>
        <View style={styles.controls}>
          <Control label={audioStatus.playing ? '다시 듣기' : '사장님 음성 듣기'} disabled={muted || !foreground} onPress={() => { void replayAudio(); }} />
          <Control label="음성 중단" onPress={() => { audioAction.current += 1; player.pause(); }} />
        </View>
        {audioError ? <Text accessibilityLiveRegion="polite" style={{ color: palette.onErrorContainer }}>{audioError}</Text> : null}
      </> : null}
      {snapshot.story.type !== 'none' ? <View style={styles.controls}>
        <Control label="가게 이야기 다시 보기" onPress={() => { pause(); setSceneProgress(0); setSceneReplay((value) => value + 1); setScene(true); }} />
        {scene ? <Control label="장면 건너뛰기" onPress={pause} /> : null}
      </View> : null}
      <Text style={[styles.meta, { color: palette.secondaryLabel }]}>이 수집품은 도감에 보관되어 있어요.</Text>
      <Control label="도감으로 돌아가기" onPress={close} />
    </DetailFrame>
  );
}

function shapeName(shape: PublishedCollectible['shape']) {
  return { circle: '원형 동전', stamp: '우표', serrated: '뾰족한 톱니' }[shape];
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 24, gap: 16, alignItems: 'stretch' },
  title: { fontSize: 25, fontWeight: '900' },
  meta: { fontSize: 13, lineHeight: 20 },
  stage: { alignSelf: 'center', justifyContent: 'center', alignItems: 'center', borderRadius: 22, overflow: 'hidden' },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  control: { minHeight: 48, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  controlText: { fontSize: 14, fontWeight: '700' },
  slider: { height: 48, borderRadius: 14, justifyContent: 'center' },
  track: { height: 4, borderRadius: 4 },
  thumb: { position: 'absolute', width: 24, height: 24, borderRadius: 12, top: 12 },
  toggle: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  greeting: { fontSize: 19, lineHeight: 28 },
});
