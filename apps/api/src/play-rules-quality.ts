import { gameDurationMs, getGameBoard, minimumActionGapMs, stackCursor,
  type GameAction, type GameKind } from './play-rules.js';

type Common = { score: number; completed: boolean; correct: number; total: number; failed: boolean };
export type QualityGameState =
  | (Common & { kind: 'stack'; base: { left: number; width: number }; placed: { left: number; width: number; center: number; overlap: number }[];
      current: { left: number; width: number }; remainingWidth: number; precisionStreak: number; bestPrecisionStreak: number })
  | (Common & { kind: 'memory'; cards: number[]; matchedIndices: number[]; firstIndex: number | null; misses: number })
  | (Common & { kind: 'delivery'; lane: number; tick: number; collisions: number; cargoHealth: number; arrived: boolean })
  | (Common & { kind: 'orders'; orders: number[][]; orderIndex: number; tray: number[]; combo: number;
      bestCombo: number; wrongSubmissions: number });

const invalid = (): never => { throw new Error('INVALID_GAME_ACTIONS'); };

/** Pure rules engine shared by the API and active game screen. elapsedMs is the server clock at finish. */
export function getQualityGameState(kind: GameKind, seed: number, actions: readonly GameAction[], elapsedMs: number): QualityGameState {
  const board = getGameBoard(kind, seed);
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || !Array.isArray(actions) ||
    actions.length > (kind === 'memory' ? 36 : kind === 'delivery' ? 20 : kind === 'orders' ? 60 : 6)) invalid();
  let previous = -1;
  for (const [index, action] of actions.entries()) {
    const maxChoice = kind === 'memory' ? 12 : kind === 'delivery' ? 3 : kind === 'orders' ? 7 : 1;
    const finalSample = kind === 'delivery' && index === actions.length - 1 && index > 0 &&
      action?.choice === actions[index - 1]?.choice;
    if (!action || !Number.isSafeInteger(action.at) || action.at <= previous || action.at > gameDurationMs ||
      action.at > elapsedMs + 2000 ||
      (previous >= 0 && action.at - previous < minimumActionGapMs[kind] && !finalSample) ||
      !Number.isInteger(action.choice) || action.choice < 0 || action.choice >= maxChoice) invalid();
    previous = action.at;
  }
  if (board.kind === 'stack') {
    const placed: Extract<QualityGameState, {kind: 'stack'}>['placed'] = [];
    let base = { left: 20, width: 60 };
    let precisionStreak = 0;
    let bestPrecisionStreak = 0;
    let score = 0;
    let failed = false;
    for (const [index, action] of actions.entries()) {
      if (failed || index >= board.rounds.length) invalid();
      const movingLeft = stackCursor(board.rounds[index]!, action.at) * (100 - base.width) / 100;
      const left = Math.max(base.left, movingLeft);
      const right = Math.min(base.left + base.width, movingLeft + base.width);
      const width = Math.max(0, right - left);
      if (width <= 0) { failed = true; precisionStreak = 0; continue; }
      const offset = Math.abs((movingLeft + base.width / 2) - (base.left + base.width / 2));
      precisionStreak = offset <= 3 ? precisionStreak + 1 : 0;
      bestPrecisionStreak = Math.max(bestPrecisionStreak, precisionStreak);
      score += Math.round(100 * width / base.width);
      base = { left, width };
      placed.push({ ...base, center: left + width / 2, overlap: width });
    }
    const round = board.rounds[Math.min(placed.length, board.rounds.length - 1)]!;
    const current = { left: stackCursor(round, elapsedMs) * (100 - base.width) / 100, width: base.width };
    return { kind: 'stack', base, placed, current, remainingWidth: base.width, precisionStreak, bestPrecisionStreak,
      score, completed: !failed && placed.length === board.rounds.length, correct: placed.length,
      total: board.rounds.length, failed };
  }
  if (board.kind === 'memory') {
    const matched = new Set<number>();
    let first: number | null = null;
    let misses = 0;
    for (const action of actions) {
      if (matched.has(action.choice) || first === action.choice || matched.size === board.cards.length) invalid();
      if (first === null) first = action.choice;
      else {
        if (board.cards[first] === board.cards[action.choice]) { matched.add(first); matched.add(action.choice); }
        else misses++;
        first = null;
      }
    }
    const correct = matched.size / 2;
    return { kind: 'memory', cards: board.cards, matchedIndices: [...matched], firstIndex: first, misses,
      score: Math.max(0, correct * 100 - misses * 15), completed: correct === 6 && first === null,
      correct, total: 6, failed: false };
  }
  if (board.kind === 'delivery') {
    let lane = 1;
    let cursor = 0;
    let correct = 0;
    let score = 0;
    let collisions = 0;
    let tick = 0;
    for (const checkpoint of board.ticks) {
      if (checkpoint.at > elapsedMs || collisions >= 3) break;
      while (cursor < actions.length && actions[cursor]!.at <= checkpoint.at) lane = actions[cursor++]!.choice;
      tick++;
      if (lane === checkpoint.blockedLane) collisions++;
      else { correct++; score += lane === checkpoint.bonusLane ? 100 : 65; }
    }
    // A lane change after the last processed checkpoint still changes the visible courier lane.
    while (cursor < actions.length && actions[cursor]!.at <= elapsedMs) lane = actions[cursor++]!.choice;
    const failed = collisions >= 3;
    const arrived = !failed && tick === board.ticks.length;
    return { kind: 'delivery', lane, tick, collisions, cargoHealth: 3 - collisions, arrived,
      score, completed: arrived, correct, total: board.ticks.length, failed };
  }
  let orderIndex = 0;
  let tray: number[] = [];
  let combo = 0;
  let peakCombo = 0;
  let wrongSubmissions = 0;
  let score = 0;
  for (const action of actions) {
    if (orderIndex === board.orders.length) invalid();
    if (action.choice < 4) {
      if (tray.length >= 3) invalid();
      tray.push(action.choice);
    } else if (action.choice === 5) tray.pop();
    else if (action.choice === 6) tray = [];
    else {
      const needed = board.orders[orderIndex]!;
      if (tray.length === needed.length && [...tray].sort().join(',') === [...needed].sort().join(',')) {
        combo += needed.length;
        peakCombo = Math.max(peakCombo, combo);
        score += 240 + Math.min(60, combo * 5);
        tray = [];
        orderIndex++;
      } else { combo = 0; wrongSubmissions++; }
    }
  }
  return { kind: 'orders', orders: board.orders, orderIndex, tray, combo, bestCombo: peakCombo, wrongSubmissions,
    score: Math.max(0, score - wrongSubmissions * 20), completed: orderIndex === board.orders.length,
    correct: orderIndex * 3, total: 12, failed: false };
}

export function evaluateQualityGameSkill(state: QualityGameState) {
  const target = state.kind === 'stack' ? 3 : state.kind === 'memory' ? 6 : state.kind === 'delivery' ? 12 : 8;
  const progress = state.kind === 'stack' ? state.bestPrecisionStreak :
    state.kind === 'memory' ? Math.max(0, state.correct - Math.max(0, state.misses - 1)) :
    state.kind === 'delivery' ? state.correct : state.bestCombo;
  return { progress: Math.min(progress, target), achieved: state.completed && progress >= target };
}
