import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./envelope-card.tsx', import.meta.url), 'utf8');

test('gold and prism reveal a grade burst and masked material without replacing merchant shine (#349)', () => {
  assert.match(source, /gradeMaterialFor\(collectible\.gradeId, collectible\.gradeName\)/);
  assert.match(source, /const precious = material === 'gold' \|\| material === 'prism'/);
  assert.match(source, /precious && animate \?/);
  assert.match(source, /<GradeMaterialLayer material=\{material\}/);
  assert.match(source, /faceUri=\{collectible\.thumbnailDataUrl\}/);
  assert.match(source, /const holo = isHolo\(collectible\)/);
  assert.match(source, /holo \? 1100 : 700/);
});

test('reduced motion settles the flip and sweep with no burst', () => {
  assert.match(source, /const animate = motionAllowed && foreground/);
  assert.match(source, /if \(!animate\) \{ flip\.set\(1\); sweep\.set\(1\); return; \}/);
  assert.match(source, /opacity: animate && precious/);
  assert.match(source, /active=\{animate && precious\}/);
  assert.match(source, /cancelAnimation\(flip\); cancelAnimation\(sweep\)/);
});
