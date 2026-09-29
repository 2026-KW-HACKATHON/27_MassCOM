import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../../assets/images/mascot/v2/', import.meta.url));
const poses = ['wave', 'explore-map', 'stamp', 'gift', 'sleep', 'puzzled', 'friends', 'search', 'cheer', 'logo-badge'];

test('every mascot pose ships as a small transparent PNG and is listed in the art module', () => {
  const source = readFileSync(fileURLToPath(new URL('./mascot-art.ts', import.meta.url)), 'utf8');
  let total = 0;
  for (const pose of poses) {
    const bytes = statSync(dir + pose + '.png').size;
    total += bytes;
    assert.ok(bytes <= 250 * 1024, `${pose} is ${bytes} bytes`);
    assert.ok(source.includes(`'${pose}': require('../../assets/images/mascot/v2/${pose}.png')`), pose);
  }
  for (const background of ['sky-town-header', 'town-map']) total += statSync(dir + background + '.png').size;
  assert.ok(total <= 2.5 * 1024 * 1024, `art total ${total} bytes`);
});

test('mascot art sources are recorded', () => {
  const sources = readFileSync(dir + 'SOURCES.md', 'utf8');
  for (const pose of poses) assert.ok(sources.includes(pose), pose);
});

test('the art provenance comments say the same thing as SOURCES.md: drawn by Codex with built-in image generation', () => {
  const sources = readFileSync(dir + 'SOURCES.md', 'utf8');
  assert.match(sources, /built-in `image_gen`/);
  const art = readFileSync(fileURLToPath(new URL('./mascot-art.ts', import.meta.url)), 'utf8');
  const script = readFileSync(fileURLToPath(new URL('../../scripts/optimize-mascot-art.py', import.meta.url)), 'utf8');
  for (const source of [art, script]) assert.match(source, /Codex\(내장 이미지 생성\)으로 그/);
});
