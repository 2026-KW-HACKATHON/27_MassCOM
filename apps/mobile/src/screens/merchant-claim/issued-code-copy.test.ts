import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');

test('the issued code instructions point to the code above them', () => {
  const code = source.indexOf('<Text selectable style={styles.token}>{issued.token}</Text>');
  const help = source.indexOf('위 코드를 직접 입력합니다.');
  assert.ok(code >= 0 && help > code);
  assert.doesNotMatch(source, /아래 코드를 직접 입력합니다/);
});
