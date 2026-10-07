export const gameNames = [
  "타이밍 쌓기",
  "짝 찾기",
  "세 갈래 배달",
  "주문 맞추기",
] as const;
export type GameSession = {
  id: string;
  kind: number;
  practice: boolean;
  paused: boolean;
  done: boolean;
  remaining: number;
  score: number;
  position: number;
  direction: number;
  width: number;
  misses: number;
  cards: number[];
  open: number[];
  matched: number[];
  cooldown: number;
  target: number;
  order: number[];
  selected: number[];
};
export type GameAction =
  | { type: "tick" }
  | { type: "place" }
  | { type: "flip"; value: number }
  | { type: "deliver"; value: number }
  | { type: "ingredient"; value: number }
  | { type: "submit" }
  | { type: "clear" }
  | { type: "pause"; value: boolean };
export function newGame(
  kind: number,
  practice = false,
  random = Math.random,
): GameSession {
  const cards = [0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5];
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [cards[i], cards[j]] = [cards[j]!, cards[i]!];
  }
  return {
    id: `game-${Date.now()}-${random().toString(36).slice(2)}`,
    kind,
    practice,
    paused: false,
    done: false,
    remaining: 450,
    score: 0,
    position: 5,
    direction: 1,
    width: 70,
    misses: 0,
    cards,
    open: [],
    matched: [],
    cooldown: 0,
    target: 1,
    order: [0, 1],
    selected: [],
  };
}
export function gameStep(g: GameSession, a: GameAction): GameSession {
  if (a.type === "pause") return { ...g, paused: a.value };
  if (g.paused || g.done) return g;
  if (a.type === "tick") {
    const position = g.position + g.direction * 4;
    const cooldown = Math.max(0, g.cooldown - 1);
    return {
      ...g,
      remaining: Math.max(0, g.remaining - 1),
      done: g.remaining <= 1,
      position: Math.max(0, Math.min(100, position)),
      direction: position >= 100 ? -1 : position <= 0 ? 1 : g.direction,
      cooldown,
      open: g.cooldown === 1 ? [] : g.open,
    };
  }
  if (a.type === "place" && g.kind === 0) {
    const error = Math.abs(50 - g.position);
    const width = Math.max(0, g.width - error * 0.22);
    return {
      ...g,
      width,
      score: g.score + Math.round(Math.max(0, 100 - error)),
      done: width < 12,
    };
  }
  if (a.type === "flip" && g.kind === 1) {
    if (
      g.open.includes(a.value) ||
      g.matched.includes(a.value) ||
      g.open.length >= 2 ||
      a.value < 0 ||
      a.value >= 12
    )
      return g;
    const open = [...g.open, a.value];
    if (open.length === 2 && g.cards[open[0]!] === g.cards[open[1]!]) {
      const matched = [...g.matched, ...open];
      return {
        ...g,
        open: [],
        matched,
        score: g.score + 100,
        done: matched.length === 12,
      };
    }
    return { ...g, open, cooldown: open.length === 2 ? 8 : 0 };
  }
  if (a.type === "deliver" && g.kind === 2) {
    const correct = a.value === g.target;
    const misses = g.misses + (correct ? 0 : 1);
    return {
      ...g,
      score: Math.max(0, g.score + (correct ? 80 : -20)),
      target: (g.target + 1) % 3,
      misses,
      done: misses >= 3,
    };
  }
  if (a.type === "ingredient" && g.kind === 3)
    return { ...g, selected: [...g.selected, a.value].slice(0, 4) };
  if (a.type === "clear") return { ...g, selected: [] };
  if (a.type === "submit" && g.kind === 3) {
    const correct =
      g.order.length === g.selected.length &&
      g.order.every((n, i) => g.selected[i] === n);
    return {
      ...g,
      selected: [],
      score: Math.max(0, g.score + (correct ? 120 : -20)),
      order: correct ? g.order.map((n) => (n + 1) % 6) : g.order,
    };
  }
  return g;
}
