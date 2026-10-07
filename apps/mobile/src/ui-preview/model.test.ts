import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { screenCatalog } from "./catalog";
import { gameStep, newGame } from "./game-model";
import {
  buyFurniture,
  canVisitNeighbor,
  claimMail,
  collectionProgress,
  drawCoin,
  finishGame,
  finishNft,
  grades,
  initialPreviewState,
  neighbors,
  ownedTickets,
  requestNft,
  rerollCoin,
  rerollUnavailable,
  restorePreviewState,
  sendFriendship,
  visitStore,
} from "./model";
const require = createRequire(import.meta.url);
const { allowUiPreview } = require("./gate.cjs") as {
  allowUiPreview: (flag: unknown, variant: unknown) => boolean;
};

test("홈 보유 뽑기권은 0장을 제외하고 모두 소진되면 빈 목록이다", () => {
  const s = initialPreviewState();
  s.tickets.cafe = 0;
  assert.deepEqual(ownedTickets(s).map((x) => x.id), ["bakery", "food"]);
  s.tickets.bakery = s.tickets.food = 0;
  assert.deepEqual(ownedTickets(s), []);
});

test("같은 가게의 다른 코인 종류와 중복 보유를 등급 완성으로 합치지 않는다", () => {
  const s = initialPreviewState();
  s.coins.push({ ...s.coins[0]!, id: "other", family: "별밤의 선물", grade: "프리즘" });
  s.coins.push({ ...s.coins[0]!, id: "duplicate" });
  assert.deepEqual(collectionProgress(s, "cafe"), { owned: 3, total: 8 });
});

test("뽑기 확인을 같은 요청으로 다시 눌러도 권·풀을 중복 소모하지 않는다", () => {
  const once = drawCoin(initialPreviewState(), "cafe", 0.1, "confirm-1");
  assert.equal(drawCoin(once, "cafe", 0.9, "confirm-1"), once);
  assert.equal(drawCoin(once, "cafe", 0.1, "confirm-2").tickets.cafe, 0);
});

test("리롤 실행과 화면의 소진·NFT·없는 대상 불가 이유가 일치한다", () => {
  const s = initialPreviewState();
  assert.equal(rerollUnavailable(s, "c2", 0), null);
  s.pool.cafe = [5, 0, 0, 0];
  assert.match(rerollUnavailable(s, "c2", 2)!, /비어/);
  assert.throws(() => rerollCoin(s, "c2", 2), /비어/);
  assert.match(rerollUnavailable(s, "missing", 0)!, /보유/);
  s.coins[1]!.nft = "pending";
  assert.match(rerollUnavailable(s, "c2", 0)!, /NFT/);
  s.rerolls[0] = 0;
  assert.match(rerollUnavailable(s, "c1", 0)!, /부족/);
});

test("preview opens only for an explicit development flag", () => {
  for (const variant of [undefined, "", "development"])
    assert.equal(allowUiPreview("1", variant), true);
  for (const variant of ["production", "showcase", "unknown"])
    assert.equal(allowUiPreview("1", variant), false);
  for (const flag of [undefined, "", "true", "0"])
    assert.equal(allowUiPreview(flag, "development"), false);
});
test("the approved catalog has 67 distinct screen destinations", () => {
  assert.equal(screenCatalog.length, 67);
  assert.equal(new Set(screenCatalog.map((s) => s.id)).size, 67);
});
test("ordinary draw spends one ticket and pool item while preserving every original coin", () => {
  const s = initialPreviewState(),
    next = drawCoin(s, "cafe", 0.9);
  assert.deepEqual(next.coins.slice(0, s.coins.length), s.coins);
  assert.equal(next.tickets.cafe, s.tickets.cafe - 1);
  assert.equal(next.pool.cafe![3], s.pool.cafe![3]! - 1);
  assert.equal(s.coins.length, 3);
  assert.equal(next.coins.length, 4);
});
test("empty ticket and depleted pool cannot partially mutate state", () => {
  const s = initialPreviewState();
  s.tickets.cafe = 0;
  assert.throws(() => drawCoin(s, "cafe"), /뽑기권/);
  s.tickets.cafe = 1;
  s.pool.cafe = [0, 0, 0, 0];
  assert.throws(() => drawCoin(s, "cafe"), /비어/);
  assert.equal(s.tickets.cafe, 1);
});
test("reroll reclaims the selected coin and clears stale display references", () => {
  const s = initialPreviewState(),
    next = rerollCoin(s, "c2", 0, 1);
  assert.equal(
    next.coins.some((c) => c.id === "c2"),
    false,
  );
  assert.equal(next.room.displayed.includes("c2"), false);
  assert.equal(next.coins.length, s.coins.length);
  assert.equal(next.rerolls[0], 2);
  assert.equal(next.lastResult?.before?.id, "c2");
  assert.equal(next.representative, next.lastResult?.coin?.id);
  assert.equal(
    s.coins.some((c) => c.id === "c2"),
    true,
  );
});
test("silver reroll excludes bronze and fails atomically when eligible pool is empty", () => {
  const s = initialPreviewState();
  const next = rerollCoin(s, "c1", 2, 0);
  assert.equal(next.lastResult?.coin?.grade, "실버");
  s.pool.cafe = [10, 0, 0, 0];
  assert.throws(() => rerollCoin(s, "c1", 2), /비어/);
  assert.equal(s.rerolls[2], 1);
  assert.equal(s.coins.length, 3);
});
test("general and bronze tickets can draw all current grades", () => {
  for (const ticket of [0, 1])
    for (let i = 0; i < 4; i++)
      assert.equal(
        rerollCoin(initialPreviewState(), "c1", ticket, (i + 0.1) / 4)
          .lastResult?.coin?.grade,
        grades[i],
      );
});
test("NFT request locks immediately and completion stays locked; unrelated coins still reroll", () => {
  const s = initialPreviewState();
  assert.throws(() => requestNft(s, "c2"), /지갑/);
  s.wallet = true;
  const pending = requestNft(s, "c2");
  assert.equal(pending.coins[1]?.nft, "pending");
  assert.throws(() => rerollCoin(pending, "c2", 0), /NFT/);
  assert.doesNotThrow(() => rerollCoin(pending, "c1", 0));
  const minted = finishNft(pending, "c2");
  assert.equal(minted.coins[1]?.nft, "minted");
  assert.throws(() => rerollCoin(minted, "c2", 0), /NFT/);
  assert.throws(() => requestNft(minted, "c2"));
});
test("furniture purchases are atomic and do not double-charge an owned item", () => {
  const s = initialPreviewState(),
    next = buyFurniture(s, "sofa");
  assert.equal(next.points, 680);
  assert.equal(next.ledger[0]?.amount, -600);
  assert.equal(next.ownedFurniture.includes("sofa"), true);
  assert.throws(() => buyFurniture(next, "sofa"), /이미/);
  const poor = { ...s, points: 20 };
  assert.throws(() => buyFurniture(poor, "sofa"), /부족/);
  assert.equal(poor.points, 20);
});
test("mail rewards are idempotent and friendship sending is per-friend", () => {
  const s = initialPreviewState(),
    claimed = claimMail(s, "gift-sora");
  assert.equal(claimed.points, 1285);
  assert.throws(() => claimMail(claimed, "gift-sora"));
  const sent = sendFriendship(s, "하루");
  assert.equal(sent.points, s.points);
  assert.throws(() => sendFriendship(sent, "하루"), /이미/);
  assert.throws(() => sendFriendship(s, "낯선이"), /친구/);
});
test("visit rewards follow the sample 1,3,5 milestone progression", () => {
  let s = initialPreviewState();
  s = visitStore(s, "cafe");
  assert.equal(s.visits.cafe, 3);
  assert.equal(s.tickets.cafe, 3);
  s = visitStore(s, "cafe");
  assert.equal(s.tickets.cafe, 3);
  s = visitStore(s, "cafe");
  assert.equal(s.tickets.cafe, 4);
});
test("random neighbor rooms require common visited store and public visibility", () => {
  const s = initialPreviewState(),
    neighbor = neighbors[0]!;
  assert.equal(canVisitNeighbor(s, neighbor), true);
  s.visits.cafe = 0;
  assert.equal(canVisitNeighbor(s, neighbor), false);
  s.friends.push(neighbor.name);
  assert.equal(canVisitNeighbor(s, neighbor), true);
  assert.equal(canVisitNeighbor(s, neighbors[4]!), false);
});
test("local game reward is granted at most once for a run; practice never adds points", () => {
  const s = initialPreviewState(),
    next = finishGame(s, 0, 900, "game-a", false);
  assert.equal(next.points, 1310);
  assert.equal(finishGame(next, 0, 900, "game-a", false), next);
  const practice = finishGame(next, 1, 600, "game-b", true);
  assert.equal(practice.points, next.points);
  assert.deepEqual(practice.scores, next.scores);
});
test("local state survives roundtrip; invalid existing storage must not become fresh data", () => {
  const s = initialPreviewState();
  s.intro = "산책 중";
  s.room.x = 72;
  s.navTheme = "wood";
  s.settings["savedStore:cafe"] = true;
  assert.deepEqual(restorePreviewState(JSON.stringify(s)), s);
  assert.deepEqual(restorePreviewState(null), initialPreviewState());
  for (const raw of ["", "broken", "null", "{}", '{"version":0}'])
    assert.throws(() => restorePreviewState(raw), /테스트 기록/);
});
test("a paused game cannot consume time or accept scoring actions", () => {
  const g = gameStep(
    newGame(0, false, () => 0.2),
    { type: "pause", value: true },
  );
  assert.equal(gameStep(g, { type: "tick" }), g);
  assert.equal(gameStep(g, { type: "place" }), g);
  assert.equal(gameStep(g, { type: "pause", value: false }).paused, false);
});
test("memory mismatches close after delay; matching all six pairs ends a game", () => {
  let g = newGame(1, false, () => 0.2);
  g.cards = [0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5];
  g = gameStep(g, { type: "flip", value: 0 });
  g = gameStep(g, { type: "flip", value: 1 });
  assert.equal(g.cooldown, 8);
  assert.equal(gameStep(g, { type: "flip", value: 2 }), g);
  for (let i = 0; i < 8; i++) g = gameStep(g, { type: "tick" });
  assert.equal(g.open.length, 0);
  for (let i = 0; i < 6; i++) {
    g = gameStep(g, { type: "flip", value: i });
    g = gameStep(g, { type: "flip", value: i + 6 });
  }
  assert.equal(g.done, true);
  assert.equal(g.score, 600);
});
test("delivery and orders compare real player inputs before scoring", () => {
  let g = newGame(2);
  g = gameStep(g, { type: "deliver", value: 1 });
  assert.equal(g.score, 80);
  assert.equal(g.target, 2);
  g = gameStep(g, { type: "deliver", value: 0 });
  assert.equal(g.misses, 1);
  let order = newGame(3);
  order = gameStep(order, { type: "ingredient", value: 0 });
  order = gameStep(order, { type: "ingredient", value: 1 });
  order = gameStep(order, { type: "submit" });
  assert.equal(order.score, 120);
  assert.deepEqual(order.order, [1, 2]);
});

test("malformed nested storage stops restoration before rendering or autosave", () => {
  for (const patch of [
    { room: {} },
    { coins: [null] },
    { mail: [null] },
    { scores: [null, [], [], []] },
    { visits: null },
    { rerolls: [-1, 1, 1] },
    { room: { ...initialPreviewState().room, displayed: null } },
  ]) {
    assert.throws(
      () => restorePreviewState(
        JSON.stringify({ ...initialPreviewState(), ...patch }),
      ),
      /테스트 기록/,
    );
  }
});
