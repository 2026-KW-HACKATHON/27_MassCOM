import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const app = fileURLToPath(new URL('../app/', import.meta.url));

test('four primary routes live under one tab group without duplicate root files', () => {
  for (const name of ['index', 'claim', 'collection', 'settings']) {
    assert.ok(existsSync(join(app, '(tabs)', name + '.tsx')), name);
    assert.equal(existsSync(join(app, name + '.tsx')), false, name);
  }
  assert.ok(existsSync(join(app, 'open.tsx')), 'external app link route');
  const root = readFileSync(join(app, '_layout.tsx'), 'utf8');
  assert.match(root, /name="\(tabs\)"/);
  assert.match(root, /key=\{auth\.accountId\}/);
});

test('tab labels describe the four primary user jobs', () => {
  const layoutPath = join(app, '(tabs)', '_layout.tsx');
  assert.ok(existsSync(layoutPath), 'tab layout');
  const layout = readFileSync(layoutPath, 'utf8');
  for (const title of ['탐색', '방문 인증', '도감', '내 정보']) {
    assert.ok(layout.includes(title), title);
  }
});
