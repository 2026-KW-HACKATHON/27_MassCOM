import assert from 'node:assert/strict';
import test from 'node:test';
import { playRecordLabel } from './play-copy';

test('old server records retain their actual highest and completion count', () => {
  assert.equal(playRecordLabel({ kind: 'stack', bestScore: 520, plays: 3 }), '기존 규칙 최고 520점 · 3회 완주');
});

test('new-only records never invent a zero-point legacy record', () => {
  assert.equal(playRecordLabel({ kind: 'stack', bestScore: 0, plays: 2, version2BestScore: 490, version2Plays: 2 }), '새 규칙 최고 490점 · 2회 완주');
  assert.equal(playRecordLabel({ kind: 'stack', bestScore: 0, plays: 0, version2BestScore: 0, version2Plays: 0 }), '새 규칙 첫 기록에 도전');
});

test('mixed records separate highest scores and derive the legacy run count', () => {
  assert.equal(playRecordLabel({ kind: 'stack', bestScore: 520, plays: 5, version2BestScore: 490, version2Plays: 2 }), '새 규칙 최고 490점 · 2회 완주 · 기존 규칙 최고 520점 · 3회 완주');
  assert.equal(playRecordLabel({ kind: 'stack', bestScore: 520, plays: 3, version2BestScore: 0, version2Plays: 0 }), '새 규칙 첫 기록에 도전 · 기존 규칙 최고 520점 · 3회 완주');
  assert.equal(playRecordLabel(undefined), '첫 기록에 도전');
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
