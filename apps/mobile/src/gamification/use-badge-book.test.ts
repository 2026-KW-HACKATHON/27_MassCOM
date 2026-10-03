import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./use-badge-book.ts', import.meta.url), 'utf8');

test('계정·API 변경은 이전 배지 책을 지우고 늦은 응답을 무효화한다', () => {
  const change = source.slice(source.indexOf('if (api !== lastApi)'), source.indexOf('useEffect(() =>', source.indexOf('if (api !== lastApi)')));
  assert.match(source, /return \(\) => \{\s*generation\.current \+= 1/);
  assert.match(change, /setBook\(undefined\)/);
  assert.match(change, /setStatus\('loading'\)/);
  assert.doesNotMatch(change, /if \(!api\)/);
});
