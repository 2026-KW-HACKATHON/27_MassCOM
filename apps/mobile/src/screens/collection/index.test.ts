import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const screen = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');

const collectionCalls = [...screen.matchAll(/api\.getCollection\(\)/g)];

test('every collection request takes a generation before it is sent (#265)', () => {
  assert.ok(collectionCalls.length >= 6);
  for (const call of collectionCalls) {
    const before = screen.slice(Math.max(0, call.index! - 260), call.index!);
    assert.match(before, /const generation = startRequest\(\);/, screen.slice(call.index! - 80, call.index! + 40));
  }
  // One generation per request: the number of startRequest() calls equals the number of requests.
  assert.equal(screen.match(/\bstartRequest\(\)/g)?.length, collectionCalls.length);
  assert.match(screen, /const startRequest = useCallback\(\(\) => \+\+requestGeneration\.current, \[\]\);/);
});

test('every collection result is applied through applySnapshot with its own generation', () => {
  assert.equal(screen.match(/\bapplySnapshot\(/g)?.length, collectionCalls.length);
  assert.equal(screen.match(/\bapplySnapshot\((?:[^()]|\([^()]*\))*, generation\)/g)?.length, collectionCalls.length);
  // The only place a success event is built is applySnapshot itself; failures carry their generation too.
  assert.equal(screen.match(/type: 'success'/g)?.length, 1);
  assert.match(screen, /const applySnapshot = useCallback\([\s\S]*?nextPollingState\(current, \{ type: 'success', snapshot, generation \}\)/);
  assert.match(screen, /nextPollingState\(current, \{ type: 'failure', generation \}\)/);
  assert.doesNotMatch(screen, /setPolling\(initialPollingState\(/);
});

test('issuing a mint clears the finalized notice before the request, not only after its follow-up fetch', () => {
  const submitMint = screen.slice(screen.indexOf('async function submitMint'), screen.indexOf('const openReward'));
  assert.match(submitMint, /setPolling\(\(current\) => current \? clearFinalizedNotice\(current\) : current\);/);
  assert.ok(
    submitMint.indexOf('clearFinalizedNotice(current)') < submitMint.indexOf('api.requestMint('),
    'the notice is cleared before the mint request is issued',
  );
});
