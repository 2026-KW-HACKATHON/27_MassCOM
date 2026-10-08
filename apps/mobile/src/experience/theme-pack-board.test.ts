import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('./theme-pack-board.tsx', import.meta.url), 'utf8');

test('theme board describes the current draw pool and keeps real owned counts separate from attempts', () => {
  assert.match(source, /마일리지·테마 꾸미기·리롤권 중 하나를 받아요/);
  assert.match(source, /브론즈에는 가구도 있어요/);
  assert.doesNotMatch(source, /코인·테마 꾸미기·캐릭터 중 하나가 나와요/);
  assert.match(source, /꾸미기도 중복될 수 있으며/);
  assert.match(source, /\$\{progress\.ownedBonuses\}\/\$\{progress\.totalBonuses\}개 소장 · 이 등급 \$\{progress\.opens\}회 뽑기/);
  assert.doesNotMatch(source, /미보유 꾸미기 1개가 확정|모자 → 소품 → 장식|세 번 열면/);
});
