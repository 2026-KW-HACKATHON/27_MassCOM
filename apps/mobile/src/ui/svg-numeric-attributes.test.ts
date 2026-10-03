import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const sourceRoot = fileURLToPath(new URL('../', import.meta.url));

function tsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx') ? [path] : [];
  });
}

test('JSX 숫자 속성에 Android SVG가 거부하는 점 시작 문자열이 없다', () => {
  const violations: string[] = [];
  for (const file of tsxFiles(sourceRoot)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\b[\w:-]+\s*=\s*(["'])-?\.[0-9]/g)) {
      const line = source.slice(0, match.index).split('\n').length;
      violations.push(`${relative(sourceRoot, file)}:${line}: ${match[0]}`);
    }
  }
  assert.deepEqual(violations, []);
});
