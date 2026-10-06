import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Image, ImageBackground, Pressable, StyleSheet, Text, View, useColorScheme, useWindowDimensions } from 'react-native';
import { gameSkills, getGameBoard, type GameAction } from '../../../../api/src/play-rules';
import { getQualityGameState } from '../../../../api/src/play-rules-quality';
import { BadgeArt, CosmeticArt } from '@/illustration/artwork';
import { useIsFocused, useRouter } from 'expo-router';
import { appendAction, finalizeDeliveryActions, memoryRevealDelay } from '@/play/run-actions';
import { playErrorMessage, type PlayFinish } from '@/play/play-api';
import { useMotionEnabled } from '@/motion/use-motion';
import { lightHaptic, successHaptic } from '@/gamification/native-effects';
import { playUiSound } from '@/sound/ui-sounds';
import { colorsForScheme } from '@/theme/palette';
import { BounceButton } from '@/ui/bounce-button';
import { consentRecheckLabel, needsConsentRecheck } from '@/privacy/consent-flow';
import { useConsentRecheck } from '@/privacy/consent-recheck';
import { Companion, GameToken } from './play-art';
import { gameCopy, skillCopy, skillRewardArt, playEndLabel, rewardState, tokenName } from './play-copy';
import type { GameSessionProps } from './game-session';
import { playContent, type PlayObject } from './play-content';
import { initialRunElapsed, shouldRenderGameFrame } from './play-lifecycle';

type State = ReturnType<typeof getQualityGameState>;
const currentTime = () => performance.now();
const background = require('../../../assets/images/play/room-daylight.png');
const elapsedForRun = (started: number, run: GameSessionProps['run']) => Math.max(currentTime() - started,
  initialRunElapsed(run.durationMs, run.startedAt, run.expiresAt, Date.now()));

export function QualityGameSession({ run, content, avatar, equipment, clothing, previousBest, previouslyEarned = false, onFinish, onResult, onRetry, onExit }: GameSessionProps) {
  const router = useRouter();
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const palette = colorsForScheme(useColorScheme());
  const motion = useMotionEnabled();
  const recheck = useConsentRecheck();
  const { width } = useWindowDimensions();
  const board = useMemo(() => getGameBoard(run.kind, run.seed), [run.kind, run.seed]);
  const [elapsed, setElapsed] = useState(0);
  const [actions, setActions] = useState<readonly GameAction[]>([]);
  const log = useRef<readonly GameAction[]>([]);
  const started = useRef(0);
  const displayedAt = useRef(0);
  const lastAt = useRef<number | undefined>(undefined);
  const abort = useRef(new AbortController());
  const phase = useRef<'playing' | 'saving' | 'error' | 'result'>('playing');
  const [status, setStatus] = useState<'playing' | 'saving' | 'error' | 'result'>('playing');
  const [result, setResult] = useState<PlayFinish>();
  const [endReason, setEndReason] = useState('');
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState({ text: '동행과 준비됐어요', good: true });
  const [revealed, setRevealed] = useState<number[]>([]);
  const memoryLock = useRef(false);
  const [memoryLocked, setMemoryLocked] = useState(false);
  const hide = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const previousTick = useRef(0);
  const [startingBest] = useState(previousBest);
  const state = getQualityGameState(run.kind, run.seed, actions, elapsed);
  const visual = content ?? playContent([], [], '');
  const token = (value: number) => visual.tokens[value] ?? { name: `연습 그림 ${value + 1}`, source: 'practice' as const };
  const tokenLabel = (value: number) => token(value).source === 'practice' ? tokenName([], value) : token(value).name;
  const now = () => elapsedForRun(started.current, run);
  const setPhase = (value: typeof phase.current) => { phase.current = value; setStatus(value); };
  function feedback(text: string, good: boolean) {
    setNotice({ text, good });
    playUiSound(good ? 'success' : 'error');
    if (good) void successHaptic(); else void lightHaptic();
  }
  async function save(input: readonly GameAction[]) {
    if (phase.current !== 'playing' && phase.current !== 'error') return;
    if (phase.current === 'playing') {
      const at = Math.floor(Math.min(now(), run.durationMs));
      const final = getQualityGameState(run.kind, run.seed, input, at);
      setElapsed(at); setActions(input);
      setEndReason(playEndLabel(final, at >= run.durationMs, input.length >= (run.kind === 'memory' ? 36 : run.kind === 'orders' ? 60 : run.kind === 'stack' ? 6 : 20)));
    }
    setPhase('saving'); setError(undefined);
    try {
      const saved = await onFinish(run, input, abort.current.signal);
      if (abort.current.signal.aborted) return;
      setResult(saved); setPhase('result'); onResult(saved);
      // Saving is not a gameplay success or an achievement event.
      playUiSound(saved.newlyEarned ? 'success' : 'tap');
      if (saved.newlyEarned) void successHaptic();
    } catch (caught) { if (!abort.current.signal.aborted) { setError(caught); setPhase('error'); playUiSound('error'); } }
  }
  function accept(choice: number): readonly GameAction[] | undefined {
    if (phase.current !== 'playing') return;
    // Stack uses exactly the clock displayed on screen, not a later input timestamp.
    const at = run.kind === 'stack' ? displayedAt.current : now();
    const next = appendAction(log.current, choice, at, run.durationMs, run.kind, lastAt.current);
    if (!next) return;
    const nextState = getQualityGameState(run.kind, run.seed, next, Math.floor(at));
    lastAt.current = at; log.current = next; setActions(next);
    void lightHaptic(); playUiSound('tap');
    if (nextState.kind === 'stack') {
      feedback(nextState.failed ? '겹침이 없어 상자가 떨어졌어요' : `포장 ${nextState.placed.length}층 · 남은 폭 ${Math.round(nextState.remainingWidth)}%`, !nextState.failed);
    } else if (nextState.kind === 'orders' && choice === 4) {
      const before = getQualityGameState(run.kind, run.seed, log.current.slice(0, -1), Math.floor(at));
      const served = before.kind === 'orders' && nextState.orderIndex > before.orderIndex;
      feedback(served ? `전달 완료! 물건 ${nextState.combo}개 연속 포장` : '주문표와 달라요. 되돌리거나 비우고 고쳐요', served);
    }
    if (nextState.kind !== 'memory' && (nextState.failed || nextState.completed || next.length >= (run.kind === 'orders' ? 60 : run.kind === 'stack' ? 6 : 20))) void save(next);
    return next;
  }
  function flip(index: number) {
    if (state.kind !== 'memory' || memoryLock.current || state.matchedIndices.includes(index) || revealed.includes(index)) return;
    const next = accept(index); if (!next) return;
    if (!revealed.length) { setRevealed([index]); return; }
    const first = revealed[0]!;
    const match = state.cards[first] === state.cards[index];
    setRevealed([first, index]); memoryLock.current = true; setMemoryLocked(true);
    feedback(match ? `${visual.merchantName ?? '연습 도감'} · ${tokenLabel(state.cards[index]!)} 발견!` : '다른 그림이에요. 위치를 기억해요', match);
    hide.current = setTimeout(() => {
      setRevealed([]); memoryLock.current = false; setMemoryLocked(false);
      const final = getQualityGameState(run.kind, run.seed, next, Math.floor(now()));
      if (final.completed || next.length >= 36) void save(next);
    }, memoryRevealDelay(match, motion));
  }
  useEffect(() => {
    started.current = currentTime() - initialRunElapsed(run.durationMs, run.startedAt, run.expiresAt, Date.now());
    const controller = abort.current;
    const listener = AppState.addEventListener('change', (value) => setForeground(value === 'active'));
    return () => { listener.remove(); controller.abort(); if (hide.current) clearTimeout(hide.current); };
  }, [run.id, run.startedAt, run.expiresAt, run.durationMs]);
  useEffect(() => {
    if (!shouldRenderGameFrame(status, focused, foreground)) return;
    let frame = 0;
    function tick() {
      if (phase.current === 'playing') {
        const at = Math.min(now(), run.durationMs);
        displayedAt.current = Math.floor(at); setElapsed(Math.floor(at));
        const current = getQualityGameState(run.kind, run.seed, log.current, Math.floor(at));
        if (current.kind === 'delivery' && current.tick > previousTick.current) {
          const old = getQualityGameState(run.kind, run.seed, log.current, Math.max(0, (previousTick.current + 1) * 2000 - 1));
          const collision = old.kind === 'delivery' && current.collisions > old.collisions;
          feedback(collision ? `상자가 흔들렸어요 · 상태 ${current.cargoHealth}/3` : '안전하게 통과! 목적지가 가까워져요', !collision);
          previousTick.current = current.tick;
        }
        if (current.failed || (current.completed && current.kind !== 'memory') || at >= run.durationMs) {
          if (run.kind === 'delivery') {
            const finished = finalizeDeliveryActions(log.current, current.kind === 'delivery' ? current.lane : 1, at, run.durationMs);
            log.current = finished; setActions(finished); void save(finished);
          } else void save(log.current);
        }
      }
      if (phase.current === 'playing') frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // The monotonic elapsed clock survives focus and foreground changes; only rendering stops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.id, focused, foreground, status]);
  const count = state.kind === 'stack' ? state.placed.length : state.kind === 'memory' ? state.matchedIndices.length / 2 : state.kind === 'delivery' ? state.tick : state.orderIndex;
  const total = state.kind === 'stack' || state.kind === 'memory' ? 6 : state.kind === 'delivery' ? 12 : 4;
  const reward = rewardState(previouslyEarned, result);
  const best = result?.version2BestScore ?? 0;
  return <View style={styles.session}>
    <View style={styles.header}><View style={{ flex: 1 }}><Text style={[styles.title, { color: palette.label }]}>{gameCopy[run.kind].title}</Text><Text style={{ color: palette.secondaryLabel }}>{count}/{total} {run.kind === 'stack' ? '층' : run.kind === 'memory' ? '쌍 발견' : run.kind === 'delivery' ? '구간' : '주문 전달'}</Text></View><Text style={[styles.clock, { color: palette.label }]}>{status === 'playing' ? `${Math.ceil((run.durationMs - elapsed) / 1000)}초` : status === 'saving' ? '저장 중' : status === 'error' ? '재전송' : '결과'}</Text></View>
    <View style={[styles.context, { backgroundColor: palette.surface }]}><PlayToken item={visual.package} value={0} size={44} /><View style={{ flex: 1 }}><Text style={[styles.source, { color: palette.label }]}>{visual.merchantName ?? '놀이 마당 · 연습 장면'}</Text><Text style={{ color: palette.secondaryLabel }}>{visual.merchantName ? `${visual.package.name} · 콘텐츠 v${visual.contentVersion} · ${run.kind === 'delivery' ? '운반' : run.kind === 'memory' ? '도감' : '포장'} 연습` : '실제 메뉴가 없는 연습용 그림 꾸러미예요'}</Text></View></View>
    {status === 'result' && result ? <View style={styles.result}>
      <Companion avatar={avatar} equipment={equipment} clothing={clothing} reaction={result.completed ? 'cheer' : 'concerned'} />
      <Text style={[styles.title, { color: palette.label }]}>{result.completed ? run.kind === 'delivery' ? '꾸러미 도착!' : '완성했어요!' : state.failed ? '이번 도전은 여기까지' : '다음에 이어 도전해요'}</Text>
      <Text style={[styles.score, { color: palette.label }]}>{result.score}점</Text>
      <Text style={[styles.summary, { color: palette.secondaryLabel }]}>{endReason}</Text>
      <FinalWork state={state} visual={visual} />
      <Text style={{ color: palette.success }}>이번 도전 결과 저장 완료</Text>
      {(result.version2Plays ?? 0) > 0 ? <Text style={{ color: palette.secondaryLabel }}>완주 최고 {best}점 · 새 규칙 {result.version2Plays}회 완주</Text> : <Text style={{ color: palette.secondaryLabel }}>아직 완주 최고 기록은 없어요</Text>}
      {result.completed && best > (startingBest ?? 0) ? <Text style={[styles.source, { color: palette.success }]}>새 최고 기록!</Text> : null}
      <Text style={[styles.summary, { color: palette.secondaryLabel }]}>{result.correct}/{result.total} {state.kind === 'stack' ? '층 쌓음' : state.kind === 'memory' ? '쌍 발견' : state.kind === 'delivery' ? '구간 안전 통과' : '물건 포장 완료'} · 누적 {result.plays}회 완주{state.kind === 'delivery' ? ` · 충돌 ${state.collisions}회` : state.kind === 'memory' ? ` · 엇갈린 짝 ${state.misses}회` : state.kind === 'stack' ? ` · 남은 폭 ${Math.round(state.remainingWidth)}%` : ` · 연속 포장한 물건 ${state.combo}개`}</Text>
      <Text style={[styles.summary, { color: palette.secondaryLabel }]}>{reward.owned ? '획득한 배지와 꾸미기' : '다음 보상 미리보기 · 아직 미획득'}</Text><View style={styles.rewardArt}><BadgeArt id={gameSkills[run.kind].id} size={64} /><CosmeticArt id={skillRewardArt[run.kind]} size={80} /></View>
      <Text style={[styles.summary, { color: palette.label }]}>{reward.newlyEarned ? `새 배지 획득! ${skillCopy[run.kind].badge}` : reward.owned ? '이미 얻은 배지와 해금은 그대로 유지돼요' : `다음 목표 · ${skillCopy[run.kind].goal}`}</Text>
      {reward.owned ? <BounceButton label="획득한 꾸미기 보기" onPress={() => router.push('/studio')} /> : null}
      <BounceButton label="바로 다시 도전" onPress={onRetry} /><BounceButton label="다른 놀이 고르기" variant="secondary" onPress={onExit} />
    </View> : status === 'saving' || status === 'error' ? <View style={styles.result}><Text style={[styles.source, { color: palette.label }]}>{status === 'saving' ? '이번 조작 기록을 저장해요' : playErrorMessage(error)}</Text>{status === 'error' ? <><BounceButton label={needsConsentRecheck(error) ? consentRecheckLabel : '같은 기록 다시 보내기'} onPress={needsConsentRecheck(error) ? recheck : () => void save(log.current)} /><BounceButton label="놀이 마당으로" variant="secondary" onPress={onExit} /></> : null}</View> : <>
      <View style={styles.feedback}><Companion avatar={avatar} equipment={equipment} clothing={clothing} reaction={!actions.length ? 'idle' : notice.good ? 'cheer' : 'concerned'} /><Text accessibilityLiveRegion="polite" style={[styles.notice, { color: notice.good ? palette.success : palette.error }]}>{notice.text}</Text></View>
      {state.kind === 'stack' ? <ImageBackground source={background} style={styles.stackScene} imageStyle={styles.backdrop}>
        <View style={styles.tower}>
          <View style={[styles.base, { left: '20%', width: '60%' }]} />
          {state.placed.map((layer, index) => <View key={index} style={[styles.package, { bottom: 20 + index * 28, left: `${layer.left}%`, width: `${layer.width}%` }]}><PlayToken item={visual.package} value={0} size={23} /></View>)}
          <Pressable accessibilityRole="button" accessibilityLabel={`${visual.package.name} 놓기, 위치 ${Math.round(state.current.left)}%, 폭 ${Math.round(state.current.width)}%`} onPress={() => accept(0)} style={[styles.package, styles.movingPackage, { bottom: 20 + state.placed.length * 28, left: `${state.current.left}%`, width: `${state.current.width}%` }]}><PlayToken item={visual.package} value={0} size={24} /></Pressable>
        </View><Text style={styles.sceneCaption}>남은 폭 {Math.round(state.remainingWidth)}% · 겹치는 부분만 남아요</Text>
      </ImageBackground> : null}
      {state.kind === 'stack' ? <BounceButton label="지금 상자 놓기" onPress={() => accept(0)} /> : null}
      {state.kind === 'memory' ? <ImageBackground source={background} style={styles.book} imageStyle={styles.backdrop}><Text style={styles.bookTitle}>방문 도감 · 발견한 그림은 남아요</Text><View style={styles.grid}>{state.cards.map((value, index) => {
        const matched = state.matchedIndices.includes(index); const shown = matched || revealed.includes(index);
        return <Pressable key={index} accessibilityRole="button" accessibilityLabel={`${index + 1}번 카드, ${matched ? '발견 완료, ' : ''}${shown ? tokenLabel(value) : '닫힘'}`} disabled={shown || memoryLocked} accessibilityState={{ disabled: shown || memoryLocked }} onPress={() => flip(index)} style={[styles.card, matched && styles.found]}>{shown ? <PlayToken item={token(value)} value={value} size={Math.min(52, (width - 110) / 4)} /> : <View style={styles.cardSeal}><Text style={styles.sealText}>{index + 1}</Text></View>}{matched ? <Text style={styles.foundMark}>발견</Text> : null}</Pressable>;
      })}</View></ImageBackground> : null}
      {state.kind === 'delivery' && board.kind === 'delivery' ? <View style={{ gap: 10 }}><Text style={{ color: palette.label }}>출발 {visual.merchantName ?? '연습 작업대'} → {visual.destination.name}{visual.roadAddress ? ` · ${visual.roadAddress}` : ''}</Text><Text style={{ color: palette.secondaryLabel }}>상자 상태 {state.cargoHealth}/3 · 충돌 {state.collisions}회 · {state.arrived ? '도착' : '운반 중'}</Text><ImageBackground source={require('../../../assets/images/mascot/v2/town-map.png')} style={styles.road} imageStyle={styles.backdrop}>
        <View style={styles.destination}><PlayToken item={visual.destination} value={1} size={28} /><Text style={styles.destinationText}>{visual.destination.name} · 도착 지점</Text></View><View style={styles.lanes}>{[0, 1, 2].map((lane) => <View key={lane} style={styles.lane} />)}</View>
        {board.ticks.filter(tick => tick.at > elapsed).slice(0, 2).map(tick => <View key={tick.at} style={[styles.obstacleRow, { top: Math.max(42, 185 - (tick.at - elapsed) / 2000 * 135) }]}>{[0, 1, 2].map(lane => <View key={lane} style={styles.cell}>{lane === tick.blockedLane ? <View style={styles.crate}><Text style={styles.crateText}>공사</Text></View> : lane === tick.bonusLane ? <PlayToken item={visual.package} value={0} size={30} /> : null}</View>)}</View>)}
        <View style={[styles.runner, { left: `${state.lane * 33.333}%` }]}><Companion avatar={avatar} equipment={equipment} clothing={clothing} reaction={notice.good ? 'idle' : 'concerned'} /><View style={styles.cargo}><PlayToken item={visual.package} value={0} size={30} /></View></View>
      </ImageBackground>{!motion && board.ticks[state.tick] ? <Text style={{ color: palette.label }}>다음 공사: {['왼길', '가운뎃길', '오른길'][board.ticks[state.tick]!.blockedLane]} · 통과까지 {Math.ceil((board.ticks[state.tick]!.at - elapsed) / 1000)}초</Text> : null}<View style={styles.controls}>{['왼길', '가운뎃길', '오른길'].map((label, lane) => <Pressable key={lane} accessibilityRole="button" accessibilityLabel={`${label}로 이동`} accessibilityState={{ selected: state.lane === lane }} onPress={() => { if (lane !== state.lane && log.current.length < 19) accept(lane); }} style={[styles.laneControl, state.lane === lane && styles.selectedLane]}><Text style={{ color: state.lane === lane ? '#FFF' : '#315B50', textAlign: 'center', fontWeight: '800' }}>{label}</Text></Pressable>)}</View></View> : null}
      {state.kind === 'orders' ? <Orders state={state} visual={visual} onChoose={accept} /> : null}
      <Pressable accessibilityRole="button" onPress={() => { const input = state.kind === 'delivery' ? finalizeDeliveryActions(log.current, state.lane, now(), run.durationMs) : log.current; log.current = input; void save(input); }} style={styles.exit}><Text style={{ color: palette.secondaryLabel }}>이번 도전 마치기</Text></Pressable>
    </>}
  </View>;
}

/** A frozen view of accepted work; no controls and no unearned objects. */
function PlayToken({ item, value, size }: { item: PlayObject; value: number; size: number }) {
  if (item.uri) return <Image source={{ uri: item.uri }} resizeMode="contain" style={{ width: size, height: size }} accessibilityLabel={item.name} />;
  if (item.source === 'practice') return <GameToken value={value} art={[]} size={size} />;
  return <Text numberOfLines={2} style={{ width: size, fontSize: Math.max(9, size / 4), textAlign: 'center', color: '#47351F' }}>{item.name}</Text>;
}

function FinalWork({ state, visual }: { state: State; visual: NonNullable<GameSessionProps['content']> }) {
  if (state.kind === 'stack') return <ImageBackground source={background} style={[styles.stackScene, styles.finalWork]} imageStyle={styles.backdrop}>
    <View style={[styles.tower, { height: 200 }]}><View style={[styles.base, { left: '20%', width: '60%' }]} />{state.placed.map((layer, index) => <View key={index} style={[styles.package, { bottom: 20 + index * 28, left: `${layer.left}%`, width: `${layer.width}%` }]}><PlayToken item={visual.package} value={0} size={23} /></View>)}</View><Text style={styles.sceneCaption}>{state.placed.length ? `${visual.package.name} ${state.placed.length}층이 남은 포장 탑` : '아직 놓인 상자가 없어요'}</Text>
  </ImageBackground>;
  if (state.kind === 'memory') return <ImageBackground source={background} style={[styles.book, styles.finalWork]} imageStyle={styles.backdrop}><Text style={styles.bookTitle}>복원한 방문 도감 · {state.correct}/6쌍</Text><View style={styles.grid}>{state.cards.map((value, index) => <View key={index} style={[styles.card, state.matchedIndices.includes(index) && styles.found]}>{state.matchedIndices.includes(index) ? <PlayToken item={visual.tokens[value]!} value={value} size={42} /> : <Text style={styles.sealText}>미발견</Text>}</View>)}</View></ImageBackground>;
  if (state.kind === 'delivery') return <ImageBackground source={require('../../../assets/images/mascot/v2/town-map.png')} style={[styles.finalWork, styles.deliveryResult]} imageStyle={styles.backdrop}><View style={styles.finalParcel}><PlayToken item={visual.package} value={0} size={72} /></View><Text style={styles.ticketTitle}>{state.arrived ? `${visual.destination.name}에 도착한 ${visual.package.name}` : `운반 중단 · ${state.tick}/12구간`}</Text><Text style={styles.ticketText}>상자 상태 {state.cargoHealth}/3 · 충돌 {state.collisions}회</Text></ImageBackground>;
  return <View style={[styles.tray, styles.finalWork]}><Text style={styles.ticketTitle}>전달한 주문 {state.orderIndex}/4</Text>{state.orders.slice(0, state.orderIndex).map((recipe, index) => <View key={index} style={styles.servedOrder}><Text style={styles.ticketText}>주문 {index + 1}</Text>{recipe.map((value, item) => <PlayToken key={item} item={visual.tokens[value]!} value={value} size={38} />)}</View>)}{!state.orderIndex ? <Text style={styles.ticketText}>아직 전달을 마친 주문이 없어요</Text> : null}{state.tray.length ? <><Text style={styles.ticketTitle}>작업대에 남은 물건</Text><View style={styles.recipe}>{state.tray.map((value, index) => <PlayToken key={index} item={visual.tokens[value]!} value={value} size={38} />)}</View></> : null}</View>;
}

function Orders({ state, visual, onChoose }: { state: Extract<State, { kind: 'orders' }>; visual: NonNullable<GameSessionProps['content']>; onChoose: (choice: number) => unknown }) {
  const palette = colorsForScheme(useColorScheme());
  const recipe = state.orders[Math.min(state.orderIndex, state.orders.length - 1)]!;
  return <View style={styles.orders}>
    <Text style={[styles.source, { color: palette.label }]}>주문 {state.orderIndex + 1}/4 · 연속 준비 {state.combo}개</Text>
    <View style={styles.ticket}><Text style={styles.ticketTitle}>주문표 · 순서는 자유예요</Text><View style={styles.recipe}>{[0, 1, 2, 3].filter(value => recipe.includes(value)).map(value => <View key={value} style={styles.recipeItem}><PlayToken item={visual.tokens[value]!} value={value} size={38} /><Text style={styles.ticketText}>{visual.tokens[value]!.name} ×{recipe.filter(item => item === value).length}</Text></View>)}</View></View>
    <View style={styles.tray}><Text style={styles.ticketTitle}>담은 물건 {state.tray.length}/3</Text><View style={styles.recipe}>{state.tray.map((value, index) => <PlayToken key={index} item={visual.tokens[value]!} value={value} size={44} />)}{!state.tray.length ? <Text style={styles.ticketText}>아래 그림을 골라 작업대에 담아요</Text> : null}</View></View>
    <View style={styles.grid}>{[0, 1, 2, 3].map(value => <Pressable key={value} accessibilityRole="button" accessibilityLabel={`${visual.tokens[value]!.name} 하나 담기`} disabled={state.tray.length >= 3} accessibilityState={{ disabled: state.tray.length >= 3 }} onPress={() => onChoose(value)} style={[styles.ingredient, state.tray.length >= 3 && { opacity: 0.5 }]}><PlayToken item={visual.tokens[value]!} value={value} size={48} /><Text style={styles.ticketText}>{visual.tokens[value]!.name}</Text></Pressable>)}</View>
    <BounceButton label="주문표대로 전달하기" disabled={state.tray.length !== 3} onPress={() => onChoose(4)} />
    <View style={styles.controls}><Pressable accessibilityRole="button" disabled={!state.tray.length} onPress={() => onChoose(5)} style={styles.correct}><Text style={{ color: palette.label }}>마지막 하나 되돌리기</Text></Pressable><Pressable accessibilityRole="button" disabled={!state.tray.length} onPress={() => onChoose(6)} style={styles.correct}><Text style={{ color: palette.label }}>모두 비우기</Text></Pressable></View>
  </View>;
}

const styles = StyleSheet.create({
  finalWork: { width: '100%' }, rewardArt: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 16 }, deliveryResult: { padding: 20, alignItems: 'center', borderRadius: 14, gap: 12, backgroundColor: '#E7DBBD' }, finalParcel: { padding: 10, backgroundColor: '#E8C384', borderWidth: 3, borderColor: '#A17A49', borderRadius: 8 }, servedOrder: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderColor: '#BA9765' },
  session: { gap: 12, paddingBottom: 24 }, header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }, title: { fontSize: 24, fontWeight: '900', flexShrink: 1 }, clock: { fontSize: 21, fontWeight: '900' },
  context: { borderRadius: 12, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }, source: { fontSize: 16, fontWeight: '800' }, feedback: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 8 }, notice: { flex: 1, fontSize: 15, fontWeight: '700' },
  result: { gap: 16, alignItems: 'center', paddingVertical: 20 }, score: { fontSize: 44, fontWeight: '900' }, summary: { fontSize: 15, textAlign: 'center' },
  backdrop: { opacity: 0.35, borderRadius: 14 }, stackScene: { borderRadius: 14, overflow: 'hidden', backgroundColor: '#E9DDC3' }, tower: { height: 245, marginHorizontal: 10 }, base: { position: 'absolute', bottom: 0, height: 20, backgroundColor: '#73523B', borderTopWidth: 5, borderColor: '#BA9669', borderRadius: 3 },
  package: { position: 'absolute', height: 27, backgroundColor: '#DDAD6E', borderWidth: 2, borderColor: '#8F653E', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 3 }, movingPackage: { backgroundColor: '#F5D393', borderColor: '#674329' }, sceneCaption: { color: '#4C3827', padding: 12, textAlign: 'center', fontWeight: '700' },
  book: { padding: 12, borderWidth: 3, borderColor: '#9C774D', backgroundColor: '#F4E7C9', borderRadius: 14 }, bookTitle: { color: '#614727', fontWeight: '800', marginBottom: 10 }, grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }, card: { width: '23%', aspectRatio: 0.78, minHeight: 64, backgroundColor: '#527D78', borderWidth: 2, borderColor: '#355F5A', borderRadius: 7, alignItems: 'center', justifyContent: 'center' }, found: { backgroundColor: '#FFF8DF', borderColor: '#BA975C' }, cardSeal: { borderWidth: 1, borderColor: '#D8CA9B', borderRadius: 20, width: 30, height: 30, alignItems: 'center', justifyContent: 'center' }, sealText: { color: '#FFF6DC', fontWeight: '800' }, foundMark: { color: '#376C52', fontSize: 10, fontWeight: '800' },
  road: { height: 280, borderRadius: 14, backgroundColor: '#D7E5CD', overflow: 'hidden', borderWidth: 3, borderColor: '#8DA589' }, destination: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 6, backgroundColor: '#FFEDC0' }, destinationText: { color: '#514023', fontWeight: '800' }, lanes: { flexDirection: 'row', height: '100%', position: 'absolute', top: 38, width: '100%' }, lane: { flex: 1, backgroundColor: '#E8DBBE99', borderRightWidth: 2, borderColor: '#FFF9D8', borderStyle: 'dashed' }, obstacleRow: { position: 'absolute', flexDirection: 'row', width: '100%' }, cell: { flex: 1, alignItems: 'center' }, crate: { padding: 9, backgroundColor: '#B87A51', borderWidth: 3, borderColor: '#745034', borderRadius: 3 }, crateText: { color: '#FFF6E6', fontWeight: '800' }, runner: { position: 'absolute', bottom: 10, width: '33.333%', alignItems: 'center' }, cargo: { position: 'absolute', bottom: 0, right: 4, backgroundColor: '#EEC987', borderWidth: 2, borderColor: '#956738', padding: 2, borderRadius: 4 }, controls: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, laneControl: { flex: 1, minWidth: 64, minHeight: 52, padding: 8, justifyContent: 'center', borderWidth: 2, borderColor: '#A9C0AD', borderRadius: 8, backgroundColor: '#E2ECDF' }, selectedLane: { backgroundColor: '#346F5B', borderColor: '#275343' },
  orders: { gap: 12 }, ticket: { backgroundColor: '#FFF5DB', padding: 12, borderWidth: 2, borderColor: '#D3B883', borderRadius: 8 }, ticketTitle: { color: '#604827', fontSize: 15, fontWeight: '800', marginBottom: 6 }, recipe: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }, recipeItem: { flex: 1, minWidth: 60, alignItems: 'center' }, ticketText: { color: '#5A442B', fontSize: 12, textAlign: 'center', flexShrink: 1 }, tray: { padding: 12, minHeight: 88, backgroundColor: '#E7C79A', borderWidth: 4, borderColor: '#A47B50', borderRadius: 10 }, ingredient: { width: '48%', padding: 8, minHeight: 94, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF1D0', borderWidth: 2, borderColor: '#BCA279', borderRadius: 8 }, correct: { flex: 1, minWidth: 100, minHeight: 48, alignItems: 'center', justifyContent: 'center', padding: 6 }, exit: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
});
