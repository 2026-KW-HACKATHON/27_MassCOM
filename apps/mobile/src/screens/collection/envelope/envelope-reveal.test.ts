import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Source-contract check, same style as collectible-focus.test.ts: the tear transition's background/reduce-motion/
// dispose handling is covered behaviorally by reveal-lifecycle.test.ts against the real class; this only confirms
// the envelope actually drives it instead of a second, inline timer implementation.
const source = readFileSync(new URL('./envelope-reveal.tsx', import.meta.url), 'utf8');

test('the tear transition is driven by RevealLifecycle, not an inline reimplementation', () => {
  assert.match(source, /new RevealLifecycle\(/);
  assert.match(source, /lifecycle\?\.setForeground\(/);
  assert.match(source, /lifecycle\?\.setMotionAllowed\(/);
  assert.match(source, /lifecycle\?\.dispose\(\)/);
});

// Regression this guards: constructing RevealLifecycle at mount (like the single-collectible reveal does) would set
// its `stage` to 'opening' immediately, so backgrounding the idle, untapped envelope would auto-complete a tear
// nobody asked for. The instance must only exist once the person actually taps.
test('the lifecycle is created on tap, not at mount', () => {
  const body = source.slice(source.indexOf('export function EnvelopeReveal'));
  const openIndex = body.indexOf('function openEnvelope');
  assert.ok(openIndex > 0, 'openEnvelope를 찾을 수 없다');
  assert.match(body.slice(0, openIndex), /const \[lifecycle, setLifecycle\] = useState<RevealLifecycle>\(\);/);
  assert.match(body.slice(openIndex), /new RevealLifecycle\(/);
});

test('skip is always available, independent of the current stage', () => {
  assert.match(source, /<SkipButton onPress=\{onSkip\} \/>/);
});

test('only a card that reached the visible stage is acknowledged as presented', () => {
  assert.match(source, /if \(foreground && uiStage === 'open' && current\) onCardShown\(current\.entitlementId\);/);
  assert.match(source, /\[foreground, uiStage, current, onCardShown\]/);
  assert.doesNotMatch(source.slice(source.indexOf('function openEnvelope'), source.indexOf('function goTo')), /onCardShown/);
  assert.doesNotMatch(source, /<SkipButton onPress=\{\(\) => onCardShown/);
});

// Regression (#299 리뷰): Pressable wires its own gesture responder internally, so panHandlers spread directly onto
// a Pressable are silently ignored and swipe-down-to-tear never fires. The pan handlers must sit on a plain View
// wrapping the Pressable so the View can claim the responder on a vertical drag while the Pressable still gets taps.
test('the idle envelope attaches panResponder to a wrapping View, not to the Pressable itself', () => {
  const idleStart = source.indexOf("uiStage !== 'open' ?");
  const idleBlock = source.slice(idleStart, source.indexOf('idleHint', idleStart));
  assert.match(idleBlock, /<View \{\.\.\.panResponder\.panHandlers\}>\s*<Pressable/, '팬 핸들러는 Pressable을 감싸는 View에 있어야 한다');
  const pressableBlock = idleBlock.slice(idleBlock.indexOf('<Pressable'), idleBlock.indexOf('</Pressable>'));
  assert.doesNotMatch(pressableBlock, /panResponder\.panHandlers/, 'Pressable 자신에 panHandlers를 바로 펼치면 무시된다');
  assert.match(pressableBlock, /onPress=\{openEnvelope\}/, '탭으로 여는 동작은 그대로 Pressable이 맡아야 한다');
});

// Regression (#299 리뷰): onOpenDetail used to be forwarded as-is (always opening the batch's original first id).
// It must instead be called with the first card that actually loaded (cards[0]), which is what EndCard's "자세히
// 보기" should open.
test('the end card opens the first actually-loaded card, not a forwarded no-arg callback', () => {
  assert.match(source, /onOpenDetail=\{\(\) => onOpenDetail\(cards\[0\]!\.entitlementId\)\}/);
});
