import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

test('studio and portrait share the equipped clothing atlas without duplicating equipment', () => {
  const scene = read('./studio-scene.tsx');
  const portrait = read('../illustration/avatar-portrait.tsx');
  const wardrobe = read('../shop/wardrobe.tsx');
  assert.match(scene, /<AvatarPortrait avatar=\{avatar\} profile=\{experienceProfile\} clothing=\{clothing\}/);
  assert.match(scene, /<CompanionScene avatar=\{avatar\} clothing=\{clothing\}/);
  assert.match(portrait, /<AvatarClothing avatar=\{avatar\} clothing=\{clothing\}/);
  assert.match(portrait, /<AvatarEquipment avatar=\{avatar\} equipment=\{profile\} size=\{size\} frame=\{frame\} layer="front"/);
  assert.match(wardrobe, /clothing-atlas\.png/);
});

test('the equipped garment reaches game sessions and both share capture layers', () => {
  const play = read('../screens/play/index.tsx');
  const game = read('../screens/play/game-session.tsx');
  const quality = read('../screens/play/quality-session.tsx');
  const share = read('./studio-share.tsx');
  assert.match(play, /setClothing\(equippedClothingArt\(shop\.value\)\)/);
  assert.match(play, /<ActiveSession[^>]*clothing=\{clothing\}/);
  assert.match(game, /<DeliveryBoard[^>]*clothing=\{clothing\}/);
  assert.match(quality, /<Companion avatar=\{avatar\} equipment=\{equipment\} clothing=\{clothing\}/);
  assert.match(share, /<StudioScene[^>]*clothing=\{clothing\}/);
  assert.match(share, /<CompanionScene avatar=\{target\.avatar\} clothing=\{target\.clothing\}/);
});
