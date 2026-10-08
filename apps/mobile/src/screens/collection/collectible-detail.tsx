import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useRouter } from 'expo-router';
import { foregroundAudioMode } from '@/sound/playback-audio-mode';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { AppState, Image, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View, useColorScheme, useWindowDimensions, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { ClipPath, Defs, G, Image as SvgImage, LinearGradient, Mask, Rect, Stop } from 'react-native-svg';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { cancelAnimation, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';

import type { CollectibleAngleFrames, CollectibleLiving, CollectibleMotion, PublishedCollectible } from '@/commerce/collectible-artwork';
import { FullScreenModal } from '@/gamification/full-screen-modal';
import { publicDataDemoStoreName } from '@/merchant/public-data-demo-store';
import { useMotionEnabled } from '@/motion/use-motion';
import { colorsForScheme } from '@/theme/palette';
import { canUseTiltSensor } from '@/ui/can-use-tilt-sensor';
import { Mascot } from '@/ui/mascot';
import { StateScene } from '@/ui/state-scene';

import { CollectibleDefaultBack, CollectibleFaceOutline, CollectibleFaceShape, collectibleGradeColors, collectibleWebClipPath } from './collectible-default-back';
import { collectibleDetailFailure, type CollectibleDetailFailure } from './collectible-detail-state';
import type { CollectibleDetailInput, LegacyCollectibleDetail } from './legacy-collectible-detail';
import {
  angleFrameWebMask, angleFrameBlend, angleFrameOpacities, collectibleFace, collectibleEdgeOffset, collectibleMotionFrame, firstLoopMotion, livingCell, motionEntrySequence, motionSequenceEnd,
  onceMotions, ONCE_MS, particleAt,
} from './collectible-motion';
import { TiltSensor } from './collectible-tilt';
import { combineMaterialTilt, gradeMaterialFor } from './grade-material';
import { GradeMaterialLayer, useGradeMaterialClock } from './grade-material-layer';
import { GradeMaterialSensor } from './grade-material-sensor';

type Props = {
  entitlementId: string;
  merchantName: string;
  merchantId?: string;
  load: (entitlementId: string) => Promise<PublishedCollectible>;
  localDetail?: LegacyCollectibleDetail;
  onClose: () => void;
  onPlaceInStudio?: () => void;
  /** 게시 사진이 내려가 상세가 없었다면(404) 닫을 때 불러, 목록이 같은 수집품을 사진 없는 기존 카드로 다시 그리게 한다. */
  onUnavailable?: () => void;
  /** 방문 수령 직후 열렸는지(#283 reveal → "상세 보기"). true면 once 모션을 먼저 보여준 뒤 loop로 넘어가고, 그 외엔 loop만 자동재생한다. */
  intro?: boolean;
};

/** 각도 프레임 스프라이트 한 칸을 얼굴 크기로 잘라 보여준다. 두 칸을 겹쳐 opacity로 섞으면 크로스페이드가 된다. */
function SpriteCell({ frames, index, faceSize, opacity, shape }: { frames: CollectibleAngleFrames; index: number; faceSize: number; opacity: number; shape: string }) {
  const col = index % frames.columns;
  const row = Math.floor(index / frames.columns);
  const rows = Math.ceil(frames.count / frames.columns);
  const clipId = `sprite-face-${useId().replace(/:/g, '')}`;
  const isStamp = shape === 'stamp';
  const isSerrated = shape === 'serrated' || shape === 'gear';
  const insetX = isStamp ? .09 : isSerrated ? 0 : .04;
  const insetY = isStamp ? .04 : isSerrated ? 0 : .04;
  if (!isSerrated || Platform.OS === 'web') {
    return <View pointerEvents="none" style={{ position: 'absolute', left: faceSize * insetX, top: faceSize * insetY,
      width: faceSize * (1 - insetX * 2), height: faceSize * (1 - insetY * 2), opacity,
      overflow: 'hidden', borderRadius: isStamp ? faceSize * .06 : isSerrated ? 0 : faceSize * .46,
      ...(isSerrated ? { clipPath: collectibleWebClipPath(shape) } : {}) }}>
      <Image source={{ uri: frames.dataUrl }} resizeMode="stretch" accessible={false}
        style={{ position: 'absolute', width: faceSize * frames.columns, height: faceSize * rows,
          left: -col * faceSize - faceSize * insetX, top: -row * faceSize - faceSize * insetY }} />
    </View>;
  }
  return (
    <Svg pointerEvents="none" width={faceSize} height={faceSize} style={{ position: 'absolute', opacity }}>
      <Defs><ClipPath id={clipId}><G scale={faceSize / 100}><CollectibleFaceOutline shape={shape} fill="white" /></G></ClipPath></Defs>
      <G clipPath={`url(#${clipId})`}>
        <SvgImage href={{ uri: frames.dataUrl }} preserveAspectRatio="none"
          x={-col * faceSize} y={-row * faceSize} width={faceSize * frames.columns} height={faceSize * rows} />
      </G>
    </Svg>
  );
}

/** 게시 사진의 원본 비율과 무관하게 발행된 앞·뒷면의 같은 윤곽으로 자른다. */
function FaceImage({ uri, shape, size, onError }: { uri: string; shape: string; size: number; onError?: () => void }) {
  const clipId = `collectible-face-${useId().replace(/:/g, '')}`;
  const isStamp = shape === 'stamp';
  const isSerrated = shape === 'serrated' || shape === 'gear';
  const insetX = isStamp ? .09 : isSerrated ? 0 : .04;
  const insetY = isStamp ? .04 : isSerrated ? 0 : .04;
  const width = size * (1 - insetX * 2);
  const height = size * (1 - insetY * 2);
  const photo = <Image source={{ uri }} resizeMode="contain" onError={onError} accessible={false}
    style={{ position: 'absolute', width: size, height: size, left: -size * insetX, top: -size * insetY }} />;
  if (!isSerrated || Platform.OS === 'web') {
    return <View pointerEvents="none" style={{ position: 'absolute', left: size * insetX, top: size * insetY, width, height,
      overflow: 'hidden', borderRadius: isStamp ? size * .06 : isSerrated ? 0 : size * .46,
      ...(isSerrated ? { clipPath: collectibleWebClipPath(shape) } : {}) }}>
      {photo}
    </View>;
  }
  // 톱니 윤곽은 Android/iOS SVG 클립으로 보존한다. Web은 표준 CSS polygon을 사용한다.
  return <View pointerEvents="none" style={{ position: 'absolute', width: size, height: size }}>
    {onError ? <Image source={{ uri }} onError={onError} style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} /> : null}
    <Svg pointerEvents="none" width={size} height={size}>
    <Defs><ClipPath id={clipId}><G scale={size / 100}><CollectibleFaceOutline shape={shape} fill="white" /></G></ClipPath></Defs>
    <SvgImage href={{ uri }} width={size} height={size} preserveAspectRatio="xMidYMid meet" clipPath={`url(#${clipId})`} />
    </Svg>
  </View>;
}

/** 얼굴과 같은 스프라이트 좌표·섞음으로 조명을 자른다. 기본 사진의 윤곽을 대신 쓰지 않는다. */
function SpriteCellMask({ frames, index, faceSize, opacity }: { frames: CollectibleAngleFrames; index: number; faceSize: number; opacity: number }) {
  const rows = Math.ceil(frames.count / frames.columns);
  return <SvgImage href={{ uri: frames.dataUrl }} preserveAspectRatio="none" opacity={opacity}
    x={-(index % frames.columns) * faceSize} y={-Math.floor(index / frames.columns) * faceSize}
    width={faceSize * frames.columns} height={faceSize * rows} />;
}

/**
 * Living picture 스프라이트를 box(얼굴 0..1 좌표) 안에 잘라 보여준다. 이 box는 얼굴 전체가 아닌 일부 영역이라,
 * 자기 자신의 중심을 기준으로 scaleX를 걸면(box.x=0,w=.2인 왼쪽 조각이 60°에서 얼굴의 .1 지점에 와야 하는데 .3에
 * 머무는 식으로) 회전 중 어긋난다. 그래서 여기서는 변환을 걸지 않고, 얼굴과 같은 transform을 이미 두르고 있는
 * 부모 안에 상대 좌표로만 넣는다(WP4 리뷰 5) — 변환은 얼굴 전체를 감싼 부모가 공유해서 준다.
 */
function LivingOverlay({ living, cell, faceSize }: { living: CollectibleLiving; cell: number; faceSize: number }) {
  const col = cell % living.columns;
  const row = Math.floor(cell / living.columns);
  const rows = Math.ceil(living.count / living.columns);
  const boxWidth = living.box.w * faceSize;
  const boxHeight = living.box.h * faceSize;
  const cellScaleX = boxWidth / living.cellWidth;
  const cellScaleY = boxHeight / living.cellHeight;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: living.box.x * faceSize, top: living.box.y * faceSize,
      width: boxWidth, height: boxHeight, overflow: 'hidden' }}>
      <Image source={{ uri: living.dataUrl }} resizeMode="stretch"
        style={{ position: 'absolute', width: living.cellWidth * living.columns * cellScaleX, height: living.cellHeight * rows * cellScaleY,
          left: -col * living.cellWidth * cellScaleX, top: -row * living.cellHeight * cellScaleY }} />
    </View>
  );
}

/** Mounted for one acquired entitlement; closing it discards pending reads and playback. */
export function CollectibleDetail({ entitlementId, merchantId, merchantName, load, onClose, onUnavailable, localDetail, intro = false, onPlaceInStudio }: Props) {
  const [snapshot, setSnapshot] = useState<PublishedCollectible>();
  const [failure, setFailure] = useState<CollectibleDetailFailure>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (localDetail) return;
    let active = true;
    void load(entitlementId).then((value) => {
      if (active) setSnapshot(value);
    }).catch((caught: unknown) => {
      if (!active) return;
      setFailure(collectibleDetailFailure(caught));
    });
    return () => { active = false; };
  }, [entitlementId, load, retry, localDetail]);
  // 사진이 내려간 수집품이면 닫을 때 목록을 다시 읽어 사진 없는 기존 카드로 보이게 한다. 여기서 부르면 effect가 다시 돌 수 있다.
  const close = () => { if (failure?.removed) onUnavailable?.(); onClose(); };

  const shown = localDetail ?? snapshot;
  return (
    <FullScreenModal visible animationType="fade" onRequestClose={close}>
      {shown ? <DetailBody key={entitlementId} snapshot={shown} merchantId={merchantId} merchantName={merchantName} intro={intro} onClose={onClose} onPlaceInStudio={onPlaceInStudio} /> : (
        <DetailFrame>
          <StateScene kind={failure ? (failure.removed ? 'empty' : 'error') : 'loading'} title={failure ? failure.title : '가게 수집품을 펼치는 중'} body={failure?.body}
            action={failure && !failure.removed ? { label: '다시 불러오기', onPress: () => { setFailure(undefined); setRetry((value) => value + 1); } } : undefined} />
          <Control label="도감으로 돌아가기" onPress={close} />
        </DetailFrame>
      )}
    </FullScreenModal>
  );
}

function DetailFrame({ children, onLayout, onScroll }: { children: React.ReactNode; onLayout?: (event: LayoutChangeEvent) => void; onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void }) {
  const insets = useSafeAreaInsets();
  const palette = colorsForScheme(useColorScheme());
  // 상세는 전체 화면 Modal 안이라 앱 루트의 제스처 루트가 닿지 않는다. 카드 끌기 조명(GestureDetector)을 위해 여기에 다시 둔다.
  return <GestureHandlerRootView style={{ flex: 1 }}>
    <ScrollView style={{ flex: 1, backgroundColor: palette.background }} contentContainerStyle={[styles.body, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 28 }]}
      onLayout={onLayout} onScroll={onScroll} scrollEventThrottle={32}>{children}</ScrollView>
  </GestureHandlerRootView>;
}

function Control({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  const palette = colorsForScheme(useColorScheme());
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
    style={[styles.control, { backgroundColor: palette.primaryContainer, opacity: disabled ? .5 : 1 }]}>
    <Text style={[styles.controlText, { color: palette.onPrimaryContainer }]}>{label}</Text>
  </Pressable>;
}

function DetailBody({ snapshot, merchantId, merchantName, intro = false, onClose, onPlaceInStudio }: { snapshot: CollectibleDetailInput; merchantId?: string; merchantName: string; intro?: boolean; onClose: () => void; onPlaceInStudio?: () => void }) {
  const router = useRouter();
  const scheme = useColorScheme();
  const palette = colorsForScheme(scheme);
  const gradeColors = collectibleGradeColors(snapshot.gradeId, snapshot.gradeName, scheme);
  const { width } = useWindowDimensions();
  const size = Math.max(160, Math.min(360, width - 48));
  const motionAllowed = useMotionEnabled();
  const [reduceMotion, setReduceMotion] = useState(false);
  const [tiltOn, setTiltOn] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [activeAnimation, setActiveAnimation] = useState(snapshot.animation);
  const [activeMotion, setActiveMotion] = useState<CollectibleMotion | undefined>(undefined);
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
  const [cardVisible, setCardVisible] = useState(true);
  const cardVisibleRef = useRef(true);
  const cardViewport = useRef({ y: 0, height: 0, scrollY: 0, viewportHeight: 0 });
  const updateCardVisibility = useCallback(() => {
    const { y, height, scrollY, viewportHeight } = cardViewport.current;
    if (!height || !viewportHeight) return;
    const intersects = y < scrollY + viewportHeight && y + height > scrollY;
    if (cardVisibleRef.current === intersects) return;
    cardVisibleRef.current = intersects;
    setCardVisible(intersects);
  }, []);
  const onCardLayout = useCallback((event: LayoutChangeEvent) => {
    cardViewport.current.y = event.nativeEvent.layout.y;
    cardViewport.current.height = event.nativeEvent.layout.height;
    updateCardVisibility();
  }, [updateCardVisibility]);
  const onViewportLayout = useCallback((event: LayoutChangeEvent) => {
    cardViewport.current.viewportHeight = event.nativeEvent.layout.height;
    updateCardVisibility();
  }, [updateCardVisibility]);
  const onDetailScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    cardViewport.current.scrollY = event.nativeEvent.contentOffset.y;
    updateCardVisibility();
  }, [updateCardVisibility]);
  const player = useAudioPlayer(snapshot.audio ? { uri: snapshot.audio.dataUrl } : null);
  const audioStatus = useAudioPlayerStatus(player);
  const alive = useRef(true);
  const audioAction = useRef(0);
  const gesture = useRef({ initialX: 0, width: 240, angle: snapshot.angle });
  const angleRef = useRef(snapshot.angle);
  const moving = motionAllowed && !reduceMotion && foreground;
  const material = gradeMaterialFor(snapshot.gradeId, snapshot.gradeName);
  const lightClipId = `collectible-light-outline-${useId().replace(/:/g, '')}`;
  const materialActive = moving && !scene && cardVisible;
  const materialClock = useGradeMaterialClock(materialActive);
  const materialAngle = useSharedValue(snapshot.angle);
  const dragLight = useSharedValue({ x: 0, y: 0 });
  const gravityLight = useSharedValue({ x: 0, y: 0 });
  const materialTilt = useDerivedValue(() => combineMaterialTilt(materialAngle.get(), dragLight.get(), gravityLight.get()));
  useEffect(() => { materialAngle.set(dragging ? draftAngle : angle); }, [angle, draftAngle, dragging, materialAngle]);
  useEffect(() => {
    if (!materialActive) {
      cancelAnimation(dragLight);
      dragLight.set({ x: 0, y: 0 });
    }
    return () => cancelAnimation(dragLight);
  }, [materialActive, dragLight]);
  // 카드를 끄는 손가락은 빛만 밀고 기존 회전 슬라이더의 면 전환은 바꾸지 않는다.
  const materialGesture = useMemo(() => Gesture.Pan().activeOffsetX([-16, 16]).failOffsetY([-6, 6]).enabled(materialActive)
    .onUpdate((event) => {
      dragLight.set({ x: Math.max(-1, Math.min(1, event.translationX / size * 2)),
        y: Math.max(-1, Math.min(1, event.translationY / size * 2)) });
    }).onFinalize(() => { dragLight.set(withTiming({ x: 0, y: 0 }, { duration: 240 })); }), [dragLight, materialActive, size]);

  // 획득 직후(intro)엔 once 모션을 순서대로 보여준 뒤 loop 모션, 나중에 열면 loop 모션만 자동재생한다.
  const sequenceTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // 각도 슬라이더를 끌거나 동작을 멈추는 등 사람이 직접 조작하면, 예약돼 있던 다음 자동재생 단계를 지운다
  // (WP4 리뷰 2) — 안 지우면 잠시 뒤 자동재생이 멋대로 되돌아온다.
  const cancelSequence = useCallback(() => clearTimeout(sequenceTimeout.current), []);

  const pause = useCallback(() => {
    audioAction.current += 1;
    cancelSequence();
    setPlaying(false);
    setScene(false);
    try { player.pause(); } catch { /* Hook may already have released a player on unmount. */ }
  }, [cancelSequence, player]);

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

  const playMotionSequence = useCallback((sequence: readonly CollectibleMotion[]) => {
    cancelSequence();
    if (sequence.length === 0 || !moving) return;
    let index = 0;
    const step = () => {
      const motion = sequence[index];
      if (!motion) return;
      setActiveAnimation(motion.type);
      setActiveMotion(motion);
      setAnimationTime(0);
      setAnimationReplay((value) => value + 1);
      setPlaying(true);
      index += 1;
      const holdMs = ONCE_MS[motion.type] ?? 2000;
      if (index < sequence.length) { sequenceTimeout.current = setTimeout(step, holdMs); return; }
      // 시퀀스의 마지막 단계가 끝난 뒤: once로 끝났다면 설정된 loop 모션으로 넘어가거나(없으면 멈춘다).
      // 이미 loop 자신으로 끝났다면(연속 재생 중) 더 할 일이 없다(WP4 리뷰 1).
      const end = motionSequenceEnd(sequence, firstLoopMotion(snapshot.motions));
      if (end.action === 'stop') sequenceTimeout.current = setTimeout(() => setPlaying(false), holdMs);
      if (end.action === 'loop') sequenceTimeout.current = setTimeout(() => {
        setActiveAnimation(end.motion.type); setActiveMotion(end.motion);
        setAnimationTime(0); setAnimationReplay((value) => value + 1); setPlaying(true);
      }, holdMs);
    };
    step();
  }, [cancelSequence, moving, snapshot.motions]);
  // 전경 복귀·동작 줄이기 토글로 이 effect가 다시 돌 때는(playMotionSequence 재생성) 이미 보여준 once 시퀀스를
  // 다시 틀지 않는다 — 첫 진입과 명시적 "획득 장면 다시 보기"에서만 보여준다(WP4 리뷰 3).
  const introConsumed = useRef(false);
  useEffect(() => {
    const consumed = introConsumed.current;
    introConsumed.current = true;
    playMotionSequence(motionEntrySequence(snapshot.motions, intro, consumed));
    return () => cancelSequence();
  }, [playMotionSequence, snapshot.motions, intro, cancelSequence]);
  const onceList = onceMotions(snapshot.motions);
  const replayOnceMotions = useCallback(() => { playMotionSequence(onceList); }, [playMotionSequence, onceList]);

  const handleTiltChange = useCallback((degrees: number) => {
    cancelSequence();
    setPlaying(false); setScene(false);
    angleRef.current = degrees; gesture.current.angle = degrees;
    setAngle(degrees); setDraftAngle(degrees);
  }, [cancelSequence]);

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
      cancelSequence();
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
  }), [cancelSequence, setDraft]);

  const stepAngle = (increment: number) => {
    cancelSequence();
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
      await setAudioModeAsync(foregroundAudioMode);
      await player.seekTo(0);
      if (alive.current && currentAction === audioAction.current) player.play();
    } catch {
      if (alive.current && currentAction === audioAction.current) setAudioError('음성을 재생하지 못했어요. 아래 대사는 읽을 수 있어요.');
    }
  };
  const close = () => { pause(); onClose(); };
  const radians = angle * Math.PI / 180;
  const scaleX = Math.max(.04, Math.abs(Math.cos(radians)));
  const depth = collectibleEdgeOffset(angle, snapshot.thickness * size / 512);
  const reverse = collectibleFace(angle) === 'back';
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
  const frontMask = showFrames && snapshot.angleFrames && frameBlend && !frameBlend.back ? <>
    <SpriteCellMask frames={snapshot.angleFrames} index={frameBlend.index} faceSize={displayFace} opacity={angleFrameOpacities(frameBlend.blend).lower} />
    {frameBlend.blend > 0 ? <SpriteCellMask frames={snapshot.angleFrames} index={frameBlend.next} faceSize={displayFace} opacity={angleFrameOpacities(frameBlend.blend).upper} /> : null}
  </> : undefined;
  const frontUri = snapshot.frontImageSource && !imageFailed ? Image.resolveAssetSource(snapshot.frontImageSource)?.uri : picture || undefined;
  const webFrontMask = Platform.OS === 'web' && showFrames && snapshot.angleFrames && frameBlend && !frameBlend.back
    ? angleFrameWebMask(snapshot.angleFrames, frameBlend.index, frameBlend.next, frameBlend.blend) : frontUri;
  const livingClock = moving ? clock : 0;
  // activeMotion이 현재 재생 중인 타입과 일치하면(자동재생 중) 그 정확한 객체를 쓴다 — 같은 type이라도 once/loop가
  // 서로 다른 particle을 가질 수 있어 type만으로 찾으면 항상 첫 번째 것이 걸린다(WP4 리뷰 6). 수동 조작처럼
  // activeMotion이 없거나 어긋나면 기존처럼 type으로 찾는다.
  const activeMotionParticle = (activeMotion?.type === activeAnimation ? activeMotion : snapshot.motions?.find((motion) => motion.type === activeAnimation))?.particle;
  const tiltActive = canUseTiltSensor && tiltOn && moving;

  return (
    <DetailFrame onLayout={onViewportLayout} onScroll={onDetailScroll}>
      <Text accessibilityRole="header" style={[styles.title, { color: palette.label }]}>{snapshot.name}</Text>
      <Text selectable style={[styles.meta, { color: palette.secondaryLabel }]}>{publicDataDemoStoreName(merchantId, merchantName)} · {snapshot.gradeName} · {snapshot.theme.name}</Text>
      <View onLayout={onCardLayout} style={[styles.stage, { width: size, height: size, backgroundColor: palette.surface }]}>
        {scene ? (
          <>
            <Image source={{ uri: sceneUri }} resizeMode="cover" accessibilityLabel={`${publicDataDemoStoreName(merchantId, merchantName)} 가게 이야기`}
              style={{ width: size, height: size, transform: [{ scale: sceneScale }, { translateX: scenePan }] }} />
            {snapshot.story.type === 'follow' ? <View style={{ position: 'absolute', left: size * (.1 + shownProgress * .65), bottom: size * .1 }}><Mascot pose="wave" size={size * .16} breathe={false} /></View> : null}
          </>
        ) : (
          <GestureDetector gesture={materialGesture}>
          <View style={{ width: size, height: size, transform: [{ translateY: animationFrame.lift }, { scale: animationFrame.scale }] }} accessible accessibilityLabel={`${reverse ? '뒷면' : '앞면'} ${snapshot.name}, ${publicDataDemoStoreName(merchantId, merchantName)}, ${snapshot.gradeName} ${shapeName(snapshot.shape)}, 두께 ${snapshot.thickness}, 각도 ${Math.round(angle)}도`}>
            {[1, .8, .6, .4, .2].map((fraction) => <View key={fraction} pointerEvents="none" accessible={false}
              style={{ position: 'absolute', width: displayFace, height: displayFace, top: size * .09, left: size * .09 + depth * fraction, transform: [{ scaleX }] }}>
              <CollectibleFaceShape shape={snapshot.shape} size={displayFace} fill={gradeColors.shade} />
            </View>)}
            {reverse ? (
              snapshot.backImageDataUrl ? (
                <View style={{ position: 'absolute', width: displayFace, height: displayFace, top: size * .09, left: size * .09, transform: [{ scaleX }] }}>
                <CollectibleFaceShape shape={snapshot.shape} size={displayFace} fill={gradeColors.container} />
                <FaceImage uri={snapshot.backImageDataUrl} shape={snapshot.shape} size={displayFace} />
                <GradeMaterialLayer material={material} size={displayFace} shape={snapshot.shape}
                  tilt={materialTilt} clock={materialClock} variant="detail" active={materialActive} />
                </View>
              ) : (
                <View style={{ position: 'absolute', width: displayFace, height: displayFace, top: size * .09, left: size * .09, transform: [{ scaleX }] }}>
                  <CollectibleDefaultBack shape={snapshot.shape} size={displayFace} merchantName={publicDataDemoStoreName(merchantId, merchantName)}
                    name={snapshot.name} gradeId={snapshot.gradeId} gradeName={snapshot.gradeName} />
                  <GradeMaterialLayer material={material} size={displayFace} shape={snapshot.shape}
                    tilt={materialTilt} clock={materialClock} variant="detail" active={materialActive} intensityScale={.45} />
                </View>
              )
            ) : (
              // 얼굴 전체에 scaleX 하나를 공유하는 부모: living overlay가 이 안에서 상대 좌표로만 위치해야
              // 얼굴과 같은 기준으로 회전·압축된다(자기 박스 중심으로 따로 scaleX를 걸면 어긋난다, WP4 리뷰 5).
              <View style={{ position: 'absolute', width: displayFace, height: displayFace, top: size * .09, left: size * .09, transform: [{ scaleX }] }}>
                {showFrames && frameBlend && !frameBlend.back && snapshot.angleFrames ? (
                  <View style={{ position: 'absolute', width: displayFace, height: displayFace, overflow: 'hidden' }}>
                    <SpriteCell frames={snapshot.angleFrames} index={frameBlend.index} faceSize={displayFace} opacity={angleFrameOpacities(frameBlend.blend).lower} shape={snapshot.shape} />
                    {frameBlend.blend > 0 ? <SpriteCell frames={snapshot.angleFrames} index={frameBlend.next} faceSize={displayFace} opacity={angleFrameOpacities(frameBlend.blend).upper} shape={snapshot.shape} /> : null}
                  </View>
                ) : (
                  snapshot.frontImageSource && frontUri && !imageFailed ? (
                    <FaceImage uri={frontUri} shape={snapshot.shape} size={displayFace} onError={() => setImageFailed(true)} />
                  ) : picture ? (
                    <FaceImage uri={picture} shape={snapshot.shape} size={displayFace} onError={() => setImageFailed(true)} />
                  ) : (
                    <Mascot pose="stamp" size={displayFace} breathe={false} />
                  )
                )}
                {snapshot.living ? <LivingOverlay living={snapshot.living} cell={livingCell(livingClock, snapshot.living.periodMs, snapshot.living.count)} faceSize={displayFace} /> : null}
                {/* 상세는 수집품을 감상하는 화면이다. 점주 빛 모션과 겹쳐도 재질이 묻히지 않게 조금만 낮춘다. */}
                <GradeMaterialLayer material={material} size={displayFace}
                  faceUri={frontUri} faceMask={frontMask} webFaceMask={webFrontMask}
                  shape={snapshot.shape} tilt={materialTilt} clock={materialClock} variant="detail" active={materialActive}
                  intensityScale={animationFrame.light ? .9 : 1} />
              </View>
            )}
            {animationFrame.light && !reverse ? <Svg pointerEvents="none" width={displayFace} height={displayFace} style={{ position: 'absolute', top: size * .09, left: size * .09, transform: [{ scaleX }], ...(Platform.OS === 'web' ? { clipPath: collectibleWebClipPath(snapshot.shape), ...(webFrontMask ? { maskImage: `url(${JSON.stringify(webFrontMask)})`, maskSize: 'contain', maskPosition: 'center', maskRepeat: 'no-repeat' } : {}) } : {}) }}>
              <Defs>
                <ClipPath id={lightClipId}><G scale={displayFace / 100}><CollectibleFaceOutline shape={snapshot.shape} fill="white" /></G></ClipPath>
                <Mask id="collectible-light-mask" maskType="alpha">{frontMask ?? <SvgImage href={{ uri: frontUri }} width={displayFace} height={displayFace} />}</Mask>
                <LinearGradient id="collectible-light" x1={animationFrame.lightX} y1={0} x2={animationFrame.lightX + size * .28} y2={0} gradientUnits="userSpaceOnUse">
                  <Stop offset={0} stopColor="#fff" stopOpacity={0} /><Stop offset={0.5} stopColor="#fff" stopOpacity={1} /><Stop offset={1} stopColor="#fff" stopOpacity={0} />
                </LinearGradient>
              </Defs>
              <Rect width={displayFace} height={displayFace} fill="url(#collectible-light)" clipPath={Platform.OS === 'web' ? undefined : `url(#${lightClipId})`} mask={Platform.OS === 'web' ? undefined : 'url(#collectible-light-mask)'} opacity={animationFrame.lightOpacity} />
            </Svg> : null}
            {animationFrame.particles ? Array.from({ length: 15 }, (_, index) => {
              const point = activeMotionParticle ? particleAt(activeMotionParticle, index, animationFrame.particlePhase) : undefined;
              return <View key={index} pointerEvents="none" style={{ position: 'absolute', width: 4, height: 6,
                left: size / 2 + (point ? point.x * size * .42 : Math.sin(index * 7) * size * .42 * animationFrame.particlePhase),
                top: size / 2 + (point ? point.y * size * .42 : Math.cos(index * 3) * size * .42 * animationFrame.particlePhase + animationFrame.particlePhase ** 2 * size * .3),
                backgroundColor: point ? point.color : ['#d89944', '#56ab8e', '#b475b8'][index % 3], transform: [{ rotate: `${index * 23}deg` }] }} />;
            }) : null}
          </View>
          </GestureDetector>
        )}
      </View>
      {tiltActive ? <TiltSensor onChange={handleTiltChange} /> : null}
      {canUseTiltSensor && materialActive ? <GradeMaterialSensor output={gravityLight} /> : null}
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
          <Control label={playing ? '동작 정지' : '천천히 회전'} disabled={!moving}
            onPress={() => { cancelSequence(); setActiveAnimation('rotate'); setActiveMotion(undefined); setAnimationTime(0); setPlaying((value) => !value); }} />
          <Control label={snapshot.animation === 'still' ? '정지 동작' : '설정한 동작 다시 보기'} disabled={!moving || snapshot.animation === 'still'}
            onPress={() => {
              cancelSequence();
              setActiveAnimation(snapshot.animation); setActiveMotion(snapshot.motions?.find((motion) => motion.type === snapshot.animation));
              setAnimationTime(0); setAnimationReplay((value) => value + 1); setPlaying(true);
            }} />
          <Control label="정면 다시 보기" onPress={() => { pause(); stepAngle(-angleRef.current); }} />
          {onceList.length > 0 ? <Control label="획득 장면 다시 보기" disabled={!moving} onPress={replayOnceMotions} /> : null}
        </View>
      </> : null}
      <View style={styles.toggle}><Text style={[styles.controlText, { color: palette.label }]}>동작 줄이기</Text><Switch accessibilityLabel="수집품 동작 줄이기" value={reduceMotion || !motionAllowed} disabled={!motionAllowed} onValueChange={setReduceMotion} /></View>
      {canUseTiltSensor && motionAllowed && !reduceMotion ? <View style={styles.toggle}><Text style={[styles.controlText, { color: palette.label }]}>기울여 보기</Text>
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
      {onPlaceInStudio ? <Control label="내 공간에 놓기" onPress={() => { pause(); onPlaceInStudio(); }} /> : null}
      {merchantId ? <Pressable accessibilityRole="link" accessibilityLabel={`${publicDataDemoStoreName(merchantId, merchantName)} 보기`}
        onPress={() => { close(); router.push({ pathname: '/merchants/[merchantId]', params: { merchantId, from: 'collection' } }); }}
        style={styles.merchantLink}><Text style={[styles.controlText, { color: palette.primary }]}>{publicDataDemoStoreName(merchantId, merchantName)} 보기 →</Text></Pressable> : null}
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
  merchantLink: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: 8 },
  slider: { height: 48, borderRadius: 14, justifyContent: 'center' },
  track: { height: 4, borderRadius: 4 },
  thumb: { position: 'absolute', width: 24, height: 24, borderRadius: 12, top: 12 },
  toggle: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  greeting: { fontSize: 19, lineHeight: 28 },
});
