import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const readScreen = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

// 네이티브 화면을 로드하지 않고 실제 화면 파일의 순수 함수만 실행한다.
function screenDecision<T>(path: string, name: string): T {
  const source = ts.createSourceFile(path, readScreen(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, `${name} 판정 함수가 필요합니다`);
  const exports = {};
  runInNewContext(ts.transpileModule(declaration.getText(source), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports });
  return (exports as Record<string, T>)[name]!;
}

test('소유 0이면 공개 가게 응답·로딩·오류와 무관하게 첫 방문 안내를 유지한다', () => {
  const decide = screenDecision<(count: number, loading: boolean, error: string | undefined, seriesCount: number) => {
    showEmpty: boolean; showCoinLink: boolean; seriesState: string;
  }>('../screens/collection/index.tsx', 'collectionDisplayState');
  for (const [loading, error, seriesCount, expected] of [
    [false, undefined, 1, 'ready'], [true, undefined, 0, 'loading'],
    [false, '조회 실패', 0, 'error'], [false, undefined, 0, 'empty'],
  ] as const) {
    const state = decide(0, loading, error, seriesCount);
    assert.equal(state.showEmpty, true);
    assert.equal(state.showCoinLink, false);
    assert.equal(state.seriesState, expected);
    assert.equal(decide(1, loading, error, seriesCount).showEmpty, false);
    assert.equal(decide(1, loading, error, seriesCount).showCoinLink, true);
  }
});

test('빈 코인 화면은 순환 링크를 숨기고 소유 코인 또는 NFT 상태가 있으면 노출한다', () => {
  const decide = screenDecision<(coins: { quantity: number }[], sources: { nftStatus: string }[]) => {
    showEmpty: boolean; showCollectionLink: boolean; showShopLink: boolean;
  }>('../screens/coin-collection/index.tsx', 'coinCollectionDisplayState');
  const empty = decide([], []);
  assert.equal(empty.showEmpty, true);
  assert.equal(empty.showCollectionLink, false);
  assert.equal(empty.showShopLink, false);
  assert.equal(decide([{ quantity: 0 }], [{ nftStatus: 'NOT_REQUESTED' }]).showCollectionLink, false);
  const owned = decide([{ quantity: 1 }], []);
  assert.equal(owned.showEmpty, false);
  assert.equal(owned.showCollectionLink, true);
  assert.equal(owned.showShopLink, true);
  for (const nftStatus of ['PENDING', 'COMPLETED']) {
    const state = decide([], [{ nftStatus }]);
    assert.equal(state.showEmpty, false);
    assert.equal(state.showCollectionLink, true);
    assert.equal(state.showShopLink, false);
  }
});

test('화면은 판정 결과를 연결하고 가게 목록 상태를 별도 영역에 둔다', () => {
  const album = readScreen('../screens/collection/index.tsx');
  assert.match(album, /displayState\.showCoinLink \? <Section/);
  assert.match(album, /displayState\.showEmpty \? <StateScene/);
  assert.match(album, /<Section title="수집품·공개 가게 시리즈"/);
  for (const state of ['loading', 'error', 'empty']) assert.ok(album.includes(`displayState.seriesState === '${state}'`));
  const coins = readScreen('../screens/coin-collection/index.tsx');
  assert.match(coins, /displayState\.showCollectionLink \? <Pressable/);
  assert.match(coins, /displayState\.showShopLink \? <Pressable/);
  assert.match(coins, /displayState\.showEmpty \? <StateScene/);
});

test('뽑기권 화면의 도감 링크는 티켓 보유와 관계없이 표시한다', () => {
  const screen = readScreen('../screens/coin-shop/index.tsx');
  assert.match(screen, /shop\.tickets\.filter\(\(ticket\) => ticket\.status === 'UNUSED'\)\.length === 0 \? <StateScene kind="empty"/);
  assert.match(screen, /<Pressable accessibilityRole="button" onPress=\{\(\) => router\.push\('\/coin-collection'\)\} style=\{styles\.link\}>\s*<Text[^>]*>내 코인과 시리즈 보기 ›<\/Text>\s*<\/Pressable>\s*<\/SkyScrollView>/);
});

test('상점 0P는 탐색을 안내하고 확률과 획득 정책은 펼쳐서 읽는다', () => {
  const screen = readScreen('../screens/shop/index.tsx');
  assert.match(screen, /\(drawShop\?\.balance \?\? snapshot\.mileage\.balance\) === 0 \? <StateScene kind="empty"[^>]*action=\{\{ label: '가게 방문하고 마일리지 모으기', onPress: \(\) => router\.push\('\/search'\) \}\} framed=\{false\} \/>/);
  assert.match(screen, /<Fold title="마일리지 획득 안내"[^>]*>[\s\S]*?earnRulesText\(snapshot\.mileage\.rules\)/);
  assert.match(screen, /<Fold title="뽑기 확률 보기"[^>]*>[\s\S]*?grade\.probabilityPerItem/);
});
