import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ANCHOR_COUNT, SHOWCASE_ANCHORS, TOWN_MAP_ANCHORS, TOWN_MAP_ART, assignAnchors, preferredAnchor } from './anchors';

const entries = (placed: Map<string, number>) => [...placed.entries()].sort(([a], [b]) => (a < b ? -1 : 1));

/** Two ids whose hashed slot is the same, found by search so the test does not pin the hash function itself. */
function collidingPair(): [string, string] {
  const bySlot = new Map<number, string>();
  for (let index = 0; index < 500; index += 1) {
    const id = `merchant-${index}`;
    const slot = preferredAnchor(id);
    const other = bySlot.get(slot);
    if (other) return [other, id];
    bySlot.set(slot, id);
  }
  throw new Error('no collision found');
}

/** Ids that all prefer different slots, so they take their hashed place without probing. */
function idsWithDistinctSlots(count: number): string[] {
  const seen = new Map<number, string>();
  for (let index = 0; seen.size < count && index < 5000; index += 1) {
    const id = `shop-${index}`;
    if (!seen.has(preferredAnchor(id))) seen.set(preferredAnchor(id), id);
  }
  return [...seen.values()];
}

test('the map has eight anchors inside the art, far enough apart that 44dp pins never overlap at 320dp', () => {
  assert.equal(ANCHOR_COUNT, 8);
  assert.equal(TOWN_MAP_ANCHORS.length, 8);
  for (const anchor of TOWN_MAP_ANCHORS) {
    assert.ok(anchor.x > 0.08 && anchor.x < 0.92, `x ${anchor.x} keeps the pin inside the art`);
    assert.ok(anchor.y > 0.04 && anchor.y < 0.96, `y ${anchor.y} keeps the pin inside the art`);
  }
  // The narrowest supported screen: a 320dp phone leaves a 280dp wide map with 20dp page insets.
  const width = 280;
  const height = width * (TOWN_MAP_ART.height / TOWN_MAP_ART.width);
  TOWN_MAP_ANCHORS.forEach((first, i) => TOWN_MAP_ANCHORS.slice(i + 1).forEach((second) => {
    const distance = Math.hypot((first.x - second.x) * width, (first.y - second.y) * height);
    assert.ok(distance >= 48, `anchors ${i} and another are ${distance.toFixed(0)}dp apart`);
  }));
});

test('the art keeps the portrait ratio the pins are laid out on', () => {
  assert.deepEqual(TOWN_MAP_ART, { width: 1024, height: 1536 });
});

test('the same shops always land on the same spots', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(entries(assignAnchors(ids).placed), entries(assignAnchors(ids).placed));
  assert.equal(preferredAnchor('same-id'), preferredAnchor('same-id'));
  for (const id of ids) assert.ok(preferredAnchor(id) >= 0 && preferredAnchor(id) < ANCHOR_COUNT);
});

test('the order the API lists shops in does not move any pin', () => {
  const ids = Array.from({ length: 12 }, (_, index) => `merchant-${index}`);
  const forward = assignAnchors(ids);
  const reversed = assignAnchors([...ids].reverse());
  const shuffled = assignAnchors([ids[5]!, ids[0]!, ids[11]!, ids[3]!, ids[8]!, ids[1]!, ids[9]!, ids[2]!, ids[10]!, ids[4]!, ids[7]!, ids[6]!]);
  for (const other of [reversed, shuffled]) {
    assert.deepEqual([...other.placed.entries()], [...forward.placed.entries()]);
    assert.deepEqual(other.overflow, forward.overflow);
  }
});

test('a shop takes its hashed spot when nothing else wants it', () => {
  const ids = idsWithDistinctSlots(5);
  const { placed, overflow } = assignAnchors(ids);
  assert.deepEqual(overflow, []);
  for (const id of ids) assert.equal(placed.get(id), preferredAnchor(id), id);
});

test('colliding shops get different spots: the next free one after the hashed spot', () => {
  const [first, second] = collidingPair();
  const { placed } = assignAnchors([second, first]);
  const [early, late] = first < second ? [first, second] : [second, first];
  // The id that sorts first is placed first and keeps the hashed spot; the other probes to the next free spot.
  assert.equal(placed.get(early), preferredAnchor(early));
  assert.equal(placed.get(late), (preferredAnchor(late) + 1) % ANCHOR_COUNT);
  assert.notEqual(placed.get(first), placed.get(second));
});

test('exactly eight shops fill all eight spots, each once', () => {
  const ids = Array.from({ length: 8 }, (_, index) => `full-${index}`);
  const { placed, overflow } = assignAnchors(ids);
  assert.equal(placed.size, 8);
  assert.deepEqual(overflow, []);
  assert.deepEqual([...placed.values()].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7]);
});

test('from the ninth shop on, shops go to the overflow list instead of stacking pins', () => {
  const ids = Array.from({ length: 11 }, (_, index) => `crowd-${index}`);
  const { placed, overflow } = assignAnchors(ids);
  assert.equal(placed.size, 8);
  assert.equal(overflow.length, 3);
  assert.deepEqual([...new Set([...placed.keys(), ...overflow])].sort(), [...ids].sort(), 'every shop is placed or listed');
  assert.deepEqual([...placed.values()].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7]);
});

test('no shops means an empty map and an empty overflow list', () => {
  const result = assignAnchors([]);
  assert.equal(result.placed.size, 0);
  assert.deepEqual(result.overflow, []);
});

test('a repeated id is one shop', () => {
  const { placed, overflow } = assignAnchors(['dup', 'dup', 'dup']);
  assert.equal(placed.size, 1);
  assert.deepEqual(overflow, []);
});

test('ids that look like object keys are ordinary ids', () => {
  const { placed } = assignAnchors(['constructor', '__proto__', 'toString']);
  assert.equal(placed.size, 3);
  assert.equal(new Set(placed.values()).size, 3);
});

test('the showcase shops A, B and C sit on fixed, well separated spots', () => {
  assert.deepEqual(Object.keys(SHOWCASE_ANCHORS), ['showcase-local-merchant', 'showcase-local-merchant-b', 'showcase-local-merchant-c']);
  const { placed } = assignAnchors(['showcase-local-merchant-c', 'showcase-local-merchant', 'showcase-local-merchant-b']);
  for (const [id, slot] of Object.entries(SHOWCASE_ANCHORS)) assert.equal(placed.get(id), slot, id);
  const points = Object.values(SHOWCASE_ANCHORS).map((slot) => TOWN_MAP_ANCHORS[slot]!);
  const ratio = TOWN_MAP_ART.height / TOWN_MAP_ART.width;
  points.forEach((first, i) => points.slice(i + 1).forEach((second) => {
    // In art widths: the three shops are at least 0.55 of the map's width apart, so the demo never bunches up.
    assert.ok(Math.hypot(first.x - second.x, (first.y - second.y) * ratio) >= 0.55);
  }));
});

test('showcase spots stay fixed among other shops, and other shops never take them', () => {
  const others = Array.from({ length: 14 }, (_, index) => `real-${index}`);
  const ids = ['showcase-local-merchant', ...others, 'showcase-local-merchant-b', 'showcase-local-merchant-c'];
  const { placed, overflow } = assignAnchors(ids);
  for (const [id, slot] of Object.entries(SHOWCASE_ANCHORS)) assert.equal(placed.get(id), slot, id);
  assert.equal(new Set(placed.values()).size, 8, 'no two shops share a spot');
  assert.equal(overflow.filter((id) => id in SHOWCASE_ANCHORS).length, 0, 'demo shops are never pushed to the overflow list');
  // Without the demo shops the same real shop can use those spots again.
  const alone = assignAnchors(others);
  assert.equal(alone.placed.size, 8);
});
