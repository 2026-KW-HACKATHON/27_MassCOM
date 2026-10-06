import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const list = readFileSync(new URL('../real-map/index.tsx', import.meta.url), 'utf8');
const detail = readFileSync(new URL('../merchant-detail/index.tsx', import.meta.url), 'utf8');
test('discovery does not invent visitor tags absent from the v1 summary, while detail keeps private feedback', () => {
  assert.doesNotMatch(list, /visitorTags|dangerouslySetInnerHTML/);
  assert.match(detail, /<MyVisitorFeedback/);
  assert.match(detail, /client\.getMine\(merchantId\)/);
});
