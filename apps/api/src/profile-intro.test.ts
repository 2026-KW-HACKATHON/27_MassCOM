import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseProfileIntro } from './friends-rules.js';

test('profile intro accepts an empty reset and counts Unicode characters without truncating', () => {
  assert.equal(parseProfileIntro('  작은 카페를 좋아해요  '), '작은 카페를 좋아해요');
  assert.equal(parseProfileIntro(''), '');
  assert.equal(parseProfileIntro('냥'.repeat(30)), '냥'.repeat(30));
  assert.equal(parseProfileIntro('🌿'.repeat(30)), '🌿'.repeat(30));
  for (const invalid of ['냥'.repeat(31), 'a\nb', 'a\u0000b', '\ud800', 'a\u202eb', 12, null]) {
    assert.equal(parseProfileIntro(invalid), null);
  }
});
