import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const app = fileURLToPath(new URL('../app/', import.meta.url));

test('four primary routes keep the production root while the foundation preview stays separate', () => {
  for (const name of ['index', 'claim', 'collection', 'settings']) {
    assert.ok(existsSync(join(app, '(tabs)', name + '.tsx')), name);
    assert.equal(existsSync(join(app, name + '.tsx')), false, name);
  }
  assert.ok(existsSync(join(app, 'foundation-preview.tsx')), 'isolated UI preview route');
  assert.equal(existsSync(join(app, '(tabs)', 'explore.tsx')), false, 'no duplicate explore route');
  assert.ok(existsSync(join(app, 'open.tsx')), 'external app link route');
  const root = readFileSync(join(app, '_layout.tsx'), 'utf8');
  assert.match(root, /name="\(tabs\)"/);
  assert.match(root, /key=\{auth\.accountId\}/);
  assert.match(root, /<AuthenticatedRoot\s*\/>/);
});

test('tab labels describe the four primary user jobs', () => {
  const layoutPath = join(app, '(tabs)', '_layout.tsx');
  assert.ok(existsSync(layoutPath), 'tab layout');
  const layout = readFileSync(layoutPath, 'utf8');
  for (const title of ['탐색', '방문 인증', '도감', '내 정보']) {
    assert.ok(layout.includes(title), title);
  }
});

test('the UI preview entry is development-only and cannot replace account tools', () => {
  const settings = readFileSync(fileURLToPath(new URL('../screens/account-settings/index.tsx', import.meta.url)), 'utf8');
  const preview = readFileSync(join(app, 'foundation-preview.tsx'), 'utf8');
  assert.match(settings, /__DEV__\s*\?\s*\(/);
  assert.match(settings, /href="\/foundation-preview"/);
  assert.match(preview, /if \(!__DEV__\) return <Redirect href="\/" \/>/);
  assert.match(settings, /계정 삭제 안내/);
});
