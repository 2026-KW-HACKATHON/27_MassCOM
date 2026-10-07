import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');

test('room reporting and blocking have on-screen confirmation for native and web', () => {
  assert.doesNotMatch(source, /Alert\.alert/);
  assert.match(source, /이 도장을 신고할까요\?/);
  assert.match(source, /이 방을 더 이상 탐험 목록에서 보지 않을까요\?/);
  assert.match(source, /target\.roomId !== room\.roomId/);
  assert.match(source, /active\.current = false; generation\.current \+= 1; operation\.current = false; setConfirmation\(undefined\)/);
});
