import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');
const card = source.slice(source.indexOf('function MerchantCard('));
test('목록 카드에는 공개 태그의 첫 항목과 집계만 표시한다', () => {
  assert.match(card, /merchant\.visitorTags\[0\] \?/);
  assert.match(card, /visitorTagLabels\[merchant\.visitorTags\[0\]\.code\]/);
  assert.match(card, /merchant\.visitorTags\[0\]\.count\}명/);
  assert.doesNotMatch(card, /suggestions|dangerouslySetInnerHTML|https?:\/\//);
});
