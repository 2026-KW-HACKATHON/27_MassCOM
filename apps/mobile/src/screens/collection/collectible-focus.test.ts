import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import type { CollectionSnapshot } from '../../commerce/commerce-api';
import { collectibleFocusAction, resolveCollectibleLink } from './collectible-focus';

const item = (entitlementId: string, artwork?: unknown) => ({ entitlementId, ...(artwork ? { artwork } : {}) }) as CollectionSnapshot['collectibles'][number];
const art = { publicationId: 'p', projectId: 'q', gradeId: 'bronze', gradeName: '브론즈', name: '가게 우표', shape: 'stamp', theme: { name: '기본' }, thumbnailDataUrl: 'data:image/png;base64,AAAA' };

test('스냅샷에 있는 보상은 외형이 있으면 열고 없으면 안내한다', () => {
  assert.equal(collectibleFocusAction({ collectibles: [item('a', art)] }, 'a', false), 'open');
  assert.equal(collectibleFocusAction({ collectibles: [item('a')] }, 'a', false), 'message');
});

test('스냅샷이 방금 받은 보상보다 오래됐으면 한 번만 다시 읽고, 그래도 없으면 안내한다', () => {
  const stale = { collectibles: [item('older', art)] };
  assert.equal(collectibleFocusAction(stale, 'fresh', false), 'fetch');
  assert.equal(collectibleFocusAction(stale, 'fresh', true), 'message');
  assert.equal(collectibleFocusAction({ collectibles: [item('older', art), item('fresh', art)] }, 'fresh', true), 'open');
  assert.equal(collectibleFocusAction(stale, undefined, false), 'fetch');
});

test('resolveCollectibleLink opens with artwork, messages without it, while the generation is still current', () => {
  const currentGeneration = () => 1;
  assert.deepEqual(
    resolveCollectibleLink({ collectibles: [item('a', art)] }, 'a', 1, currentGeneration),
    { action: 'open', entitlementId: 'a', merchantName: undefined },
  );
  assert.deepEqual(resolveCollectibleLink({ collectibles: [item('a')] }, 'a', 1, currentGeneration), { action: 'message' });
  assert.deepEqual(resolveCollectibleLink({ collectibles: [] }, 'missing', 1, currentGeneration), { action: 'message' });
});

// Regression: a re-read that resolves after the person left the tab (or a newer link superseded it) used to still
// open the reveal / show the message, because nothing checked whether the attempt was still the current one.
test('resolveCollectibleLink ignores a resolution once the generation has moved on (left the tab, or a newer link started)', () => {
  let generation = 1;
  const currentGeneration = () => generation;
  const startedAt = generation; // captured when the attempt began, same as index.tsx does before its fetch/timer

  // Still current: resolves normally.
  assert.deepEqual(resolveCollectibleLink({ collectibles: [item('a', art)] }, 'a', startedAt, currentGeneration), {
    action: 'open', entitlementId: 'a', merchantName: undefined,
  });

  // Blurring the tab (or starting a newer link) bumps the generation before this attempt's late resolution arrives.
  generation += 1;
  assert.deepEqual(resolveCollectibleLink({ collectibles: [item('a', art)] }, 'a', startedAt, currentGeneration), { action: 'stale' });
  // A fresh attempt started after the bump is still honoured normally.
  assert.deepEqual(resolveCollectibleLink({ collectibles: [item('a', art)] }, 'a', generation, currentGeneration), {
    action: 'open', entitlementId: 'a', merchantName: undefined,
  });
});

test('the collection screen only opens the reveal through resolveCollectibleLink, never inline', () => {
  const screen = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');
  assert.match(screen, /resolveCollectibleLink\(/, 'index.tsx는 인라인 판단 대신 resolveCollectibleLink를 써야 한다');
});

test('the collection screen processes an acquisition link only while the tab is focused and drops it on blur', () => {
  const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');
  assert.match(source, /if \(!tabFocused\) return;/);
  assert.match(source, /setTabFocused\(false\);[\s\S]*router\.setParams\(\{ focus: undefined, entitlement: undefined \}\);/);
});
