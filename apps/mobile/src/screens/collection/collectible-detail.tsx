import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Image, PanResponder, Pressable, ScrollView, StyleSheet, Switch, Text, View, useColorScheme, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, Image as SvgImage, LinearGradient, Mask, Rect, Stop } from 'react-native-svg';

import type { CollectibleAngleFrames, CollectibleLiving, PublishedCollectible } from '@/commerce/collectible-artwork';
import { FullScreenModal } from '@/gamification/full-screen-modal';
import { useMotionEnabled } from '@/motion/use-motion';
import { colorsForScheme } from '@/theme/palette';
import { Mascot } from '@/ui/mascot';
import { StateScene } from '@/ui/state-scene';

import { collectibleDetailFailure, type CollectibleDetailFailure } from './collectible-detail-state';
import { angleFrameBlend, collectibleMotionFrame, livingCell, motionAutoplaySequence, onceMotionTypes, ONCE_MS, particleAt } from './collectible-motion';
import { TiltSensor } from './collectible-tilt';

type Props = {
  entitlementId: string;
  merchantName: string;
  load: (entitlementId: string) => Promise<PublishedCollectible>;
  onClose: () => void;
  /** 게시 사진이 내려가 상세가 없었다면(404) 닫을 때 불러, 목록이 같은 수집품을 사진 없는 기존 카드로 다시 그리게 한다. */
  onUnavailable?: () => void;
  /** 방문 수령 직후 열렸는지(#283 reveal → "상세 보기"). true면 once 모션을 먼저 보여준 뒤 loop로 넘어가고, 그 외엔 loop만 자동재생한다. */
  intro?: boolean;
};

/** 각도 프레임 스프라이트 한 칸을 얼굴 크기로 잘라 보여준다. 두 칸을 겹쳐 opacity로 섞으면 크로스페이드가 된다. */
function SpriteCell({ frames, index, faceSize, opacity }: { frames: CollectibleAngleFrames; index: number; faceSize: number; opacity: number }) {
  const col = index % frames.columns;
  const row = Math.floor(index / frames.columns);
  const rows = Math.ceil(frames.count / frames.columns);
  return (
    <View pointerEvents="none" style={{ position: 'absolute', width: faceSize, height: faceSize, overflow: 'hidden', opacity }}>
      <Image source={{ uri: frames.dataUrl }} resizeMode="stretch"
        style={{ position: 'absolute', width: faceSize * frames.columns, height: faceSize * rows, left: -col * faceSize, top: -row * faceSize }} />
    </View>
  );
}

/** Living picture 스프라이트를 box(얼굴 0..1 좌표) 안에 잘라 보여준다. */
function LivingOverlay({ living, cell, faceSize, faceTop, faceLeft, scaleX }: { living: CollectibleLiving; cell: number; faceSize: number; faceTop: number; faceLeft: number; scaleX: number }) {
  const col = cell % living.columns;
  const row = Math.floor(cell / living.columns);
  const rows = Math.ceil(living.count / living.columns);
  const boxWidth = living.box.w * faceSize;
  const boxHeight = living.box.h * faceSize;
  const cellScaleX = boxWidth / living.cellWidth;
  const cellScaleY = boxHeight / living.cellHeight;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: faceLeft + living.box.x * faceSize, top: faceTop + living.box.y * faceSize,
      width: boxWidth, height: boxHeight, overflow: 'hidden', transform: [{ scaleX }] }}>
      <Image source={{ uri: living.dataUrl }} resizeMode="stretch"
        style={{ position: 'absolute', width: living.cellWidth * living.columns * cellScaleX, height: living.cellHeight * rows * cellScaleY,
          left: -col * living.cellWidth * cellScaleX, top: -row * living.cellHeight * cellScaleY }} />
    </View>
  );
}

/** Mounted for one acquired entitlement; closing it discards pending reads and playback. */
export function CollectibleDetail({ entitlementId, merchantName, load, onClose, onUnavailable, intro = false }: Props) {
  const [snapshot, setSnapshot] = useState<PublishedCollectible>();
  const [failure, setFailure] = useState<CollectibleDetailFailure>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    void load(entitlementId).then((value) => {
      if (active) setSnapshot(value);
    }).catch((caught: unknown) => {
      if (!active) return;
      setFailure(collectibleDetailFailure(caught));
    });
    return () => { active = false; };
  }, [entitlementId, load, retry]);
  // 사진이 내려간 수집품이면 닫을 때 목록을 다시 읽어 사진 없는 기존 카드로 보이게 한다. 여기서 부르면 effect가 다시 돌 수 있다.
  const close = () => { if (failure?.removed) onUnavailable?.(); onClose(); };

  return (
    <FullScreenModal visible animationType="fade" onRequestClose={close}>
      {snapshot ? <DetailBody key={`${snapshot.publicationId}:${snapshot.gradeId}`} snapshot={snapshot} merchantName={merchantName} intro={intro} onClose={onClose} /> : (
        <DetailFrame>
          <StateScene kind={failure ? (failure.removed ? 'empty' : 'error') : 'loading'} title={failure ? failure.title : '가게 수집품을 펼치는 중'} body={failure?.body}
            action={failure && !failure.removed ? { label: '다시 불러오기', onPress: () => { setFailure(undefined); setRetry((value) => value + 1); } } : undefined} />
          <Control label="도감으로 돌아가기" onPress={close} />
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

function DetailBody({ snapshot, merchantName, intro = false, onClose }: { snapshot: PublishedCollectible; merchantName: string; intro?: boolean; onClose: () => void }) {
  const palette = colorsForScheme(useColorScheme());
  const { width } = useWindowDimensions();
  const size = Math.max(160, Math.min(360, width - 48));
  const motionAllowed = useMotionEnabled();
  const [reduceMotion, setReduceMotion] = useState(false);
  const [tiltOn, setTiltOn] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [activeAnimation, setActiveAnimation] = useState(snapshot.animation);
  const [animationTime, setAnimationTime] = useState(0);
  const [animationReplay, setAnimationReplay] = useState(0);
  // Living picture의 칸을 고르는 벽시계; dragging·scene과 무관하게 moving이면 계속 돈다(동작 줄이기면 0에 고정).
  const [clock, setClock] = useState(0);
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

  // 회전 애니메이션·가게 이야기 장면·living picture 칸을 모두 이 하나의 60ms 티커가 몬다(예전엔 인터벌이 둘이었다).
  useEffect(() => {
    if (!moving) return;
    const started = Date.now();
    const startAngle = angleRef.current;
    const timer = setInterval(() => {
      const elapsed = Date.now() - started;
      setClock(elapsed);
      if (scene) {
        const progress = Math.min(1, elapsed / 6000);
        setSceneProgress(progress);
        if (progress === 1) { clearInterval(timer); setScene(false); }
        return;
      }
      if (playing && !dragging) {
        setAnimationTime(elapsed);
        if (activeAnimation === 'rotate') {
          angleRef.current = ((startAngle + elapsed / 90 + 180) % 360) - 180;
          setAngle(angleRef.current);
          setDraftAngle(angleRef.current);
          gesture.current.angle = angleRef.current;
        }
      }
    }, 60);
    return () => clearInterval(timer);
  }, [playing, moving, dragging, scene, activeAnimation, animationReplay, sceneReplay]);

  // 획득 직후(intro)엔 once 모션을 순서대로 보여준 뒤 loop 모션, 나중에 열면 loop 모션만 자동재생한다.
  const sequenceTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const playMotionSequence = useCallback((types: readonly string[]) => {
    clearTimeout(sequenceTimeout.current);
    if (types.length === 0 || !moving) return;
    let index = 0;
    const step = () => {
      const type = types[index];
      if (!type) return;
      setActiveAnimation(type);
      setAnimationTime(0);
      setAnimationReplay((value) => value + 1);
      setPlaying(true);
      index += 1;
      if (index < types.length) sequenceTimeout.current = setTimeout(step, ONCE_MS[type] ?? 2000);
    };
    step();
  }, [moving]);
  useEffect(() => {
    playMotionSequence(motionAutoplaySequence(snapshot.motions, intro));
    return () => clearTimeout(sequenceTimeout.current);
  }, [playMotionSequence, snapshot.motions, intro]);
  const onceTypes = onceMotionTypes(snapshot.motions);
  const replayOnceMotions = useCallback(() => { playMotionSequence(onceTypes); }, [playMotionSequence, onceTypes]);

  const handleTiltChange = useCallback((degrees: number) => {
    setPlaying(false); setScene(false);
    angleRef.current = degrees; gesture.current.angle = degrees;
    setAngle(degrees); setDraftAngle(degrees);
  }, []);

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
  const displayFace = size * .82;
  const frameBlend = snapshot.angleFrames ? angleFrameBlend(angle) : undefined;
  const showFrames = !reverse && snapshot.angleFrames && frameBlend && !frameBlend.back;
  const livingClock = moving ? clock : 0;
  const activeMotionParticle = snapshot.motions?.find((motion) => motion.type === activeAnimation)?.particle;
  const tiltActive = tiltOn && moving;

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
              style={{ position: 'absolute', width: displayFace, height: displayFace, top: size * .09, left: size * .09 + depth * fraction, tintColor: '#765931', transform: [{ scaleX }] }} />)}
            {reverse ? (
              snapshot.backImageDataUrl ? (
                <Image source={{ uri: snapshot.backImageDataUrl }} resizeMode="contain" accessible={false}
                  style={{ position: 'absolute', width: displayFace, height: displayFace, top: size * .09, left: size * .09, transform: [{ scaleX }] }} />
              ) : (
                <>
                  <Image source={{ uri: picture }} resizeMode="contain" accessible={false} onError={() => setImageFailed(true)}
                    style={{ position: 'absolute', width: displayFace, height: displayFace, top: size * .09, left: size * .09, tintColor: '#bf8149', transform: [{ scaleX }] }} />
                  <Text style={{ position: 'absolute', top: size * .46, left: size * .18, width: size * .64, textAlign: 'center', color: palette.label, fontWeight: '700' }}>{merchantName}</Text>
                </>
              )
            ) : showFrames && frameBlend && !frameBlend.back && snapshot.angleFrames ? (
              <View style={{ position: 'absolute', width: displayFace, height: displayFace, top: size * .09, left: size * .09, overflow: 'hidden', transform: [{ scaleX }] }}>
                <SpriteCell frames={snapshot.angleFrames} index={frameBlend.index} faceSize={displayFace} opacity={1 - frameBlend.blend} />
                {frameBlend.blend > 0 ? <SpriteCell frames={snapshot.angleFrames} index={frameBlend.next} faceSize={displayFace} opacity={frameBlend.blend} /> : null}
              </View>
            ) : (
              <Image source={{ uri: picture }} resizeMode="contain" accessible={false} onError={() => setImageFailed(true)}
                style={{ position: 'absolute', width: displayFace, height: displayFace, top: size * .09, left: size * .09, transform: [{ scaleX }] }} />
            )}
            {!reverse && snapshot.living ? <LivingOverlay living={snapshot.living} cell={livingCell(livingClock, snapshot.living.periodMs, snapshot.living.count)}
              faceSize={displayFace} faceTop={size * .09} faceLeft={size * .09} scaleX={scaleX} /> : null}
            {animationFrame.light && !reverse ? <Svg pointerEvents="none" width={displayFace} height={displayFace} style={{ position: 'absolute', top: size * .09, left: size * .09, transform: [{ scaleX }] }}>
              <Defs>
                <Mask id="collectible-light-mask" maskType="alpha"><SvgImage href={{ uri: picture }} width={displayFace} height={displayFace} /></Mask>
                <LinearGradient id="collectible-light" x1={animationFrame.lightX} y1={0} x2={animationFrame.lightX + size * .28} y2={0} gradientUnits="userSpaceOnUse">
                  <Stop offset="0" stopColor="#fff" stopOpacity="0" /><Stop offset=".5" stopColor="#fff" stopOpacity="1" /><Stop offset="1" stopColor="#fff" stopOpacity="0" />
                </LinearGradient>
              </Defs>
              <Rect width={displayFace} height={displayFace} fill="url(#collectible-light)" mask="url(#collectible-light-mask)" opacity={animationFrame.lightOpacity} />
            </Svg> : null}
            {animationFrame.particles ? Array.from({ length: 15 }, (_, index) => {
              const point = activeMotionParticle ? particleAt(activeMotionParticle, index, animationFrame.particlePhase) : undefined;
              return <View key={index} pointerEvents="none" style={{ position: 'absolute', width: 4, height: 6,
                left: size / 2 + (point ? point.x * size * .42 : Math.sin(index * 7) * size * .42 * animationFrame.particlePhase),
                top: size / 2 + (point ? point.y * size * .42 : Math.cos(index * 3) * size * .42 * animationFrame.particlePhase + animationFrame.particlePhase ** 2 * size * .3),
                backgroundColor: point ? point.color : ['#d89944', '#56ab8e', '#b475b8'][index % 3], transform: [{ rotate: `${index * 23}deg` }] }} />;
            }) : null}
          </View>
        )}
      </View>
      {tiltActive ? <TiltSensor onChange={handleTiltChange} /> : null}
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
          {onceTypes.length > 0 ? <Control label="획득 장면 다시 보기" disabled={!moving} onPress={replayOnceMotions} /> : null}
        </View>
      </> : null}
      <View style={styles.toggle}><Text style={[styles.controlText, { color: palette.label }]}>동작 줄이기</Text><Switch accessibilityLabel="수집품 동작 줄이기" value={reduceMotion || !motionAllowed} disabled={!motionAllowed} onValueChange={setReduceMotion} /></View>
      {motionAllowed && !reduceMotion ? <View style={styles.toggle}><Text style={[styles.controlText, { color: palette.label }]}>기울여 보기</Text>
        <Switch accessibilityLabel="수집품 기울여 보기" value={tiltOn} onValueChange={setTiltOn} /></View> : null}
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
