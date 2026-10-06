import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View, useColorScheme, useWindowDimensions } from 'react-native';
import { gameSkills, getGameBoard, stackCursor, type GameAction, type PlayRun } from '../../../../api/src/play-rules';
import { BadgeArt, CosmeticArt } from '@/illustration/artwork';
import { lightHaptic, successHaptic } from '@/gamification/native-effects';
import { useMotionEnabled } from '@/motion/use-motion';
import { activeMomentFeedback, appendAction, completedRecordLabel, finalizeDeliveryActions, memoryRevealDelay, sessionProgress, shouldWaitForDeliverySample, type MomentFeedback } from '@/play/run-actions';
import { playErrorMessage, type PlayFinish } from '@/play/play-api';
import { consentRecheckLabel, needsConsentRecheck } from '@/privacy/consent-flow';
import { useConsentRecheck } from '@/privacy/consent-recheck';
import { playUiSound } from '@/sound/ui-sounds';
import { colorsForScheme } from '@/theme/palette';
import { BounceButton } from '@/ui/bounce-button';
import { Companion, FoodToken, GameToken, type OwnedArt } from './play-art';
import type { DisplayExperienceProfile } from '@/experience/experience-api';
import type { EquippedClothingArt } from '@/shop/wardrobe';
import { gameCopy, skillCopy, skillRewardArt, rewardState, themeNames, tokenName } from './play-copy';
import type { PlayContent } from './play-content';

export type GameSessionProps = {
  run: PlayRun;
  art: readonly OwnedArt[];
  content?: PlayContent;
  avatar: string | null;
  equipment?: DisplayExperienceProfile;
  clothing?: EquippedClothingArt | null;
  previousBest: number | undefined;
  previouslyEarned?: boolean;
  onFinish: (run: PlayRun, actions: readonly GameAction[], signal: AbortSignal) => Promise<PlayFinish>;
  onResult: (result: PlayFinish) => void;
  onRetry: () => void;
  onExit: () => void;
};

const foodNames = ['크루아상', '커피', '샌드위치', '과일 타르트'];
const laneNames = ['왼쪽', '가운데', '오른쪽'];
const currentTime = () => performance.now();
const elapsedSince = (startedAt: number) => Math.max(0, currentTime() - startedAt);

function laneAtTick(actions: readonly GameAction[], at: number): number {
  let lane = 1;
  for (const action of actions) {
    if (action.at > at) break;
    lane = action.choice;
  }
  return lane;
}

export function GameSession({ run, art, avatar, equipment, clothing, previousBest, previouslyEarned = false, onFinish, onResult, onRetry, onExit }: GameSessionProps) {
  const router = useRouter();
  const recheckConsent = useConsentRecheck();
  const board = useMemo(() => getGameBoard(run.kind, run.seed), [run.kind, run.seed]);
  const palette = colorsForScheme(useColorScheme());
  const { width, height, fontScale } = useWindowDimensions();
  const compactControls = height < 740 || fontScale >= 1.5;
  const roadHeight = Math.max(115, Math.min(220, Math.floor(height * (fontScale >= 1.5 ? 0.21 : 0.28))));
  const motionEnabled = useMotionEnabled();
  const [elapsed, setElapsed] = useState(0);
  const [actions, setActions] = useState<readonly GameAction[]>([]);
  const actionsRef = useRef<readonly GameAction[]>([]);
  const lastAcceptedElapsedRef = useRef<number | undefined>(undefined);
  const startedRef = useRef<number | null>(null);
  const abort = useRef(new AbortController());
  const phaseRef = useRef<'playing' | 'finishing' | 'finishError' | 'result'>('playing');
  const [phase, setPhase] = useState<'playing' | 'finishing' | 'finishError' | 'result'>('playing');
  const [error, setError] = useState<string>();
  const [errorNeedsConsent, setErrorNeedsConsent] = useState(false);
  const [result, setResult] = useState<PlayFinish>();
  const [startingBest] = useState(previousBest);
  const [flipped, setFlipped] = useState<number[]>([]);
  const [matched, setMatched] = useState<number[]>([]);
  const [memoryLocked, setMemoryLocked] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [lane, setLane] = useState(1);
  const laneRef = useRef(1);
  const [stackFeedback, setStackFeedback] = useState<MomentFeedback>();
  const [deliveryFeedback, setDeliveryFeedback] = useState<MomentFeedback>();
  const [deliveryPoints, setDeliveryPoints] = useState(0);
  const [crossed, setCrossed] = useState(0);
  const crossedRef = useRef(0);
  const deliveryPointsRef = useRef(0);

  const getElapsed = () => elapsedSince(startedRef.current ?? currentTime());
  const setRunPhase = (next: typeof phaseRef.current) => { phaseRef.current = next; setPhase(next); };

  async function finishCurrent(log: readonly GameAction[]) {
    if (phaseRef.current !== 'playing' && phaseRef.current !== 'finishError') return;
    setRunPhase('finishing');
    setError(undefined);
    setErrorNeedsConsent(false);
    try {
      const saved = await onFinish(run, log, abort.current.signal);
      if (abort.current.signal.aborted) return;
      setResult(saved);
      setStackFeedback(undefined);
      setDeliveryFeedback(undefined);
      setRunPhase('result');
      onResult(saved);
      playUiSound('success');
      void successHaptic();
    } catch (caught) {
      if (abort.current.signal.aborted) return;
      setError(playErrorMessage(caught));
      setErrorNeedsConsent(needsConsentRecheck(caught));
      setRunPhase('finishError');
      playUiSound('error');
    }
  }

  function add(choice: number, quiet = false, earliestAt = 0): GameAction[] | undefined {
    if (phaseRef.current !== 'playing') return undefined;
    const at = getElapsed();
    if (at < earliestAt) return undefined;
    const next = appendAction(actionsRef.current, choice, at, run.durationMs, run.kind, lastAcceptedElapsedRef.current);
    if (!next) return undefined;
    lastAcceptedElapsedRef.current = at;
    actionsRef.current = next;
    setActions(next);
    if (!quiet) { void lightHaptic(); playUiSound('tap'); }
    return next;
  }

  function finishDelivery(at: number) {
    if (phaseRef.current !== 'playing' || board.kind !== 'delivery') return;
    const next = finalizeDeliveryActions(actionsRef.current, laneRef.current, at, run.durationMs, lastAcceptedElapsedRef.current);
    if (shouldWaitForDeliverySample(next, at, run.durationMs, board.ticks.at(-1)!.at)) return;
    actionsRef.current = next;
    setActions(next);
    void finishCurrent(next);
  }

  useEffect(() => {
    startedRef.current = currentTime();
    const interval = setInterval(() => {
      if (phaseRef.current !== 'playing') return;
      const at = getElapsed();
      setElapsed(Math.min(at, run.durationMs));
      if (board.kind === 'delivery') {
        let feedback: MomentFeedback | undefined;
        while (crossedRef.current < board.ticks.length && board.ticks[crossedRef.current]!.at <= at) {
          const tick = board.ticks[crossedRef.current]!;
          const atLane = laneAtTick(actionsRef.current, tick.at);
          if (atLane === tick.blockedLane) feedback = { text: '장애물에 부딪혔어요', good: false };
          else {
            const points = atLane === tick.bonusLane ? 100 : 65;
            deliveryPointsRef.current += points;
            feedback = { text: atLane === tick.bonusLane ? `선물 획득 +${points}점` : `무사 통과 +${points}점`, good: true };
          }
          crossedRef.current++;
        }
        if (feedback) {
          setCrossed(crossedRef.current);
          setDeliveryPoints(deliveryPointsRef.current);
          setDeliveryFeedback(feedback);
          playUiSound(feedback.good ? 'success' : 'error');
          if (feedback.good) void successHaptic(); else void lightHaptic();
        }
      }
      if (board.kind === 'delivery' && at >= board.ticks.at(-1)!.at) {
        finishDelivery(at);
      } else if (at >= run.durationMs) void finishCurrent(actionsRef.current);
    }, 50);
    return () => clearInterval(interval);
    // A live lane ref avoids restarting the timer for every lane change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, run.durationMs]);

  useEffect(() => {
    abort.current = new AbortController();
    return () => {
      abort.current.abort();
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  function flip(index: number) {
    if (board.kind !== 'memory' || memoryLocked || phaseRef.current !== 'playing' || matched.includes(index) || flipped.includes(index)) return;
    const next = add(index);
    if (!next) return;
    if (flipped.length === 0) { setFlipped([index]); return; }
    const first = flipped[0]!;
    setFlipped([first, index]);
    setMemoryLocked(true);
    if (board.cards[first] === board.cards[index]) {
      const newMatched = [...matched, first, index];
      setMatched(newMatched);
      hideTimer.current = setTimeout(() => {
        setFlipped([]);
        setMemoryLocked(false);
        if (newMatched.length === board.cards.length || next.length === 36) void finishCurrent(next);
      }, memoryRevealDelay(true, motionEnabled));
    } else {
      hideTimer.current = setTimeout(() => {
        setFlipped([]);
        setMemoryLocked(false);
        if (next.length === 36) void finishCurrent(next);
      }, memoryRevealDelay(false, motionEnabled));
    }
  }

  function changeLane(nextLane: number) {
    if (board.kind !== 'delivery' || nextLane === laneRef.current || actionsRef.current.length >= 19) return;
    const lastCrossing = board.ticks[crossedRef.current - 1]?.at ?? -1;
    if (add(nextLane, false, lastCrossing + 1)) { laneRef.current = nextLane; setLane(nextLane); }
  }

  function dropStack() {
    if (board.kind !== 'stack') return;
    const next = add(0, true);
    if (!next) return;
    const index = next.length - 1;
    const round = board.rounds[index]!;
    const distance = Math.abs(stackCursor(round, next[index]!.at) - round.target);
    const points = Math.max(0, 100 - distance * 4);
    const hit = distance <= round.width / 2;
    setStackFeedback({ text: hit ? `정확해요 +${points}점` : `아쉬워요 +${points}점`, good: hit });
    playUiSound(hit ? 'success' : 'error');
    if (hit) void successHaptic(); else void lightHaptic();
    if (next.length === board.rounds.length) void finishCurrent(next);
  }

  const copy = gameCopy[run.kind];
  const seconds = Math.ceil(Math.max(0, run.durationMs - elapsed) / 1000);
  const progress = sessionProgress(board, actions.length, matched.length, crossed);
  const reward = rewardState(previouslyEarned, result);
  const newUnlocks = result?.unlockedThemes.filter((theme) => theme !== 'daylight') ?? [];
  const feedback = activeMomentFeedback(phase, run.kind, stackFeedback, deliveryFeedback);
  const status = phase === 'playing' ? `${seconds}s` : phase === 'result' ? '결과' : phase === 'finishing' ? '저장 중' : '재시도';

  return <View style={styles.session}>
    <View style={styles.statusRow}>
      <View style={styles.statusTitle}><Text style={[styles.kicker, { color: copy.color }]}>{copy.tag}</Text><Text style={[styles.title, { color: palette.label }]}>{copy.title}</Text></View>
      <Text style={[styles.timer, { color: phase === 'playing' && seconds <= 5 ? palette.error : palette.label }]} accessibilityLabel={phase === 'playing' ? `남은 시간 ${seconds}초` : status}>{status}</Text>
    </View>
    <View style={styles.progressRow}><Text style={[styles.progressText, { color: palette.secondaryLabel }]}>{progress.label}</Text><View style={[styles.progressTrack, { backgroundColor: palette.separator }]}><View style={[styles.progressFill, { width: progress.width, backgroundColor: copy.color }]} /></View></View>
    {feedback ? <Text accessibilityLiveRegion="polite" style={[styles.feedback, { color: feedback.good ? palette.success : palette.error }]}>{feedback.text}</Text> : null}
    {phase === 'result' && result ? <View style={styles.result}>
      <Companion avatar={avatar} equipment={equipment} clothing={clothing} />
      <Text style={[styles.resultText, { color: palette.secondaryLabel }]}>{result.skill?.achieved ? '동행이 성취를 축하해요!' : result.completed ? '동행이 다음 도전을 응원해요!' : '동행과 다시 도전해 봐요!'}</Text>
      <Text style={[styles.resultLabel, { color: palette.secondaryLabel }]}>{result.completed ? '완주 기록' : '이번 도전'}</Text>
      <Text style={[styles.score, { color: palette.label }]}>{result.score.toLocaleString()}점</Text>
      <Text style={[styles.resultText, { color: palette.secondaryLabel }]}>{result.correct} / {result.total} 성공 · {completedRecordLabel(result.plays, result.bestScore)} · {result.plays}회 완주</Text>
      {result.completed && result.bestScore > (startingBest ?? 0) ? <Text style={[styles.newBest, { color: palette.success }]}>새 최고 기록!</Text> : null}
      {result.skill ? <View style={[styles.skillResult, { borderColor: copy.color, backgroundColor: palette.surface }]}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12 }}><BadgeArt id={gameSkills[run.kind].id} size={64} /><CosmeticArt id={skillRewardArt[run.kind]} size={80} /></View><Text style={[styles.skillTitle, { color: palette.label }]}>{reward.newlyEarned ? '새 실력 배지 획득!' : reward.owned ? '획득한 실력 배지' : '다음 실력 목표'} · {skillCopy[run.kind].badge}</Text>
        <Text style={[styles.resultText, { color: palette.secondaryLabel }]}>{skillCopy[run.kind].metric} {result.skill.progress}/{result.skill.target} · {skillCopy[run.kind].goal}</Text>
        <Text style={[styles.resultText, { color: palette.label }]}>{reward.owned ? `해금: ${skillCopy[run.kind].reward}` : `다음 도전으로 ${skillCopy[run.kind].reward} 해금`}</Text>
      </View> : null}
      {newUnlocks.length ? <Text style={[styles.unlock, { color: palette.label }]}>내 공간 장식: {newUnlocks.map((theme) => themeNames[theme] ?? theme).join(' · ')}</Text> : null}
      <View style={styles.actions}>
        {newUnlocks.length || reward.owned ? <BounceButton label="해금한 꾸미기 보기" onPress={() => router.push('/studio')} /> : null}
        <BounceButton label="다시 하기" onPress={onRetry} /><BounceButton label="다른 게임" variant="secondary" onPress={onExit} />
      </View>
    </View> : phase === 'finishing' || phase === 'finishError' ? <View style={styles.result}>
      <Text style={[styles.resultLabel, { color: palette.label }]}>{phase === 'finishing' ? '기록을 저장하고 있어요' : '기록을 보내지 못했어요'}</Text>
      {error ? <Text style={[styles.resultText, { color: palette.error }]}>{error}</Text> : null}
      {phase === 'finishError' ? <View style={styles.actions}><BounceButton label={errorNeedsConsent ? consentRecheckLabel : '같은 기록 다시 보내기'} onPress={errorNeedsConsent ? recheckConsent : () => void finishCurrent(actionsRef.current)} /><BounceButton label="나가기" variant="secondary" onPress={onExit} /></View> : null}
    </View> : <>
      {board.kind === 'stack' ? <StackBoard board={board} actions={actions} elapsed={elapsed} motionEnabled={motionEnabled} onDrop={dropStack} /> : null}
      {board.kind === 'memory' ? <View style={styles.memoryGrid}>{board.cards.map((value, index) => {
        const shown = matched.includes(index) || flipped.includes(index);
        return <Pressable key={index} accessibilityRole="button" accessibilityLabel={`카드 ${index + 1}${shown ? `, ${tokenName(art, value)}` : ', 뒤집힘'}`}
          accessibilityState={{ disabled: shown || memoryLocked }} disabled={shown || memoryLocked} onPress={() => flip(index)}
          style={[styles.memoryCard, { backgroundColor: shown ? '#FFF9EB' : '#3C777D', borderColor: shown ? '#D8B972' : '#2C666D' }]}>
          {shown ? <GameToken value={value} art={art} size={Math.min(58, (width - 100) / 4)} /> : <Text style={styles.cardBack}>✦</Text>}
        </Pressable>;
      })}</View> : null}
      {board.kind === 'delivery' ? <DeliveryBoard board={board} elapsed={elapsed} crossed={crossed} points={deliveryPoints} lane={lane} avatar={avatar} equipment={equipment} clothing={clothing} motionEnabled={motionEnabled} compact={compactControls} roadHeight={roadHeight} onLane={changeLane} /> : null}
      {board.kind === 'orders' ? <OrdersBoard board={board} actions={actions} compact={compactControls} onChoose={(choice) => { const next = add(choice); if (next && next.length === 12) void finishCurrent(next); }} /> : null}
      <Pressable accessibilityRole="button" onPress={() => board.kind === 'delivery' ? finishDelivery(getElapsed()) : void finishCurrent(actionsRef.current)} style={styles.giveUp}><Text style={[styles.giveUpText, { color: palette.secondaryLabel }]}>여기서 끝내기</Text></Pressable>
    </>}
  </View>;
}

function StackBoard({ board, actions, elapsed, motionEnabled, onDrop }: { board: Extract<ReturnType<typeof getGameBoard>, { kind: 'stack' }>; actions: readonly GameAction[]; elapsed: number; motionEnabled: boolean; onDrop: () => void }) {
  const muted = colorsForScheme(useColorScheme()).secondaryLabel;
  const round = actions.length;
  const current = board.rounds[Math.min(round, board.rounds.length - 1)]!;
  const cursor = stackCursor(current, elapsed);
  const total = actions.reduce((score, action, index) => score + Math.max(0, 100 - Math.abs(stackCursor(board.rounds[index]!, action.at) - board.rounds[index]!.target) * 4), 0);
  return <View style={styles.stackArea}>
    <View style={styles.stackTower}>{actions.map((action, index) => {
      const layer = board.rounds[index]!;
      const hit = Math.abs(stackCursor(layer, action.at) - layer.target) <= layer.width / 2;
      return <View key={index} accessibilityLabel={`${index + 1}층 ${hit ? '성공' : '빗나감'}`} style={[styles.stackLayer, { width: `${Math.max(45, 88 - index * 7)}%`, backgroundColor: hit ? '#70BA97' : '#E17D71', borderColor: hit ? '#347E5D' : '#AA6850' }]} />;
    })}</View>
    <View style={styles.stackRail}>
      <View style={[styles.stackTarget, { left: `${current.target - current.width / 2}%`, width: `${current.width}%` }]} />
      {motionEnabled ? <View style={[styles.stackCursor, { left: `${cursor}%` }]} /> : null}
    </View>
    <Text style={[styles.boardHint, { color: muted }]}>{motionEnabled ? `쌓은 점수 ${total}점 · 빛나는 자리에 맞춰요` : `쌓은 점수 ${total}점 · 목표 ${current.target - Math.floor(current.width / 2)}~${current.target + Math.floor(current.width / 2)} · 현재 ${cursor}`}</Text>
    <BounceButton label="지금 놓기" onPress={onDrop} />
  </View>;
}

function DeliveryBoard({ board, elapsed, crossed, points, lane, avatar, equipment, clothing, motionEnabled, compact, roadHeight, onLane }: { board: Extract<ReturnType<typeof getGameBoard>, { kind: 'delivery' }>; elapsed: number; crossed: number; points: number; lane: number; avatar: string | null; equipment?: DisplayExperienceProfile; clothing?: EquippedClothingArt | null; motionEnabled: boolean; compact: boolean; roadHeight: number; onLane: (lane: number) => void }) {
  const muted = colorsForScheme(useColorScheme()).secondaryLabel;
  const upcoming = board.ticks.filter((tick) => tick.at > elapsed).slice(0, 2);
  const travel = roadHeight - 60;
  return <View>
    <Text style={[styles.deliveryScore, { color: muted }]}>획득 {points}점 · 남은 구간 {board.ticks.length - crossed}</Text>
    <View style={[styles.road, { height: roadHeight }]}>
      {[0, 1, 2].map((index) => <View key={index} style={[styles.roadLane, { borderRightWidth: index === 2 ? 0 : 2 }]} />)}
      {upcoming.map((tick) => {
        const y = motionEnabled ? Math.max(0, Math.min(travel, travel - (tick.at - elapsed) / 2000 * travel)) : tick.at === upcoming[0]?.at ? Math.floor(travel / 2) : 0;
        return <View key={tick.at} style={[styles.obstacleRow, { top: y }]}>
          {[0, 1, 2].map((index) => <View key={index} style={styles.roadCell}>
            {index === tick.blockedLane ? <Text style={[styles.obstacle, compact && styles.obstacleCompact]}>×</Text> : index === tick.bonusLane ? <FoodToken value={(tick.at / 2000) % 4} size={compact ? 28 : 38} /> : null}
          </View>)}
        </View>;
      })}
      <View style={styles.runnerRow}>{[0, 1, 2].map((index) => <View key={index} style={styles.roadCell}>{index === lane ? <Companion avatar={avatar} equipment={equipment} clothing={clothing} /> : null}{index === lane && !avatar ? <Text style={[styles.runnerFallback, compact && styles.runnerFallbackCompact]}>●</Text> : null}</View>)}</View>
    </View>
    {!motionEnabled && upcoming[0] ? <Text style={[styles.boardHint, { color: muted }]}>다음 장애물: {laneNames[upcoming[0].blockedLane]} · 선물: {laneNames[upcoming[0].bonusLane]}</Text> : null}
    <View style={styles.laneButtons}>{[0, 1, 2].map((index) => <Pressable key={index} accessibilityRole="button" accessibilityLabel={`${laneNames[index]} 길로 이동`} accessibilityState={{ selected: index === lane }} onPress={() => onLane(index)} style={[styles.laneButton, index === lane && styles.laneSelected]}><Text style={[styles.laneText, index === lane && styles.laneSelectedText]}>{laneNames[index]}</Text></Pressable>)}</View>
  </View>;
}

function OrdersBoard({ board, actions, compact, onChoose }: { board: Extract<ReturnType<typeof getGameBoard>, { kind: 'orders' }>; actions: readonly GameAction[]; compact: boolean; onChoose: (choice: number) => void }) {
  const muted = colorsForScheme(useColorScheme()).secondaryLabel;
  const step = actions.length;
  const order = board.orders[Math.min(Math.floor(step / 3), 3)]!;
  const targets = board.orders.flat();
  let combo = 0;
  for (let index = 0; index < actions.length; index++) combo = actions[index]?.choice === targets[index] ? combo + 1 : 0;
  return <View style={[styles.ordersArea, compact && styles.ordersAreaCompact]}>
    <Text style={[styles.orderHeading, compact && styles.orderHeadingCompact]}>주문 {Math.min(4, Math.floor(step / 3) + 1)}/4 · 연속 {combo}</Text>
    <View style={[styles.orderTicket, compact && styles.orderTicketCompact]}>{order.map((token, index) => {
      const previous = Math.floor(step / 3) * 3 + index;
      const cleared = previous < step;
      return <View key={index} style={[styles.orderToken, compact && styles.orderTokenCompact, index === step % 3 && styles.orderTokenActive]}>
        {cleared ? <Text style={[styles.clearedToken, { color: actions[previous]?.choice === token ? '#3E8666' : '#AF584B' }]}>{actions[previous]?.choice === token ? '✓' : '×'}</Text> : <FoodToken value={token} size={compact ? 34 : 45} />}
        <Text style={styles.orderNumber}>{index + 1}</Text>
      </View>;
    })}</View>
    <Text style={[styles.boardHint, { color: muted }]}>{compact ? '다음 메뉴' : '빛나는 차례의 메뉴를 눌러요'}</Text>
    <View style={[styles.foodGrid, compact && styles.foodGridCompact]}>{[0, 1, 2, 3].map((token) => <Pressable key={token} accessibilityRole="button" accessibilityLabel={foodNames[token]} onPress={() => onChoose(token)} style={[styles.foodButton, compact && styles.foodButtonCompact]}><FoodToken value={token} size={compact ? 40 : 64} /><Text style={[styles.foodLabel, compact && styles.foodLabelCompact]}>{foodNames[token]}</Text></Pressable>)}</View>
  </View>;
}

const styles = StyleSheet.create({
  session: { gap: 10, paddingBottom: 24 },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  statusTitle: { flexShrink: 1, minWidth: 0, maxWidth: '100%' },
  kicker: { fontSize: 13, fontWeight: '800' }, title: { fontSize: 26, fontWeight: '900' },
  timer: { fontSize: 28, fontWeight: '900', fontVariant: ['tabular-nums'], marginLeft: 'auto' },
  progressRow: { gap: 8 }, progressText: { fontSize: 14, fontWeight: '700' },
  progressTrack: { height: 7, borderRadius: 4, overflow: 'hidden' }, progressFill: { height: 7, borderRadius: 4 },
  result: { gap: 12, alignItems: 'center', paddingVertical: 42 }, resultLabel: { fontSize: 18, fontWeight: '800', textAlign: 'center' },
  score: { fontSize: 48, fontWeight: '900' }, resultText: { fontSize: 15, textAlign: 'center', lineHeight: 22 },
  newBest: { fontSize: 18, fontWeight: '800' }, unlock: { fontSize: 15, textAlign: 'center' },
  skillResult: { width: '100%', gap: 6, padding: 14, borderWidth: 2, borderRadius: 8 },
  skillTitle: { fontSize: 18, fontWeight: '900', textAlign: 'center' },
  feedback: { minHeight: 24, fontSize: 16, fontWeight: '800', textAlign: 'center' },
  actions: { width: '100%', gap: 10, marginTop: 16 },
  stackArea: { gap: 10 }, stackTower: { height: 130, alignItems: 'center', justifyContent: 'flex-end', gap: 2 },
  stackLayer: { height: 18, borderRadius: 5, borderWidth: 2, borderColor: '#AA6850' },
  stackRail: { height: 46, borderRadius: 8, backgroundColor: '#EAF2ED', justifyContent: 'center' },
  stackTarget: { position: 'absolute', top: 5, height: 36, backgroundColor: '#F3D373', borderRadius: 5 },
  stackCursor: { position: 'absolute', top: 2, width: 16, height: 42, marginLeft: -8, borderRadius: 4, backgroundColor: '#DF6D62', borderWidth: 2, borderColor: '#883D39' },
  boardHint: { textAlign: 'center', fontSize: 15, fontWeight: '700' },
  memoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  memoryCard: { width: '22%', aspectRatio: 0.83, minHeight: 64, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderRadius: 7 },
  cardBack: { color: '#FFF', fontSize: 31, fontWeight: '900' },
  road: { backgroundColor: '#D9E9D8', borderRadius: 8, flexDirection: 'row', overflow: 'hidden', borderWidth: 2, borderColor: '#6D9E78' },
  deliveryScore: { fontSize: 16, fontWeight: '800', marginBottom: 10 },
  roadLane: { flex: 1, borderColor: '#AAC6A9', borderStyle: 'dashed' }, obstacleRow: { position: 'absolute', width: '100%', flexDirection: 'row' },
  roadCell: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 55 },
  obstacle: { color: '#A5463D', fontSize: 43, fontWeight: '900' }, obstacleCompact: { fontSize: 28 }, runnerRow: { position: 'absolute', bottom: 4, width: '100%', flexDirection: 'row' },
  runnerFallback: { color: '#336B67', fontSize: 42 }, runnerFallbackCompact: { fontSize: 28 },
  laneButtons: { flexDirection: 'row', gap: 8, marginTop: 12 }, laneButton: { flex: 1, minHeight: 58, alignItems: 'center', justifyContent: 'center', borderRadius: 7, backgroundColor: '#E4EDE9', borderWidth: 2, borderColor: '#A7C4BB' },
  laneSelected: { backgroundColor: '#3A8C75', borderColor: '#266950' }, laneText: { color: '#285B4E', fontSize: 16, fontWeight: '800' }, laneSelectedText: { color: '#FFF' },
  ordersArea: { gap: 16 }, ordersAreaCompact: { gap: 8 }, orderHeading: { color: '#916C2B', fontSize: 17, fontWeight: '800' }, orderHeadingCompact: { fontSize: 14 },
  orderTicket: { flexDirection: 'row', justifyContent: 'space-around', backgroundColor: '#FFF8E9', borderWidth: 2, borderColor: '#EACF95', borderRadius: 7, padding: 12 }, orderTicketCompact: { padding: 6 },
  orderToken: { width: '30%', minHeight: 78, opacity: 0.5, alignItems: 'center', justifyContent: 'center', gap: 4 }, orderTokenCompact: { minHeight: 58 },
  orderTokenActive: { opacity: 1, backgroundColor: '#FFE9A7', borderRadius: 7 }, orderNumber: { fontSize: 13, color: '#6C5229', fontWeight: '800' },
  clearedToken: { fontSize: 39, fontWeight: '900' },
  foodGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, foodGridCompact: { gap: 6 }, foodButton: { width: '48%', minHeight: 120, borderWidth: 2, borderColor: '#E4C99E', borderRadius: 7, backgroundColor: '#FFFAEF', alignItems: 'center', justifyContent: 'center', gap: 4 }, foodButtonCompact: { minHeight: 78, gap: 2 },
  foodLabel: { color: '#594222', fontSize: 14, fontWeight: '700', textAlign: 'center' }, foodLabelCompact: { fontSize: 12 },
  giveUp: { alignSelf: 'center', minHeight: 48, paddingHorizontal: 20, justifyContent: 'center' }, giveUpText: { fontSize: 14, textDecorationLine: 'underline' },
});
