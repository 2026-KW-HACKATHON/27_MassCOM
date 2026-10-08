import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { shopDrawHeading, shopDrawIntro } from '../../shop/shop-copy';
import { contrast } from '../../theme/contrast';
import { darkColors, lightColors } from '../../theme/palette';
import { darkWorld, lightWorld } from '../../theme/world';
import { makeShopStyles } from './styles';

// 등급 통합 뽑기와 기간이 있는 가게 행사권은 다른 상품임을 한눈에 알 수 있어야 한다.
const screen = readFileSync(fileURLToPath(new URL('./index.tsx', import.meta.url)), 'utf8');

test('the draw section describes the current reward categories and rarity', () => {
  assert.equal(shopDrawHeading, '등급별 전체 랜덤 뽑기');
  assert.match(shopDrawIntro, /마일리지, 꾸미기, 리롤권 중 하나/);
  assert.match(shopDrawIntro, /브론즈에는 가구도 있어요/);
  assert.match(shopDrawIntro, /높은 등급과 리롤권은 드물고/);
  assert.match(shopDrawIntro, /중복도 나올 수 있어요/);
  assert.match(screen, /가게 행사 뽑기권/);
});

test('the screen shows that heading and intro above the grade cards, once', () => {
  assert.match(screen, /import \{ shopDrawHeading, shopDrawIntro \} from '@\/shop\/shop-copy';/);
  const section = screen.slice(screen.indexOf('{shopDrawHeading}') - 120, screen.indexOf('{drawShop ? drawShop.pools.map'));
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
