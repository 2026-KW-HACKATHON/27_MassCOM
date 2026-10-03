import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { shopDrawHeading, shopDrawIntro } from '../../shop/shop-copy';
import { contrast } from '../../theme/contrast';
import { darkColors, lightColors } from '../../theme/palette';
import { darkWorld, lightWorld } from '../../theme/world';
import { makeShopStyles } from './styles';

// #332 발견성: 상점을 연 사람이 "마일리지로 캐릭터를 뽑는 곳"임을 한눈에 알 수 있어야 한다. RN 렌더러가 없어 소스 본문으로 확인한다.
const screen = readFileSync(fileURLToPath(new URL('./index.tsx', import.meta.url)), 'utf8');

test('the draw section is headed "마일리지로 캐릭터 뽑기" with a one-line intro', () => {
  assert.equal(shopDrawHeading, '마일리지로 캐릭터 뽑기');
  assert.match(shopDrawIntro, /등급을 고르고 뽑기를 누르면 아직 없는 가게 친구를 한 명 받아요/);
});

test('the screen shows that heading and intro above the grade cards, once', () => {
  assert.match(screen, /import \{ shopDrawHeading, shopDrawIntro \} from '@\/shop\/shop-copy';/);
  const section = screen.slice(screen.indexOf('{shopDrawHeading}') - 120, screen.indexOf('{snapshot.grades.map'));
  assert.match(section, /<Text accessibilityRole="header" style=\{styles\.sectionTitle\}>\{shopDrawHeading\}<\/Text>/);
  assert.match(section, /<Text style=\{styles\.sectionNote\}>\{shopDrawIntro\}<\/Text>/);
  assert.equal((screen.match(/\{shopDrawHeading\}/g) ?? []).length, 1);
});

test('the intro line is readable on the sky behind the section in light and dark', () => {
  for (const [palette, world] of [[lightColors, lightWorld], [darkColors, darkWorld]] as const) {
    const note = makeShopStyles(palette, world).sectionNote.color as string;
    for (const sky of [world.page, ...world.sky]) assert.ok(contrast(note, sky) >= 4.5, `${note} on ${sky}`);
  }
});
