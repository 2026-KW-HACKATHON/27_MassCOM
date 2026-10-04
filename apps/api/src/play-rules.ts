export const gameKinds = ['stack', 'memory', 'delivery', 'orders'] as const;
export type GameKind = (typeof gameKinds)[number];
export type GameAction = { at: number; choice: number };
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

export function scoreRun(kind: GameKind, seed: number, actions: readonly GameAction[]): {
  score: number; completed: boolean; correct: number; total: number;
} {
  const board = getGameBoard(kind, seed);
  const maxActions = kind === 'memory' ? 36 : kind === 'delivery' ? 20 : kind === 'stack' ? 6 : 12;
  if (!Array.isArray(actions) || actions.length > maxActions) throw new Error('INVALID_GAME_ACTIONS');
  let previous = -1;
  for (const action of actions) {
    const maxChoice = kind === 'memory' ? 12 : kind === 'delivery' ? 3 : kind === 'orders' ? 4 : 1;
    if (!action || !Number.isSafeInteger(action.at) || action.at <= previous || action.at > gameDurationMs ||
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
