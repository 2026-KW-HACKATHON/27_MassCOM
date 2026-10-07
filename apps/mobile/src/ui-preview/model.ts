// This module is a local UI test model. It never calls the production API.
export const STORAGE_KEY = "masscom:mint-ui-preview:v1";
export const grades = ["브론즈", "실버", "골드", "프리즘"] as const;
export type Grade = (typeof grades)[number];
export type NftState = "none" | "pending" | "minted";
export type Coin = {
  id: string;
  store: string;
  family: string;
  grade: Grade;
  nft: NftState;
};
export type Visibility = "나만 보기" | "친구" | "같은 가게 이웃";
export const stores = [
  {
    id: "cafe",
    name: "달빛 카페",
    family: "달빛 한 잔",
    art: "cafe",
    type: "카페",
    minutes: 5,
  },
  {
    id: "bakery",
    name: "행복 베이커리",
    family: "갓 구운 행복",
    art: "bakery",
    type: "베이커리",
    minutes: 8,
  },
  {
    id: "food",
    name: "초록 식당",
    family: "초록 한 끼",
    art: "foodStore",
    type: "음식점",
    minutes: 12,
  },
] as const;
export const furniture = [
  { id: "sofa", name: "포근한 민트 소파", price: 600, art: "sofa" },
  { id: "lamp", name: "버섯 스탠드 조명", price: 240, art: "lamp" },
  { id: "plant", name: "싱그러운 화분", price: 120, art: "plant" },
  { id: "table", name: "동그란 티 테이블", price: 180, art: "table" },
  { id: "bed", name: "포근한 원목 침대", price: 700, art: "bed" },
  { id: "shelf", name: "아늑한 책장", price: 300, art: "shelf" },
] as const;
export const neighbors = [
  {
    id: "mocha",
    name: "모카",
    art: "mocha",
    store: "cafe",
    visibility: "같은 가게 이웃" as Visibility,
  },
  {
    id: "rabbit",
    name: "토끼밍",
    art: "rabbit",
    store: "cafe",
    visibility: "같은 가게 이웃" as Visibility,
  },
  {
    id: "sky",
    name: "하늘이",
    art: "sky",
    store: "bakery",
    visibility: "같은 가게 이웃" as Visibility,
  },
  {
    id: "dog",
    name: "댕이",
    art: "dog",
    store: "food",
    visibility: "같은 가게 이웃" as Visibility,
  },
  {
    id: "private",
    name: "조용한 이웃",
    art: "penguin",
    store: "cafe",
    visibility: "나만 보기" as Visibility,
  },
];
export type Room = {
  wall: number;
  floor: number;
  furniture: string;
  x: number;
  y: number;
  rotation: number;
  displayed: string[];
  accessory: number;
  visibility: Visibility;
  welcome: string;
  guestbook: boolean;
  alerts: boolean;
};
export type Mail = {
  id: string;
  from: string;
  title: string;
  message: string;
  reward: number;
  read: boolean;
  claimed: boolean;
};
export type PreviewState = {
  version: 1;
  nickname: string;
  intro: string;
  points: number;
  sequence: number;
  tickets: Record<string, number>;
  visits: Record<string, number>;
  rerolls: [number, number, number];
  pool: Record<string, number[]>;
  coins: Coin[];
  representative: string;
  friends: string[];
  sentTo: string[];
  claimed: string[];
  mail: Mail[];
  messages: string[];
  guestbook: string[];
  liked: string[];
  ownedFurniture: string[];
  room: Room;
  navTheme: "mint" | "wood" | "night";
  iconStyle: "filled" | "line";
  accent: string;
  settings: Record<string, boolean | number>;
  wallet: boolean;
  terms: [boolean, boolean, boolean];
  ledger: { label: string; amount: number }[];
  scores: number[][];
  lastResult?: {
    before?: Coin;
    coin?: Coin;
    score?: number;
    game?: number;
    practice?: boolean;
  };
  lastPurchased?: string;
};
export function initialPreviewState(): PreviewState {
  return {
    version: 1,
    nickname: "모모",
    intro: "오늘은 골목 산책!",
    points: 1280,
    sequence: 10,
    tickets: { cafe: 2, bakery: 1, food: 3 },
    visits: { cafe: 2, bakery: 1, food: 1 },
    rerolls: [3, 2, 1],
    pool: { cafe: [8, 6, 4, 2], bakery: [8, 6, 4, 2], food: [8, 6, 4, 2] },
    coins: [
      {
        id: "c1",
        store: "cafe",
        family: "달빛 한 잔",
        grade: "브론즈",
        nft: "none",
      },
      {
        id: "c2",
        store: "cafe",
        family: "달빛 한 잔",
        grade: "실버",
        nft: "none",
      },
      {
        id: "c3",
        store: "bakery",
        family: "갓 구운 행복",
        grade: "브론즈",
        nft: "none",
      },
    ],
    representative: "c2",
    friends: ["하루", "소라", "민트"],
    sentTo: [],
    claimed: [],
    mail: [
      {
        id: "gift-sora",
        from: "소라",
        title: "소라의 우정",
        message: "모모야! 오늘도 좋은 하루 보내! 우리 다음에도 같이 산책하자.",
        reward: 5,
        read: false,
        claimed: false,
      },
      {
        id: "mission",
        from: "동네 소식",
        title: "오늘의 미션 보상",
        message: "첫 수집을 축하해요!",
        reward: 30,
        read: false,
        claimed: false,
      },
      {
        id: "invite",
        from: "하루",
        title: "하루의 식사 초대",
        message: "초록 식당에서 함께 밥 먹어요. 10월 10일, 12:00–14:00",
        reward: 0,
        read: false,
        claimed: false,
      },
    ],
    messages: [],
    guestbook: ["하루 · 커피 코인 전시가 멋져요!"],
    liked: [],
    ownedFurniture: ["lamp", "plant", "table"],
    room: {
      wall: 0,
      floor: 0,
      furniture: "",
      x: 40,
      y: 42,
      rotation: 0,
      displayed: ["c1", "c2"],
      accessory: 0,
      visibility: "친구",
      welcome: "놀러 와 주세요!",
      guestbook: true,
      alerts: true,
    },
    navTheme: "mint",
    iconStyle: "filled",
    accent: "#178773",
    settings: {
      music: true,
      effects: true,
      musicVolume: 70,
      effectsVolume: 80,
      vibration: false,
      reducedMotion: false,
      notifications: true,
      mail: true,
      friendship: true,
      visits: true,
      invites: true,
      rewards: true,
    },
    wallet: false,
    terms: [false, false, false],
    ledger: [{ label: "테스트 시작 마일리지", amount: 1280 }],
    scores: [[960, 1120, 880, 1240, 1030], [860], [980], [750]],
  };
}
function copy(state: PreviewState): PreviewState {
  return JSON.parse(JSON.stringify(state)) as PreviewState;
}
export function ownedTickets(state: PreviewState) {
  return [stores[1], stores[0], stores[2]].filter((s) => state.tickets[s.id] > 0);
}
export function coinFamilies(state: PreviewState, store: string): string[] {
  return [...new Set([
    ...stores.filter((s) => s.id === store).map((s) => s.family),
    ...state.coins.filter((c) => c.store === store).map((c) => c.family),
  ])];
}
export function collectionProgress(state: PreviewState, store: string) {
  const families = coinFamilies(state, store);
  const owned = new Set(state.coins.filter((c) => c.store === store)
    .map((c) => JSON.stringify([c.family, c.grade]))).size;
  return { owned, total: families.length * grades.length };
}
export function rerollUnavailable(state: PreviewState, id: string, ticket: number): string | null {
  const coin = state.coins.find((c) => c.id === id);
  if (!coin) return "이 코인은 더 이상 보유하고 있지 않아요.";
  if (coin.nft !== "none") return "NFT 발급 중이거나 받은 코인은 회수·리롤할 수 없어요.";
  if (![0, 1, 2].includes(ticket) || !(state.rerolls[ticket]! > 0))
    return "선택한 리롤권이 부족해요.";
  if (!state.pool[coin.store]?.some((n, i) => n > 0 && i >= (ticket === 2 ? 1 : 0)))
    return "선택한 등급의 가게 풀이 비어 있어요.";
  return null;
}
function requireCoin(state: PreviewState, id: string): Coin {
  const coin = state.coins.find((c) => c.id === id);
  if (!coin) throw new Error("이 코인은 더 이상 보유하고 있지 않아요.");
  return coin;
}
function pickGrade(pool: number[], minimum: number, random: number): number {
  const possible = pool
    .map((n, i) => (n > 0 && i >= minimum ? i : -1))
    .filter((i) => i >= 0);
  if (!possible.length) throw new Error("선택한 등급의 가게 풀이 비어 있어요.");
  return possible[
    Math.min(
      possible.length - 1,
      Math.floor(Math.max(0, Math.min(1, random)) * possible.length),
    )
  ]!;
}
export function drawCoin(
  state: PreviewState,
  storeId: string,
  random = Math.random(),
  requestId?: string,
): PreviewState {
  if (requestId && state.claimed.includes(`draw:${requestId}`)) return state;
  const store = stores.find((s) => s.id === storeId);
  if (!store || !state.pool[storeId])
    throw new Error("가게를 먼저 선택해 주세요.");
  if (!(state.tickets[storeId] > 0)) throw new Error("보유 뽑기권이 없어요.");
  const grade = pickGrade(state.pool[storeId], 0, random),
    next = copy(state);
  const coin: Coin = {
    id: `c${++next.sequence}`,
    store: storeId,
    family: store.family,
    grade: grades[grade]!,
    nft: "none",
  };
  next.tickets[storeId]--;
  next.pool[storeId]![grade]!--;
  next.coins.push(coin);
  if (requestId) next.claimed.push(`draw:${requestId}`);
  next.lastResult = { coin };
  return next;
}
export function rerollCoin(
  state: PreviewState,
  id: string,
  ticket: number,
  random = Math.random(),
): PreviewState {
  const unavailable = rerollUnavailable(state, id, ticket);
  if (unavailable) throw new Error(unavailable);
  const coin = requireCoin(state, id);
  const grade = pickGrade(
      state.pool[coin.store]!,
      ticket === 2 ? 1 : 0,
      random,
    ),
    next = copy(state);
  const fresh: Coin = {
    ...coin,
    id: `c${++next.sequence}`,
    family: grade === 3 ? "별밤의 선물" : coin.family,
    grade: grades[grade]!,
    nft: "none",
  };
  next.rerolls[ticket]!--;
  next.pool[coin.store]![grade]!--;
  next.coins = next.coins.filter((c) => c.id !== id);
  next.coins.push(fresh);
  next.room.displayed = next.room.displayed.filter((c) => c !== id);
  if (next.representative === id) next.representative = fresh.id;
  next.lastResult = { before: coin, coin: fresh };
  return next;
}
export function requestNft(state: PreviewState, id: string): PreviewState {
  const coin = requireCoin(state, id);
  if (coin.nft !== "none") throw new Error("이미 NFT 받기가 진행되었어요.");
  if (!state.wallet) throw new Error("테스트 지갑을 먼저 연결해 주세요.");
  const next = copy(state);
  requireCoin(next, id).nft = "pending";
  return next;
}
export function finishNft(state: PreviewState, id: string): PreviewState {
  if (requireCoin(state, id).nft !== "pending")
    throw new Error("발급 중인 코인만 확인할 수 있어요.");
  const next = copy(state);
  requireCoin(next, id).nft = "minted";
  return next;
}
export function buyFurniture(state: PreviewState, id: string): PreviewState {
  const item = furniture.find((f) => f.id === id);
  if (!item) throw new Error("상품을 찾을 수 없어요.");
  if (state.ownedFurniture.includes(id))
    throw new Error("이미 보유한 가구예요.");
  if (state.points < item.price) throw new Error("마일리지가 부족해요.");
  const next = copy(state);
  next.points -= item.price;
  next.ownedFurniture.push(id);
  next.lastPurchased = id;
  next.ledger.unshift({ label: `${item.name} 구매`, amount: -item.price });
  return next;
}
export function claimMail(state: PreviewState, id: string): PreviewState {
  const mail = state.mail.find((m) => m.id === id);
  if (!mail || mail.claimed || mail.reward <= 0)
    throw new Error("받을 보상이 없거나 이미 받았어요.");
  const next = copy(state),
    entry = next.mail.find((m) => m.id === id)!;
  entry.claimed = true;
  entry.read = true;
  next.points += entry.reward;
  next.ledger.unshift({ label: entry.title, amount: entry.reward });
  return next;
}
export function sendFriendship(
  state: PreviewState,
  name: string,
): PreviewState {
  if (!state.friends.includes(name))
    throw new Error("친구에게만 우정을 보낼 수 있어요.");
  if (state.sentTo.includes(name))
    throw new Error("이 친구에게 이미 우정을 보냈어요.");
  if (state.sentTo.length >= 5)
    throw new Error("오늘 보낼 수 있는 우정을 모두 보냈어요.");
  return { ...state, sentTo: [...state.sentTo, name] };
}
export function visitStore(state: PreviewState, id: string): PreviewState {
  if (!stores.some((s) => s.id === id))
    throw new Error("가게를 선택해 주세요.");
  const next = copy(state);
  next.visits[id] = (next.visits[id] ?? 0) + 1;
  if ([1, 3, 5].includes(next.visits[id]))
    next.tickets[id] = (next.tickets[id] ?? 0) + 1;
  return next;
}
export function canVisitNeighbor(
  state: PreviewState,
  neighbor: (typeof neighbors)[number],
): boolean {
  if (neighbor.visibility === "나만 보기") return false;
  if (state.friends.includes(neighbor.name)) return true;
  return (
    neighbor.visibility === "같은 가게 이웃" &&
    (state.visits[neighbor.store] ?? 0) > 0
  );
}
export function finishGame(
  state: PreviewState,
  game: number,
  score: number,
  runId: string,
  practice: boolean,
): PreviewState {
  if (
    !Number.isInteger(game) ||
    game < 0 ||
    game > 3 ||
    !Number.isFinite(score) ||
    score < 0
  )
    throw new Error("놀이 기록을 확인해 주세요.");
  if (state.claimed.includes(runId)) return state;
  const next = copy(state);
  next.claimed.push(runId);
  next.lastResult = { game, score, practice };
  if (!practice) {
    next.scores[game] = [...next.scores[game]!.slice(-4), score];
    next.points += 30;
    next.ledger.unshift({ label: "로컬 놀이 보상", amount: 30 });
    if (!next.ownedFurniture.includes("lamp")) next.ownedFurniture.push("lamp");
  }
  return next;
}
export function restorePreviewState(raw: string | null): PreviewState {
  if (raw === null) return initialPreviewState();
  try {
    const state: unknown = JSON.parse(raw);
    if (!state || typeof state !== "object") throw new Error("Invalid preview state");
    const s = state as PreviewState;
    if (
      s.version !== 1 ||
      typeof s.nickname !== "string" ||
      typeof s.intro !== "string" ||
      !Number.isFinite(s.points) ||
      s.points < 0 ||
      !Array.isArray(s.coins) ||
      !Array.isArray(s.mail) ||
      !Array.isArray(s.friends) ||
      !s.room ||
      !s.settings ||
      !s.pool ||
      !s.tickets ||
      !Array.isArray(s.rerolls) ||
      s.rerolls.length !== 3 ||
      !Array.isArray(s.scores) ||
      s.scores.length !== 4
    )
      throw new Error("Invalid preview state");
    if (
      stores.some(
        (store) =>
          !Array.isArray(s.pool[store.id]) ||
          s.pool[store.id]!.length !== 4 ||
          s.pool[store.id]!.some((n) => !Number.isFinite(n) || n < 0),
      )
    )
      throw new Error("Invalid preview state");
    const base = initialPreviewState();
    const count = (value: unknown) =>
      Number.isSafeInteger(value) && (value as number) >= 0;
    const strings = (value: unknown): value is string[] =>
      Array.isArray(value) && value.every((v) => typeof v === "string");
    const validCoin = (coin: Coin) =>
      coin &&
      typeof coin.id === "string" &&
      stores.some((store) => store.id === coin.store) &&
      typeof coin.family === "string" &&
      grades.includes(coin.grade) &&
      ["none", "pending", "minted"].includes(coin.nft);
    const room = s.room;
    if (
      !count(s.sequence) ||
      !s.coins.every(validCoin) ||
      new Set(s.coins.map((c) => c.id)).size !== s.coins.length ||
      !s.mail.every(
        (m) =>
          m &&
          ["id", "from", "title", "message"].every(
            (k) => typeof m[k as keyof Mail] === "string",
          ) &&
          count(m.reward) &&
          typeof m.read === "boolean" &&
          typeof m.claimed === "boolean",
      ) ||
      ![
        s.friends,
        s.sentTo,
        s.claimed,
        s.messages,
        s.guestbook,
        s.liked,
        s.ownedFurniture,
        room.displayed,
      ].every(strings) ||
      !s.rerolls.every(count) ||
      !stores.every(
        (store) => count(s.tickets[store.id]) && count(s.visits?.[store.id]),
      ) ||
      !s.scores.every(
        (scores) => Array.isArray(scores) && scores.every(count),
      ) ||
      !Array.isArray(s.ledger) ||
      !s.ledger.every(
        (l) => l && typeof l.label === "string" && Number.isFinite(l.amount),
      ) ||
      !["mint", "wood", "night"].includes(s.navTheme) ||
      !["filled", "line"].includes(s.iconStyle) ||
      typeof s.accent !== "string" ||
      typeof s.representative !== "string" ||
      typeof s.wallet !== "boolean" ||
      !Array.isArray(s.terms) ||
      s.terms.length !== 3 ||
      !s.terms.every((t) => typeof t === "boolean") ||
      !Object.values(s.settings).every(
        (v) =>
          typeof v === "boolean" ||
          (typeof v === "number" && Number.isFinite(v)),
      ) ||
      ![room.wall, room.floor, room.accessory].every(count) ||
      room.wall > 5 ||
      room.floor > 5 ||
      room.accessory > 3 ||
      ![room.x, room.y, room.rotation].every(Number.isFinite) ||
      typeof room.furniture !== "string" ||
      !["나만 보기", "친구", "같은 가게 이웃"].includes(room.visibility) ||
      typeof room.welcome !== "string" ||
      typeof room.guestbook !== "boolean" ||
      typeof room.alerts !== "boolean" ||
      (s.lastResult &&
        ((s.lastResult.coin && !validCoin(s.lastResult.coin)) ||
          (s.lastResult.before && !validCoin(s.lastResult.before))))
    )
      throw new Error("Invalid preview state");
    return { ...base, ...s, settings: { ...base.settings, ...s.settings } };
  } catch {
    throw new Error("저장된 테스트 기록을 읽지 못했어요. 다시 시도하거나 직접 초기화해 주세요.");
  }
}
