import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const read = (name: string) => readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), 'utf8');

test('AppHeader passes shop clothing metadata to the profile strip avatar', () => {
  const header = read('app-header.tsx');
  assert.match(header, /avatarClothing\?: EquippedClothingArt \| null/);
  assert.match(header, /<ProfileStrip avatarArt=\{avatarArt\} avatarClothing=\{avatarClothing\} avatarContent=\{avatarContent\} mileageBalance=\{mileageBalance\} \/>/);
  const strip = read('profile-strip.tsx');
  assert.match(strip, /<AvatarWardrobe clothing=\{clothing\} size=\{28\} \/>/);
  assert.match(strip, /<Link href="\/profile" asChild><Pressable accessibilityRole="button" accessibilityLabel="내 프로필과 한 줄 소개 편집"/);
});

test('Companion accepts shop clothing metadata and draws it on the companion body', () => {
  const companion = read('companion.tsx');
  assert.match(companion, /clothing\?: EquippedClothingArt \| null/);
  assert.match(companion, /left: Math\.round\(size \* 0\.19\), top: Math\.round\(size \* 0\.43\)/);
  assert.match(companion, /<AvatarWardrobe clothing=\{clothing \?\? null\} size=\{Math\.round\(size \* 0\.56\)\} \/>/);
  assert.match(companion, /accessibilityLabel=\{clothing \? `내 동행과 인사하기, \$\{clothing\.name\} 착용` : '내 동행과 인사하기'\}/);
  assert.match(companion, /if \(!art\) return <Mascot pose=\{celebrate \? 'cheer' : 'wave'\} size=\{size\} interactive=\{interactive\} \/>/);
});
