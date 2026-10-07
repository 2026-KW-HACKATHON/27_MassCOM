import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('./compose.tsx', import.meta.url), 'utf8');

test('message retry retains request ID until draft changes or send succeeds', () => {
  assert.match(source, /const messageRequestId = useRef<string \| undefined>/);
  assert.match(source, /requestId: messageRequestId\.current \?\?= createSocialRequestId\('message'\)/);
  assert.match(source, /onChangeText=\{value => \{ if \(value !== body\) \{ setBody\(value\); messageRequestId\.current = undefined; \} \}\}/);
  assert.match(source, /messageRequestId\.current = undefined; \}, \[friendshipId, apiUrl, credential\]/);
  assert.match(source, /await api\.sendMessage\([\s\S]*?messageRequestId\.current = undefined;/);
});

test('meal invitation retry retains request ID until draft changes or send succeeds', () => {
  assert.match(source, /const mealRequestId = useRef<string \| undefined>/);
  assert.match(source, /requestId: mealRequestId\.current \?\?= createSocialRequestId\('meal-invite'\)/);
  assert.match(source, /await api\.createMealInvitation\([\s\S]*?mealRequestId\.current = undefined;/);
  for (const setter of ['setDate', 'setTime', 'setStartTime', 'setEndTime', 'setKind']) {
    assert.match(source, new RegExp(`${setter}\\([^)]*\\); mealRequestId\\.current = undefined`));
  }
  for (const value of ['date', 'time', 'startTime', 'endTime']) assert.match(source, new RegExp(`if \\(value !== ${value}\\)`));
  assert.match(source, /if \(kind !== 'CONFIRMED'\) \{ setKind\('CONFIRMED'\); mealRequestId\.current = undefined; \}/);
  assert.match(source, /if \(kind !== 'RANGE'\) \{ setKind\('RANGE'\); mealRequestId\.current = undefined; \}/);
  assert.match(source, /mealRequestId\.current = undefined; \}, \[friendshipId, apiUrl, credential, merchantId\]/);
});
