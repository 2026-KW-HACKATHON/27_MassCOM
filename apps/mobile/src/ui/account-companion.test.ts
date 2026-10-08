import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const source = (name: string) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');

test('generic scenes and profile use the account-bound owned selection with penguin fallback', () => {
  const companion = source('./account-companion.tsx');
  assert.match(companion, /auth\.credential \? strip\.shop : undefined/);
  assert.match(companion, /selectedCompanion\(shop\)/);
  assert.match(companion, /if \(!avatar\) return <Mascot pose=\{pose\}/);
  assert.match(companion, /<AvatarPortrait avatar=\{avatar\}/);
  assert.match(source('./state-scene.tsx'), /<AccountCompanion pose=\{poseByKind\[kind\]\} size=\{132\} \/>/);
  assert.match(source('./profile-strip.tsx'), /selectedCompanion\(data\.shop\)/);
  assert.match(source('./profile-strip.tsx'), /\?\? mascotArt\.wave/);
  assert.match(source('../screens/friends/index.tsx'), /<AccountCompanion pose="sleep" size=\{180\} \/>/);
});
