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

// Issue #314: a render error elsewhere (e.g. #301 review's NftStatusRow), or even an OS config change (font
// scale, light/dark), can make expo-router tear down and remount the Root Layout while this tab's own effect
// cleanup is mid-flight. A `navigationRef.isReady()` pre-check does NOT catch this: that ref is only the one
// captured at this component's last render, and by the time an unmount cleanup runs, the global router may have
// already swapped to a fresh, not-yet-ready one — the stale ref still (wrongly) reports itself ready. Confirmed
// live on-device: the guard let `router.setParams` through anyway, which still threw "Attempted to navigate
// before mounting the Root Layout component" and left a white screen. Every call must instead go through the
// shared helper, which catches exactly that documented expo-router failure.
test('every router.setParams call in the collection screen goes through clearCollectionFocusParams (#314)', () => {
  assert.match(screen, /function clearCollectionFocusParams\(router: ReturnType<typeof useRouter>, params:/);
  const tryBlock = screen.slice(screen.indexOf('function clearCollectionFocusParams'), screen.indexOf('export function CollectionScreen'));
  assert.match(tryBlock, /try \{\s*router\.setParams\(params\);/);
  assert.match(tryBlock, /caught\.message\.includes\('mounting the Root Layout'\)/);
  // No call site is allowed to call router.setParams directly, bypassing the guard.
  assert.doesNotMatch(screen.slice(screen.indexOf('export function CollectionScreen')), /router\.setParams\(/);
  const calls = [...screen.matchAll(/clearCollectionFocusParams\(router, /g)];
  assert.ok(calls.length >= 3, 'expected the focus-cleanup, collectible-link and rewards-scroll call sites');
});

// Issue #314 (same QA pass): the loading/error scene's mascot + title + a wrapped error body + retry button could
// end up just tall enough that the retry button sat behind the floating tab bar on first paint, with nothing on
// screen hinting it was reachable by scrolling. The scene only grows into that (taller) error state after first
// mounting the short "loading" one, so a one-time `contentOffset` cannot reach it; it must re-scroll whenever the
// content's measured size changes.
test('the loading/error scene re-scrolls to the end whenever its measured content size changes (#314)', () => {
  const sky = screen.slice(screen.indexOf('const sky = (body: ReactNode) =>'), screen.indexOf('if (loading && !collection)'));
  assert.match(sky, /ref=\{skyScrollView\}/);
  assert.match(sky, /onContentSizeChange=\{\(_, height\) => \{/);
  assert.match(sky, /requestAnimationFrame\(\(\) => skyScrollView\.current\?\.scrollTo\(\{ y: height, animated: false \}\)\);/);
});
