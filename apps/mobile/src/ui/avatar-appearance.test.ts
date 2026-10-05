import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const read = (name: string) => readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), 'utf8');

test('AppHeader accepts shop clothing metadata and draws it over the account avatar', () => {
  const header = read('app-header.tsx');
  assert.match(header, /avatarClothing\?: EquippedClothingArt \| null/);
  assert.match(header, /accessibilityLabel=\{avatarClothing \? `내 정보, \$\{avatarClothing\.name\} 착용` : '내 정보'\}/);
  assert.match(header, /<Image source=\{avatarArt \?\? mascotArt\['logo-badge'\]\}/);
  assert.match(header, /<AvatarWardrobe clothing=\{avatarClothing \?\? null\} size=\{28\} \/>/);
});

test('Companion accepts shop clothing metadata and draws it on the companion body', () => {
  const companion = read('companion.tsx');
  assert.match(companion, /clothing\?: EquippedClothingArt \| null/);
  assert.match(companion, /left: Math\.round\(size \* 0\.19\), top: Math\.round\(size \* 0\.43\)/);
  assert.match(companion, /<AvatarWardrobe clothing=\{clothing \?\? null\} size=\{Math\.round\(size \* 0\.56\)\} \/>/);
  assert.match(companion, /accessibilityLabel=\{clothing \? `내 동행과 인사하기, \$\{clothing\.name\} 착용` : '내 동행과 인사하기'\}/);
  assert.match(companion, /if \(!art\) return <Mascot pose=\{celebrate \? 'cheer' : 'wave'\} size=\{size\} interactive=\{interactive\} \/>/);
});
