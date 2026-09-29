import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { PublicMerchant } from '@/merchant/merchant-api';

import { SHOWCASE_ANCHORS } from './anchors';
import { DEMO_NO_DIRECTIONS, TOWN_MAP_DISCLOSURE } from './copy';
import { buildTownPins, pinLabel, type TownMapMerchant } from './town-pins';

const campaign: PublicMerchant['campaign'] = {
  id: 'current', title: '현재 캠페인', startsAt: '2026-09-01T00:00:00Z', endsAt: '2026-10-31T00:00:00Z', enrollmentStatus: 'OPEN',
  rewardGoals: [{ targetVisitCount: 1, displayName: '첫 방문' }, { targetVisitCount: 3, displayName: '세 번째 방문' }],
};
const merchant = (id: string, name: string, demo = false): TownMapMerchant => ({
  id, name, demo, roadAddress: `${name} 도로명 주소 1층`, campaign,
});
const now = '2026-09-29T00:00:00Z';

test('a pin is read as "name, stamp state": received, not yet, or not known', () => {
  assert.equal(pinLabel('가상 점포 A', 'visited'), '가상 점포 A, 도장 받음');
  assert.equal(pinLabel('가상 점포 A', 'none'), '가상 점포 A, 도장 아직 없음');
  assert.equal(pinLabel('가상 점포 A', 'unknown'), '가상 점포 A, 도장 상태 확인 안 됨');
});

test('visited shops come from the collection visits, matched by merchant id and never by name', () => {
  const shops = [merchant('one', '같은 이름'), merchant('two', '같은 이름'), merchant('three', '다른 이름')];
  const { placed } = buildTownPins(shops, { visits: [{ merchantId: 'two', campaignId: 'current', progressCounted: true }, { merchantId: 'two', campaignId: 'current', progressCounted: false }], collectibles: [] }, now);
  const byId = new Map(placed.map((pin) => [pin.merchantId, pin]));
  assert.equal(byId.get('one')?.status, 'none');
  assert.equal(byId.get('two')?.status, 'visited');
  assert.equal(byId.get('two')?.visitCount, 2);
  assert.equal(byId.get('three')?.status, 'none');
  assert.equal(byId.get('two')?.label, '같은 이름, 도장 받음');
  assert.equal(byId.get('one')?.label, '같은 이름, 도장 아직 없음');
});

test('a visit to a shop outside the public list draws no phantom pin', () => {
  const { placed, overflow } = buildTownPins([merchant('one', 'A')], { visits: [{ merchantId: 'ghost', campaignId: 'x', progressCounted: true }], collectibles: [] }, now);
  assert.deepEqual(placed.map((pin) => pin.merchantId), ['one']);
  assert.deepEqual(overflow, []);
});

test('without collection data no shop is called visited or not visited, and no goal is guessed', () => {
  const { placed } = buildTownPins([merchant('one', 'A')], undefined, now);
  assert.equal(placed[0]?.status, 'unknown');
  assert.equal(placed[0]?.label, 'A, 도장 상태 확인 안 됨');
  assert.equal(placed[0]?.statusLine, '도장 상태를 확인하지 못했어요');
  assert.equal(placed[0]?.goalLine, null);
});

test('the sheet lines tell the stamp state and the next goal', () => {
  const { placed } = buildTownPins(
    [merchant('one', 'A'), merchant('two', 'B')],
    { visits: [{ merchantId: 'one', campaignId: 'current', progressCounted: false }], collectibles: [] },
    now,
  );
  const one = placed.find((pin) => pin.merchantId === 'one')!;
  const two = placed.find((pin) => pin.merchantId === 'two')!;
  assert.equal(one.statusLine, '도장 받음 · 방문 1회');
  assert.equal(one.goalLine, '다음 목표 1회 · 첫 방문 · 1회 남음');
  assert.equal(two.statusLine, '아직 도장이 없어요');
  assert.equal(two.goalLine, '다음 목표 1회 · 첫 방문 · 1회 남음');
});

test('a counted visit reaches the goal and the sheet says the collectible is being checked, as the passport does', () => {
  const { placed } = buildTownPins(
    [merchant('one', 'A')],
    { visits: [{ merchantId: 'one', campaignId: 'current', progressCounted: true }], collectibles: [] },
    now,
  );
  assert.equal(placed[0]?.goalLine, '앱 수집품 반영 확인 중');
});

test('every placed pin has its own building and the glyph the passport stamp would show', () => {
  const shops = Array.from({ length: 5 }, (_, index) => merchant(`shop-${index}`, `가상 점포 ${String.fromCharCode(65 + index)}`));
  const { placed } = buildTownPins(shops, { visits: [], collectibles: [] }, now);
  assert.equal(placed.length, 5);
  assert.equal(new Set(placed.map((pin) => pin.slot)).size, 5);
  assert.deepEqual(placed.map((pin) => pin.glyph).sort(), ['A', 'B', 'C', 'D', 'E']);
});

test('pins keep the API list order, and the shops that do not fit are listed in that order too', () => {
  const shops = Array.from({ length: 10 }, (_, index) => merchant(`crowd-${index}`, `가게 ${index}`));
  const { placed, overflow } = buildTownPins(shops, { visits: [], collectibles: [] }, now);
  assert.equal(placed.length, 8);
  assert.equal(overflow.length, 2);
  const order = (pins: readonly { merchantId: string }[]) => pins.map((pin) => shops.findIndex((shop) => shop.id === pin.merchantId));
  assert.deepEqual(order(placed), [...order(placed)].sort((a, b) => a - b));
  assert.deepEqual(order(overflow), [...order(overflow)].sort((a, b) => a - b));
  // Overflow shops still say their stamp state, since they are listed as buttons.
  assert.ok(overflow.every((pin) => pin.slot === undefined && pin.label.endsWith('도장 아직 없음')));
});

test('the demo shops keep their fixed buildings among real ones', () => {
  const shops = [
    merchant('real-1', '진짜 가게 1'), merchant('showcase-local-merchant-c', '가상 점포 C', true),
    merchant('showcase-local-merchant', '가상 점포 A', true), merchant('showcase-local-merchant-b', '가상 점포 B', true),
  ];
  const { placed } = buildTownPins(shops, { visits: [], collectibles: [] }, now);
  for (const [id, slot] of Object.entries(SHOWCASE_ANCHORS)) assert.equal(placed.find((pin) => pin.merchantId === id)?.slot, slot, id);
});

test('an empty list builds nothing', () => {
  assert.deepEqual(buildTownPins([], { visits: [], collectibles: [] }, now), { placed: [], overflow: [] });
});

test('the copy says once that the map is a picture and why demo shops have no directions', () => {
  assert.equal(TOWN_MAP_DISCLOSURE, '그림 지도 · 실제 위치·거리와 달라요');
  assert.equal(DEMO_NO_DIRECTIONS, '가상 위치라 길찾기를 할 수 없어요');
});

test('signed out, the sheet invites a login instead of saying the check failed; a real failure keeps its own words', () => {
  const [signedOut] = buildTownPins([merchant('one', 'A')], undefined, now, { signedOut: true }).placed;
  assert.equal(signedOut?.status, 'unknown');
  assert.equal(signedOut?.statusLine, '로그인하면 도장을 볼 수 있어요');
  assert.equal(signedOut?.goalLine, null);
  const [failed] = buildTownPins([merchant('one', 'A')], undefined, now, { signedOut: false }).placed;
  assert.equal(failed?.statusLine, '도장 상태를 확인하지 못했어요');
});

test('a loaded collection wins over the signed-out flag, so the copy never contradicts the stamps', () => {
  const collection = { visits: [{ merchantId: 'one', campaignId: 'current', progressCounted: false }], collectibles: [] };
  const [pin] = buildTownPins([merchant('one', 'A')], collection, now, { signedOut: true }).placed;
  assert.equal(pin?.status, 'visited');
  assert.equal(pin?.statusLine, '도장 받음 · 방문 1회');
});

test('while the collection is still loading the sheet says so instead of reporting a failure', () => {
  const { placed } = buildTownPins([merchant('one', 'A')], undefined, now, { loading: true });
  assert.equal(placed[0]?.statusLine, '도장 상태를 불러오는 중이에요');
  const signedOut = buildTownPins([merchant('one', 'A')], undefined, now, { signedOut: true, loading: true });
  assert.equal(signedOut.placed[0]?.statusLine, '로그인하면 도장을 볼 수 있어요');
});

