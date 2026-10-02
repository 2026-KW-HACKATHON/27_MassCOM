import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import type { CollectionSnapshot } from '../../commerce/commerce-api';
import { collectibleFocusAction, parseEntitlementIds, resolveCollectibleLink } from './collectible-focus';

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
  // #314: this used to call router.setParams directly; it now goes through clearCollectionFocusParams, which
  // catches expo-router's own "Root Layout not mounted" race instead of letting it crash to a white screen
  // (see index.test.ts for the dedicated regression test on that guard).
  assert.match(source, /setTabFocused\(false\);[\s\S]*clearCollectionFocusParams\(router, \{ focus: undefined, entitlement: undefined \}\);/);
});

test('opening the detail from the acquisition reveal plays the once-on-acquisition motions first', () => {
  const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');
  assert.match(source, /client: api, intro: true \}\);/);
  assert.match(source, /intro=\{collectibleDetail\.intro === true\}/);
});

// #299 리뷰: entitlement 쿼리 파라미터는 보통 콤마로 묶인 문자열 하나지만, 같은 키가 반복되면(`?entitlement=a&entitlement=b`)
// 라우터가 배열로 돌려준다. 이전에는 index.tsx가 그 값에 바로 .split(',')을 호출해 배열이 오면 TypeError가 났다.
test('parseEntitlementIds normalizes a single string, an array, empty input, and blank entries', () => {
  assert.deepEqual(parseEntitlementIds('a,b'), ['a', 'b']);
  assert.deepEqual(parseEntitlementIds(['a', 'b']), ['a', 'b']);
  assert.deepEqual(parseEntitlementIds(['a,b', 'c']), ['a', 'b', 'c']);
  assert.deepEqual(parseEntitlementIds(undefined), []);
  assert.deepEqual(parseEntitlementIds(''), []);
  assert.deepEqual(parseEntitlementIds(',,'), []);
  assert.deepEqual(parseEntitlementIds(['', 'a', '']), ['a']);
});

test('parseEntitlementIds dedupes while keeping first-occurrence order, from either shape', () => {
  assert.deepEqual(parseEntitlementIds('a,a,b'), ['a', 'b']);
  assert.deepEqual(parseEntitlementIds(['a', 'a', 'b']), ['a', 'b']);
  assert.deepEqual(parseEntitlementIds(['b,a', 'a,c']), ['b', 'a', 'c']);
});

test('the collection screen parses the entitlement param through parseEntitlementIds, not an inline .split', () => {
  const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');
  assert.match(source, /parseEntitlementIds\(entitlement\)/);
  assert.doesNotMatch(source, /entitlement\.split\(/, 'entitlement은 배열일 수도 있어 바로 .split을 호출하면 안 된다');
});
