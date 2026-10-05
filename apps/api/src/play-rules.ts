export const gameKinds = ['stack', 'memory', 'delivery', 'orders'] as const;
export type GameKind = (typeof gameKinds)[number];
export type GameAction = { at: number; choice: number };
export const gameSkills = {
  stack: { id: 'stack-precision', target: 3 },
  memory: { id: 'match-efficient', target: 6 },
  delivery: { id: 'delivery-clean', target: 12 },
  orders: { id: 'order-streak', target: 8 },
} as const;
export type GameSkill = { id: (typeof gameSkills)[GameKind]['id']; progress: number; target: number; achieved: boolean };
// These scores prove the skill even for runs saved before skill details existed.
export const legacyGameAchievementScore: Readonly<Record<GameKind, number>> = {
  stack: 600, memory: 600, delivery: 1200, orders: 1125,
};
export type PlayRun = { id: string; kind: GameKind; seed: number; startedAt: string; expiresAt: string; durationMs: number; rulesVersion: 1 };

export const gameDurationMs = 30_000;
export type GameBoard =
  | { kind: 'stack'; rounds: { target: number; width: number; periodMs: number; phase: number }[] }
  | { kind: 'memory'; cards: number[] }
  | { kind: 'delivery'; ticks: { at: number; blockedLane: number; bonusLane: number }[] }
  | { kind: 'orders'; orders: number[][] };

export function isGameKind(value: unknown): value is GameKind {
  return typeof value === 'string' && gameKinds.some((kind) => kind === value);
}

function next(state: number): number {
  let value = state >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return value >>> 0;
}

function source(seed: number, salt: number): () => number {
  let state = (seed ^ salt) >>> 0;
  return () => {
    state = next(state || 0x6d2b79f5);
    return state;
  };
}

export function getGameBoard(kind: GameKind, seed: number): GameBoard {
  if (!isGameKind(kind) || !Number.isSafeInteger(seed) || seed < 0 || seed > 0x7fffffff) throw new Error('INVALID_GAME_SCENE');
  const draw = source(seed, 0x9e3779b9);
  if (kind === 'stack') {
    return { kind, rounds: Array.from({ length: 6 }, () => ({
      target: 15 + draw() % 71, width: 14 + draw() % 15,
      periodMs: 1000 + draw() % 600, phase: draw() % 1000,
    })) };
  }
  if (kind === 'memory') {
    const cards = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5];
    for (let index = cards.length - 1; index > 0; index--) {
      const other = draw() % (index + 1);
      [cards[index], cards[other]] = [cards[other]!, cards[index]!];
    }
    return { kind, cards };
  }
  if (kind === 'delivery') {
    return { kind, ticks: Array.from({ length: 12 }, (_, index) => {
      const blockedLane = draw() % 3;
      return { at: 2000 * (index + 1), blockedLane, bonusLane: (blockedLane + 1 + draw() % 2) % 3 };
    }) };
  }
  return { kind, orders: Array.from({ length: 4 }, () => Array.from({ length: 3 }, () => draw() % 4)) };
}

export function stackCursor(round: { periodMs: number; phase: number }, at: number): number {
  const progress = (((at + round.phase) % round.periodMs) + round.periodMs) % round.periodMs / round.periodMs;
  return Math.round((progress <= 0.5 ? progress * 2 : (1 - progress) * 2) * 100);
}

// 모바일 입력 수락 간격과 같은 값이어야 한다(모바일 계약 시험이 이 상수를 읽는다).
export const minimumActionGapMs: Readonly<Record<GameKind, number>> = { stack: 150, memory: 80, delivery: 150, orders: 100 };

export function minimumCompletedElapsedMs(kind: GameKind, seed: number): number {
  const board = getGameBoard(kind, seed);
  if (board.kind === 'delivery') return board.ticks.at(-1)!.at;
  // 첫 입력은 즉시 가능하므로, 모바일 로그가 요구 간격을 지켰다면 완료 시점에 추가 대기를 요구하지 않는다.
  const requiredInputs = board.kind === 'stack' ? board.rounds.length :
    board.kind === 'memory' ? board.cards.length : board.orders.flat().length;
  return (requiredInputs - 1) * minimumActionGapMs[kind];
}

export function scoreRun(kind: GameKind, seed: number, actions: readonly GameAction[]): {
  score: number; completed: boolean; correct: number; total: number;
} {
  const board = getGameBoard(kind, seed);
  const maxActions = kind === 'memory' ? 36 : kind === 'delivery' ? 20 : kind === 'stack' ? 6 : 12;
  if (!Array.isArray(actions) || actions.length > maxActions) throw new Error('INVALID_GAME_ACTIONS');
  let previous = -1;
  for (const [index, action] of actions.entries()) {
    const maxChoice = kind === 'memory' ? 12 : kind === 'delivery' ? 3 : kind === 'orders' ? 4 : 1;
    const finalDeliverySample = board.kind === 'delivery' && index === actions.length - 1 && actions.length > 1 && action &&
      action.choice === actions.at(-2)?.choice;
    if (!action || !Number.isSafeInteger(action.at) || action.at <= previous || action.at > gameDurationMs ||
        (previous >= 0 && action.at - previous < minimumActionGapMs[kind] && !finalDeliverySample) ||
        !Number.isInteger(action.choice) || action.choice < 0 || action.choice >= maxChoice) throw new Error('INVALID_GAME_ACTIONS');
    previous = action.at;
  }
  if (board.kind === 'stack') {
    let correct = 0;
    let score = 0;
    actions.forEach((action, index) => {
      const round = board.rounds[index]!;
      const distance = Math.abs(stackCursor(round, action.at) - round.target);
      if (distance <= round.width / 2) correct++;
      score += Math.max(0, 100 - distance * 4);
    });
    return { score, completed: actions.length === board.rounds.length, correct, total: board.rounds.length };
  }
  if (board.kind === 'memory') {
    const matched = new Set<number>();
    let first: number | null = null;
    let misses = 0;
    for (const action of actions) {
      if (matched.has(action.choice) || first === action.choice) throw new Error('INVALID_GAME_ACTIONS');
      if (first === null) first = action.choice;
      else {
        if (board.cards[first] === board.cards[action.choice]) {
          matched.add(first); matched.add(action.choice);
        } else misses++;
        first = null;
      }
    }
    const correct = matched.size / 2;
    return { score: Math.max(0, correct * 100 - misses * 15), completed: correct === 6 && first === null,
      correct, total: 6 };
  }
  if (board.kind === 'delivery') {
    let lane = 1;
    let cursor = 0;
    let correct = 0;
    let score = 0;
    const lastAt = actions.at(-1)?.at ?? 0;
    for (const tick of board.ticks) {
      if (tick.at > lastAt) break;
      while (cursor < actions.length && actions[cursor]!.at <= tick.at) lane = actions[cursor++]!.choice;
      if (lane !== tick.blockedLane) { correct++; score += lane === tick.bonusLane ? 100 : 65; }
    }
    return { score, completed: actions.length > 0 && actions.at(-1)!.at >= board.ticks.at(-1)!.at,
      correct, total: board.ticks.length };
  }
  let correct = 0;
  let combo = 0;
  let score = 0;
  const tokens = board.orders.flat();
  actions.forEach((action, index) => {
    if (action.choice === tokens[index]) { correct++; combo++; score += 70 + Math.min(30, combo * 5); }
    else combo = 0;
  });
  return { score, completed: actions.length === tokens.length, correct, total: tokens.length };
}

export function scoreRunAtElapsed(kind: GameKind, seed: number, actions: readonly GameAction[], elapsedMs: number):
  ReturnType<typeof scoreRun> {
  const score = scoreRun(kind, seed, actions);
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 ||
      actions.some((action) => action.at > elapsedMs + 2000) ||
      (score.completed && elapsedMs < minimumCompletedElapsedMs(kind, seed))) {
    throw new Error('INVALID_GAME_ACTIONS');
  }
  return score;
}

export function evaluateGameSkill(kind: GameKind, seed: number, actions: readonly GameAction[],
  scored = scoreRun(kind, seed, actions)): GameSkill {
  const board = getGameBoard(kind, seed);
  let progress = 0;
  if (board.kind === 'stack') {
    let streak = 0;
    actions.forEach((action, index) => {
      streak = Math.abs(stackCursor(board.rounds[index]!, action.at) - board.rounds[index]!.target) <= 4 ? streak + 1 : 0;
      progress = Math.max(progress, streak);
    });
  } else if (board.kind === 'memory') {
    const misses = (actions.length / 2) - scored.correct;
    progress = Math.max(0, scored.correct - Math.max(0, misses - 1));
  } else if (board.kind === 'delivery') {
    progress = scored.correct;
  } else {
    let streak = 0;
    const targets = board.orders.flat();
    actions.forEach((action, index) => {
      streak = action.choice === targets[index] ? streak + 1 : 0;
      progress = Math.max(progress, streak);
    });
  }
  const definition = gameSkills[kind];
  return { id: definition.id, progress: Math.min(progress, definition.target), target: definition.target,
    achieved: scored.completed && progress >= definition.target };
}
