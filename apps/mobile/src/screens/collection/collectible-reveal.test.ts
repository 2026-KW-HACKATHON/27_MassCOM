import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Source-contract check in the same style as collectible-focus.test.ts, for what a renderer would be needed to see
// directly. The envelope sequencing itself (idle/tearing/cards/end, NEW detection, milestone, skip) is covered
// behaviorally by envelope/envelope-state.test.ts and reveal-lifecycle.test.ts; this only confirms the screen wires
// into those instead of reimplementing them.
const source = readFileSync(new URL('./collectible-reveal.tsx', import.meta.url), 'utf8');

test('skip is offered in every stage, including while loading and on failure', () => {
  assert.match(source, /<SkipButton onPress=\{onSkip\} \/>\s*\n\s*<StateScene kind=\{failure\.removed/, '실패 상태에도 건너뛰기가 있어야 한다');
  assert.match(source, /<SkipButton onPress=\{onSkip\} \/>\s*\n\s*<StateScene kind="loading"/, '로딩 상태에도 건너뛰기가 있어야 한다');
});

test('a partial load failure still shows the cards that did load; only a total failure shows the failure screen', () => {
  assert.match(source, /loaded\.length === 0 && hadError/);
});

test('the reveal screen computes NEW/milestone/series through envelope-state.ts, not an inline reimplementation', () => {
  assert.match(source, /newEntitlementIds\(/);
  assert.match(source, /milestoneForBatch\(/);
  assert.match(source, /seriesForBatch\(/);
});

test('the envelope sequence and its tear-stage lifecycle live in envelope/envelope-reveal.tsx, not here', () => {
  assert.match(source, /import \{ EnvelopeReveal, type EnvelopeCardData \} from '\.\/envelope\/envelope-reveal';/);
  assert.doesNotMatch(source, /new RevealLifecycle\(/, 'RevealLifecycle은 envelope-reveal.tsx 쪽 책임이다');
});

// Regression (#299 리뷰): the batch load effect used to list `collectibles` as a dependency. The collection polls
// every 3s and hands back a brand-new array each time even when its contents are unchanged, so that dependency
// restarted the whole Promise.allSettled load on every poll tick — a slow load (or one entitlement that never
// resolves) kept the envelope stuck on "불러오는 중" forever. The load must only restart when the batch's own id
// list changes; the latest `collectibles` is still read (through a ref) once loading finishes, for isNew.
test('the batch load effect only depends on entitlementIds/load, not on the collection snapshot', () => {
  const effectStart = source.indexOf('useEffect(() => {\n    let active = true;');
  assert.ok(effectStart > 0, '배치 로드 effect를 찾을 수 없다');
  const effectBody = source.slice(effectStart, source.indexOf('\n  }, [', effectStart) + 400);
  assert.match(effectBody, /\}, \[entitlementIds, load\]\);/, '이 effect는 entitlementIds/load에만 의존해야 한다');
  assert.doesNotMatch(effectBody, /\}, \[entitlementIds, collectibles, load\]\);/);
  assert.match(source, /const collectiblesRef = useRef\(collectibles\);/);
  assert.match(source, /newEntitlementIds\(entitlementIds, collectiblesRef\.current\)/);
});

// Regression (#299 리뷰): onOpenDetail used to always receive entitlementIds[0] — the batch's original first id, even
// when that one failed to load and never became a card. It must instead open whichever id actually got loaded.
test('onOpenDetail takes the loaded entitlementId instead of hardcoding the batch order', () => {
  assert.match(source, /onOpenDetail: \(entitlementId: string\) => void;/);
  assert.doesNotMatch(source, /entitlementIds\[0\]/, '로드에 실패할 수 있는 원래 배치의 첫 id를 그대로 열면 안 된다');
});
