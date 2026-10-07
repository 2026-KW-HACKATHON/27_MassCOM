import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const screen = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');
const stack = readFileSync(new URL('../../app/play.tsx', import.meta.url), 'utf8');

test('tab root keeps the account header inside scroll content and clears its floating bar', () => {
  assert.match(screen, /tabRoot \? <AppHeader title="놀이" subtitle="네 가지 놀이를 골라요" avatarClothing=\{clothing\} compact \/>/);
  assert.match(screen, /<SkyScrollView ref=\{scrollRef\} header=\{header\}/);
  assert.match(screen, /paddingBottom: tabRoot \? clearance : 44 \+ insets\.bottom/);
  assert.match(screen, /onGamePlayingChanged\?\.\(gamePlaying\)/);
  assert.match(screen, /if \(gamePlaying\) onGamePlayingChanged\?\.\(false\)/);
});

test('the old /play route keeps its stack header by using the default screen mode', () => {
  assert.match(screen, /tabRoot = false/);
  assert.match(screen, /: <BackHeader title="놀이 마당" \/>/);
  assert.match(stack, /return <PlayScreen key=\{auth\.accountId\}/);
  assert.doesNotMatch(stack, /tabRoot/);
});

test('web game exit uses a working confirmation before clearing an active run', () => {
  assert.match(screen, /<ConfirmDialog visible=\{exitPrompt && !!run\}/);
  assert.match(screen, /onConfirm=\{\(\) => \{ setExitPrompt\(false\); exitToHub\(\); \}\}/);
  assert.doesNotMatch(screen, /window\.confirm|Alert\.alert/);
  assert.match(screen, /title="놀이를 나갈까요\?"/);
});
