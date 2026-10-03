import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./collectible-share.tsx', import.meta.url), 'utf8');
const screen = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');

test('gold and prism capture one static material frame with grade and shape from the selected collectible (#349)', () => {
  assert.match(screen, /gradeId: group\.artwork\.gradeId, gradeName: group\.artwork\.gradeName, shape: group\.artwork\.shape/);
  assert.match(source, /gradeMaterialFor\(item\.gradeId, item\.gradeName\)/);
  assert.match(source, /material === 'gold' \|\| material === 'prism'/);
  assert.match(source, /variant="card" active=\{false\}/);
});
