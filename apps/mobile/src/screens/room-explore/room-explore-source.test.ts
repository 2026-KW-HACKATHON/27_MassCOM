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

test('nonfriend neighbor can add friendship without blocking room visits', () => {
  assert.match(source, /!ownRoom && !room\.friendshipId && room\.visibility === 'NEIGHBORS'/);
  assert.match(source, /client\.addFriend\(roomId\)/);
  assert.match(source, /setRoom\(\(current\) => current\?\.roomId === roomId \? \{ \.\.\.current, friendshipId: added\.friend\.friendshipId \}/);
  assert.match(source, /client\.getRoom\(roomId\)/);
  assert.match(source, /친구가 아니어도 이웃 방을 방문할 수 있어요/);
  assert.match(source, /onPress=\{visit\}/);
});

test('guestbook input is optional and existing stamp actions still govern text', () => {
  assert.match(source, /<TextInput accessibilityLabel="방명록 글, 선택 사항"/);
  assert.match(source, /Array\.from\(value\)\.slice\(0, 120\)/);
  assert.match(source, /client\.stamp\(roomId, kind, message\)/);
  assert.match(source, /stamp\.message \? <Text/);
  assert.match(source, /removeStamp\(stamp\.id\)/);
  assert.match(source, /reportStamp\(stamp\.id\)/);
});

test('the visibility confirmation checkbox exposes aria-checked on the web and toggles on Space like a press', () => {
  assert.match(source, /import \{ spaceToggles \} from '@\/ui\/space-toggles';/);
  assert.match(source, /const toggleAgreed = \(\) => setAgreed\(\(current\) => !current\);/);
  const start = source.indexOf('accessibilityRole="checkbox"');
  const row = source.slice(start, source.indexOf('</Pressable>', start));
  assert.match(row, /accessibilityState=\{\{ checked: agreed \}\} aria-checked=\{agreed\}/);
  assert.match(row, /accessibilityLabel="방 공개 범위 확인" onPress=\{toggleAgreed\}/);
  // Web-only: native keeps its own press handling.
  assert.match(row, /\{\.\.\.\(Platform\.OS === 'web' \? \{ onKeyDown: spaceToggles\(toggleAgreed\) \} : \{\}\)\}/);
});

test('the three visibility scope radios expose aria-checked on the web and pick on Space like a press', () => {
  assert.match(source, /const chooseScope = \(scope: RoomVisibility\) => \{ setScopeChoice\(scope\); setAgreed\(false\); \};/);
  const start = source.indexOf('accessibilityRole="radio"');
  const row = source.slice(start, source.indexOf('</Pressable>', start));
  assert.match(row, /accessibilityState=\{\{ checked: scopeChoice === scope \}\} aria-checked=\{scopeChoice === scope\} onPress=\{\(\) => chooseScope\(scope\)\}/);
  assert.match(row, /\{\.\.\.\(Platform\.OS === 'web' \? \{ onKeyDown: spaceToggles\(\(\) => chooseScope\(scope\)\) \} : \{\}\)\}/);
});
