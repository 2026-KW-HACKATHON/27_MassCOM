import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('잠긴 꾸미기도 먼저 입혀 보고 소유한 것만 확인 뒤 장착한다', () => {
  const wardrobe = read('../../experience/experience-wardrobe.tsx');
  const select = wardrobe.slice(wardrobe.indexOf('const select ='), wardrobe.indexOf('const clear ='));
  assert.match(wardrobe, /preview\?\.profile === snapshot\.profile && preview\.avatar === avatar/);
  assert.match(select, /onPreview\?\.\(profile\)/);
  assert.doesNotMatch(select, /onEquip/);
  assert.match(wardrobe, /previewItem\.id && item\.equippable/);
  assert.match(wardrobe, /previewBadge\.id && item\.owned/);
  assert.match(wardrobe, /\{canEquip \? <Pressable/);
  assert.match(wardrobe, /<CosmeticArt id=\{item\.id\}/);
  assert.match(wardrobe, /<BadgeArt id=\{badge\.id\}/);
});

test('팩 결과의 실제 보너스는 미리보기와 별도 저장 행동을 제공한다', () => {
  const machine = read('./gacha-machine.tsx');
  const shop = read('./index.tsx');
  assert.match(machine, /<PackArt grade=\{selected\.grade\}/);
  assert.match(machine, /<CosmeticArt id=\{result\.bonus\.id\}/);
  assert.match(machine, /<AvatarPortrait avatar=\{result\.item\.id\} profile=\{bonusProfile\}/);
  assert.match(machine, /<AvatarPortrait avatar=\{snapshot\.avatar\} profile=\{bonusProfile\}/);
  assert.match(machine, /result\.bonus\?\.slot === 'decor'[\s\S]*?<ThemeOutfitPreview avatar=\{snapshot\.avatar\} profile=\{bonusProfile\}/);
  assert.match(machine, /onPress=\{onEquipBonus\}/);
  assert.match(shop, /experience\.save\(\{ cosmetics: \{ \[reveal\.bonus\.slot\]: reveal\.bonus\.id \} \}\)/);
});

test('홈 머리글의 반복 동행 대신 대표 전시 하나에 코인과 실제 배지를 모은다', () => {
  const header = read('../merchant-list/index.tsx');
  const home = read('../../experience/home-collection-display.tsx');
  assert.doesNotMatch(header, /<CompanionScene/);
  assert.equal((home.match(/<CompanionScene/g) ?? []).length, 1);
  assert.match(home, /<BadgeArt id=\{badge\.id\}/);
  assert.match(home, /<StudioCoin item=\{coin\}/);
  assert.match(home, /world\.card/);
});
