import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { gamePrompt, nextCollectibleLabel, playRecordLabel, virtualPlayNotice, virtualPlayNoticeFor } from './play-copy';
import { gameKinds, getGameBoard } from '../../../../api/src/play-rules';

test('each play instruction matches the board that the server issues', () => {
  assert.deepEqual(Object.keys(gamePrompt).sort(), [...gameKinds].sort());
  for (const kind of gameKinds) {
    const board = getGameBoard(kind, 17);
    const expected = board.kind === 'stack' ? board.rounds.length : board.kind === 'memory' ? board.cards.length / 2
      : board.kind === 'delivery' ? board.ticks.length : board.orders[0]!.length;
    assert.match(gamePrompt[kind], new RegExp(String(expected)));
  }
});

test('old server records retain their actual highest and completion count', () => {
  assert.equal(playRecordLabel({ kind: 'stack', bestScore: 520, plays: 3 }), '이전 놀이 최고 520점 · 3회 완주');
});

test('new-only records never invent a zero-point legacy record', () => {
  assert.equal(playRecordLabel({ kind: 'stack', bestScore: 0, plays: 2, version2BestScore: 490, version2Plays: 2 }), '현재 최고 490점 · 2회 완주');
  assert.equal(playRecordLabel({ kind: 'stack', bestScore: 74, plays: 0, version2BestScore: 0, version2Plays: 0 }), '첫 완주에 도전');
});

test('mixed records separate highest scores and derive the legacy run count', () => {
  assert.equal(playRecordLabel({ kind: 'stack', bestScore: 520, plays: 5, version2BestScore: 490, version2Plays: 2 }), '현재 최고 490점 · 2회 완주 · 이전 놀이 최고 520점 · 3회 완주');
  assert.equal(playRecordLabel({ kind: 'stack', bestScore: 520, plays: 3, version2BestScore: 0, version2Plays: 0 }), '첫 완주에 도전 · 이전 놀이 최고 520점 · 3회 완주');
  assert.equal(playRecordLabel(undefined), '첫 완주에 도전');
});

test('practice card identities map to distinct real illustration frames and preserve owned names', async () => {
  const { practiceTokens, tokenName } = await import('./play-copy');
  const { cosmeticFrames } = await import('../../illustration/art-catalog');
  const frames = practiceTokens.flatMap(token => 'cosmetic' in token ? [cosmeticFrames[token.cosmetic]] : []);
  assert.equal(frames.length, 2);
  assert.ok(frames.every(frame => Number.isInteger(frame)));
  assert.equal(new Set(frames).size, 2);
  assert.equal(tokenName([], 4), '기억 카드 · 연습용');
  assert.equal(tokenName([], 5), '금빛 랜턴 · 연습용');
  assert.equal(tokenName([{ name: '방문 가게의 실제 수집품' }], 0), '방문 가게의 실제 수집품');
});

test('end reason distinguishes completed work, fall, cargo loss, timeout, limits and manual stop', async () => {
  const { playEndLabel } = await import('./play-copy');
  const partial = { kind: 'stack' as const, failed: false, completed: false };
  assert.match(playEndLabel({ ...partial, completed: true }, true, true), /모두 완성/);
  assert.match(playEndLabel({ ...partial, failed: true }, false, false), /상자가 떨어/);
  assert.match(playEndLabel({ ...partial, kind: 'delivery', failed: true }, false, false), /세 번 충돌/);
  assert.match(playEndLabel(partial, true, false), /시간이 끝/);
  assert.match(playEndLabel(partial, false, true), /조작을 모두 사용/);
  assert.match(playEndLabel(partial, false, false), /직접 도전을 마쳤/);
});

test('an earned badge remains owned after a failed replay without inventing a new award', async () => {
  const { rewardState } = await import('./play-copy');
  const failedReplay = { skill: { achieved: false }, newlyEarned: false };
  assert.deepEqual(rewardState(true, failedReplay), { owned: true, newlyEarned: false });
  assert.deepEqual(rewardState(false, failedReplay), { owned: false, newlyEarned: false });
  assert.deepEqual(rewardState(false, { skill: { achieved: true }, newlyEarned: true }), { owned: true, newlyEarned: true });
});

const source = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');

test('orders and delivery carry the fixed pretend-play notice; stack and memory do not', () => {
  assert.equal(virtualPlayNotice, '가게 메뉴 정보로 만든 가상 놀이예요. 실제 주문·결제·매출은 없어요.');
  for (const kind of gameKinds) assert.equal(virtualPlayNoticeFor(kind), kind === 'orders' || kind === 'delivery' ? virtualPlayNotice : undefined, kind);
});

test('every orders and delivery surface renders the notice: prep screen, in-game header and result', () => {
  const prep = source('./index.tsx');
  assert.match(prep, /\{virtualPlayNoticeFor\(selection\) \? <Text[^>]*>\{virtualPlayNoticeFor\(selection\)\}<\/Text> : null\}/);
  const session = source('./quality-session.tsx');
  assert.match(session, /const playNotice = virtualPlayNoticeFor\(run\.kind\)/);
  assert.match(session, /\{playNotice && status !== 'result' \? <Text[^>]*>\{playNotice\}<\/Text> : null\}/);
  assert.match(session, /\{playNotice \? <Text[^>]*>\{playNotice\}<\/Text> : null\}\s*\{run\.kind === 'orders' \? <UsedMenus/);
  assert.equal(session.match(/\{playNotice\}/g)?.length, 2);
});

test('orders and delivery results carry one store link, not one per menu row, and no game shows a price', () => {
  const session = source('./quality-session.tsx');
  assert.match(session, /\{playNotice && storeRoute \? <StoreLink /);
  assert.equal(session.match(/accessibilityRole="link"/g)?.length, 1);
  assert.equal(session.match(/<StoreLink /g)?.length, 1);
  assert.match(session, /가게 상세에서 보기/);
  assert.match(session, /<UsedMenus tokens=\{visual\.tokens\} \/>/);
  for (const file of ['./index.tsx', './quality-session.tsx', './play-content.ts', './play-copy.ts']) assert.doesNotMatch(source(file), /priceWon|priceNote/, file);
});

test('the memory result board names each coin\'s store and points to its next collectible without a visit button', () => {
  assert.equal(nextCollectibleLabel({ targetVisitCount: 3, displayName: '단골 우표', owned: false }), '다음 수집품: 3회 방문 시 단골 우표');
  const session = source('./quality-session.tsx');
  assert.match(session, /\{next \? <Text[^>]*>\{next\}<\/Text> : null\}/);
  assert.match(session, /복원한 방문 도감/);
  assert.doesNotMatch(session, /방문하기|방문하러/);
  // The next-collectible and 도감 lines are 14px, not the 12px ticket text.
  assert.match(session, /coinMeta: \{ fontSize: 14/);
  assert.equal(session.match(/styles\.coinMeta/g)?.length, 3);
  assert.match(source('./index.tsx'), /방문한 가게 \{art\.length\}곳/);
});

test('games neither log discovery events nor are imported by the visit, claim and collection flows', () => {
  for (const file of readdirSync(new URL('.', import.meta.url)).filter((name) => /\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts'))) {
    assert.doesNotMatch(source(`./${file}`), /discovery-api|discovery-detail-view|\/v1\/discovery\/events/, file);
  }
  for (const folder of ['../claim-redeem', '../collection', '../../commerce']) {
    for (const file of readdirSync(new URL(`${folder}/`, import.meta.url)).filter((name) => /\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts'))) {
      assert.doesNotMatch(source(`${folder}/${file}`), /screens\/play|from '(\.\.\/)+play\/|from '\.\.\/play'|play-content|quality-session/, `${folder}/${file}`);
    }
  }
});
