import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { shopDrawHeading, shopDrawIntro } from '../../shop/shop-copy';
import { contrast } from '../../theme/contrast';
import { darkColors, lightColors } from '../../theme/palette';
import { darkWorld, lightWorld } from '../../theme/world';
import { makeShopStyles } from './styles';

// 캐릭터 꾸미기와 가게 코인 뽑기권이 다른 상품임을 한눈에 알 수 있어야 한다.
const screen = readFileSync(fileURLToPath(new URL('./index.tsx', import.meta.url)), 'utf8');

test('the draw section distinguishes character rewards from store coin tickets', () => {
  assert.equal(shopDrawHeading, '캐릭터 꾸미기 뽑기');
  assert.match(shopDrawIntro, /마일리지·의상·새 캐릭터를 차례로 받아요/);
  assert.match(shopDrawIntro, /가게 코인 뽑기권은 위에서 확인해요/);
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
