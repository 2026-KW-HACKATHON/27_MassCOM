import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

const screen = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');

test('선택 조회는 새 수령 뒤에만 하고 빈 선택에만 안내하며 늦은 응답과 실패를 거른다', () => {
  assert.match(screen, /createVisitorFeedbackApiClient\(\{ apiUrl, credential \}\)/);
  assert.doesNotMatch(screen, /createVisitorFeedbackApiClient\(\{[^}]*onSessionInvalid/);
  assert.match(screen, /if \(redeemed && !redeemed\.replayed\)/);
  assert.match(screen, /feedbackApi\.getMine\(redeemed\.merchantId\)/);
  assert.match(screen, /current && selection\.tags\.length === 0 && selection\.suggestions\.length === 0 && selection\.note === null/);
  assert.match(screen, /return \(\) => \{ current = false; \}/);
  assert.match(screen, /feedbackOffer\?\.claim === redeemed && feedbackOffer\?\.client === feedbackApi/);
  assert.match(screen, /\.catch\(\(cause\) => \{/);
  assert.match(screen, /cause instanceof VisitorFeedbackApiError && cause\.status === 401\) \{\s*setFeedbackOpen\(false\);\s*setFeedbackOffer\(undefined\);/);
  assert.doesNotMatch(screen.slice(screen.indexOf('void feedbackApi.getMine'), screen.indexOf('}, [redeemed, feedbackApi]')), /setRedeemed\(/);
});

test('의견은 보조 링크에서 선택할 수 있고 403 뒤에는 숨기고 안내한다', () => {
  for (const text of ['이 가게 어땠나요?(선택)', '방문 인증한 가게에서만 고를 수 있어요.']) assert.ok(screen.includes(text));
  assert.match(screen, /currentFeedbackOffer \? <>/);
  assert.match(screen, /<VisitorFeedbackForm[\s\S]*?merchantId=\{redeemed\.merchantId\}/);
  assert.match(screen, /onNotEligible=\{\(\) => \{ setFeedbackOpen\(false\); setFeedbackOffer\(undefined\);/);
  assert.match(screen, /onUnauthorized=\{\(\) => \{ setFeedbackOpen\(false\); setFeedbackOffer\(undefined\); \}\}/);
  assert.match(screen, /accessibilityLabel="이 가게 어땠나요\? 선택"/);
  assert.doesNotMatch(screen, /dangerouslySetInnerHTML|https?:\/\//);
});
