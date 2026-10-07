import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const readScreen = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('도감이 비었으면 공통 마스코트 장면에서 첫 방문을 탐색으로 안내한다', () => {
  const screen = readScreen('../screens/collection/index.tsx');
  assert.match(screen, /collection\.collectibles\.length === 0 && storeSeries\.length === 0 \? <StateScene kind="empty" title="[^\"]+" action=\{\{ label: '첫 도장 받으러 가기', onPress: \(\) => router\.push\('\/search'\) \}\} \/>/);
});

test('받은 가게 뽑기권이 없으면 탐색 행동 하나를 보여 주고 빈 도감 순환 링크를 숨긴다', () => {
  const screen = readScreen('../screens/coin-shop/index.tsx');
  assert.match(screen, /shop\.tickets\.filter\(\(ticket\) => ticket\.status === 'UNUSED'\)\.length === 0 \? <StateScene kind="empty"/);
  assert.match(screen, /label: '가게 찾기', onPress: \(\) => router\.push\('\/search'\)/);
  assert.match(screen, /\{shop && shop\.tickets\.some\(\(ticket\) => ticket\.status === 'UNUSED'\) \? <Pressable[^>]*onPress=\{\(\) => router\.push\('\/coin-collection'\)\}/);
});

test('코인이 없으면 탐색 행동 하나를 보여 주고 빈 뽑기권 순환 링크를 숨긴다', () => {
  const screen = readScreen('../screens/coin-collection/index.tsx');
  assert.match(screen, /collection\.coins\.length === 0 \? <StateScene kind="empty"/);
  assert.match(screen, /label: '가게 찾기', onPress: \(\) => router\.push\('\/search'\)/);
  assert.match(screen, /\{collection\.coins\.length > 0 \? <Pressable[^>]*onPress=\{\(\) => router\.push\('\/coin-shop'\)\}/);
});

test('상점 0P는 탐색을 안내하고 확률과 획득 정책은 펼쳐서 읽는다', () => {
  const screen = readScreen('../screens/shop/index.tsx');
  assert.match(screen, /\(drawShop\?\.balance \?\? snapshot\.mileage\.balance\) === 0 \? <StateScene kind="empty"[^>]*action=\{\{ label: '가게 방문하고 마일리지 모으기', onPress: \(\) => router\.push\('\/search'\) \}\} framed=\{false\} \/>/);
  assert.match(screen, /<Fold title="마일리지 획득 안내"[^>]*>[\s\S]*?earnRulesText\(snapshot\.mileage\.rules\)/);
  assert.match(screen, /<Fold title="뽑기 확률 보기"[^>]*>[\s\S]*?grade\.probabilityPerItem/);
});
