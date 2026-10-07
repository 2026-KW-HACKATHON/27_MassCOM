import assert from "node:assert/strict";
import { test } from "node:test";
import { leaveGuard } from "./navigation";
import { initialPreviewState } from "./model";
import { newGame } from "./game-model";

test("편집 하위 이동은 유지하고 저장하지 않은 방의 이탈만 확인한다", () => {
  const saved = initialPreviewState().room;
  const draft = { ...saved, x: 60 };
  for (const to of ["00-0", "10-0", "18-0", "03-0"] as const)
    assert.equal(leaveGuard("03-1", to, draft, saved, null), "room");
  assert.equal(leaveGuard("03-1", "03-2", draft, saved, null), null);
  assert.equal(leaveGuard("03-1", "04-0", draft, saved, null), null);
  assert.equal(leaveGuard("03-1", "00-0", saved, saved, null), null);
});

test("진행 중 탭 이탈은 확인하고 일시정지·규칙·완료 이동은 허용한다", () => {
  const room = initialPreviewState().room, game = newGame(0);
  assert.equal(leaveGuard("15-2", "00-0", room, room, game), "game");
  assert.equal(leaveGuard("17-0", "10-0", room, room, { ...game, paused: true }), "game");
  for (const to of ["17-0", "15-1", "15-2"] as const)
    assert.equal(leaveGuard("15-2", to, room, room, game), null);
  assert.equal(leaveGuard("15-2", "17-1", room, room, { ...game, done: true }), null);
  assert.equal(leaveGuard("17-0", "15-0", room, room, null), null);
});

test("카탈로그에서 같은 게임이나 다른 게임을 새로 열어도 진행 포기를 확인한다", () => {
  const room = initialPreviewState().room, game = newGame(0);
  for (const to of ["15-2", "16-0", "16-1", "16-2"] as const) {
    assert.equal(leaveGuard("15-2", to, room, room, game, true), "game");
    assert.equal(leaveGuard("15-2", to, room, room, { ...game, done: true }, true), null);
  }
});
