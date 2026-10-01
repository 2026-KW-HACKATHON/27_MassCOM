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

// #296 review: `focus=rewards` never worked because the reward track lives inside a Fold that starts collapsed
// and unmounts its body, so `rewardsY` never got set (and even expanded, the old code measured the Section
// inside the Fold's body, not the Fold's own position). Both the deep link and the in-app "보상" button must now
// force that fold open and scroll using the Fold's own `onLayout`.
test('a focus=rewards link forces the rewards fold open and does not require it to already be expanded', () => {
  const effect = screen.slice(screen.indexOf("if (focus !== 'rewards') return;"), screen.indexOf('[focus, headerHeight, rewardsY, router]'));
  assert.match(effect, /setRewardsFoldExpanded\(true\)/);
  // The fold must be forced open unconditionally, before any early return on `rewardsY`.
  assert.ok(
    effect.indexOf('setRewardsFoldExpanded(true)') < effect.indexOf('if (rewardsY === undefined) return'),
    'the fold is forced open even while rewardsY (its measured position) is still unknown',
  );
});

test('the in-app "보상" button (scrollToRewards) also forces the rewards fold open, not just scrolls blindly', () => {
  const fn = screen.slice(screen.indexOf('const scrollToRewards = useCallback'), screen.indexOf('}, [headerHeight, rewardsY]);'));
  assert.match(fn, /setRewardsFoldExpanded\(true\)/);
});

test('the "쿠폰·NFT 발행 현황" fold is controlled and reports its own layout, not the Section inside it', () => {
  const rewardsFold = screen.slice(screen.indexOf('title="쿠폰·NFT 발행 현황"'), screen.indexOf('<Section title="보상 상자"'));
  assert.match(rewardsFold, /expanded=\{rewardsFoldExpanded\}/);
  assert.match(rewardsFold, /onToggle=\{\(\) => setRewardsFoldExpanded/);
  assert.match(rewardsFold, /onLayout=\{setRewardsY\}/);
  // The old (broken) wiring put onLayout on the Section inside the fold's body instead of the fold itself.
  assert.doesNotMatch(screen, /<Section title="보상 상자"[^>]*onLayout=/);
});
