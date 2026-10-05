import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./studio-scene.tsx', import.meta.url)), 'utf8');

test('StudioScene renders AvatarWardrobe on top of the companion when clothing is provided', () => {
  assert.match(source, /import \{ AvatarWardrobe, type EquippedClothingArt \} from '@\/shop\/wardrobe';/);
  assert.match(source, /clothing\?: EquippedClothingArt \| null/);
  assert.match(source, /<CompanionScene avatar=\{avatar\} clothing=\{clothing\}/);
  assert.match(source, /<AvatarWardrobe clothing=\{clothing \?\? null\}/);
  assert.match(source, /\$\{clothing \? `, \$\{clothing\.name\} 착용` : ''\}/);
});
