import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

import { hasOpenableBox } from '../../commerce/after-visit-action';
import { createIdentityRequestGate } from '../../commerce/customer-identity';
import type { RedeemedClaim } from '../../commerce/commerce-api';
import type { BadgeBook } from '../../gamification/badge-api';
import { diffBadgeBooks } from '../../gamification/badge-rules';

function delayed<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

// 실제 화면의 focus·축하 콜백을 실행하고, 네이티브 UI 대신 상태 쓰기와 API 경계만 대체한다.
function harness(reads: Promise<BadgeBook>[]) {
  const screen = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');
  const focus = screen.slice(screen.indexOf('// 도감에서 상자를'), screen.indexOf('// 수령 후 추천'));
  const celebrate = screen.slice(screen.indexOf('async function celebrate'), screen.indexOf('// #332: 방문 뒤'));
  const result = { claimSlotId: 'claim', merchantName: '가게', grantedRewards: [], visit: { progressCounted: true } } as unknown as RedeemedClaim;
  let onFocus!: () => (() => void);
  let box: string | undefined;
  const exports = {} as { celebrate: (claim: RedeemedClaim, before: Promise<BadgeBook>) => Promise<void> };
  runInNewContext(ts.transpileModule(`${focus}\n${celebrate}\nexports.celebrate = celebrate;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, {
    exports, apiUrl: 'api', accountId: 'account', redeemed: result,
    activeClaimSlot: { current: result.claimSlotId }, badgeBookGate: createIdentityRequestGate(),
    badgeApi: { getBadgeBook: () => { assert.ok(reads.length); return reads.shift()!; } },
    useFocusEffect: (callback: typeof onFocus) => { onFocus = callback; },
    useCallback: (callback: typeof onFocus) => callback,
    presentedCollectibleIds: () => new Set(), setPresentedIds: () => {},
    hasOpenableBox, diffBadgeBooks, setCelebration: () => {},
    setOpenableBoxClaimSlot: (next: string | undefined) => { box = next; },
  });
  return { focus: () => onFocus(), celebrate: (before: Promise<BadgeBook>) => exports.celebrate(result, before), box: () => box };
}

const book = (state: 'READY' | 'OPENED'): BadgeBook => ({
  medals: [], earnedTiers: 1,
  rewards: [{ milestone: 1, requiredTiers: 1, state, offer: null, coupon: null }],
});
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test('상자를 연 뒤 도착한 방문 전 배지 조회는 오래된 READY 행동을 되살리지 않는다', async () => {
  const before = delayed<BadgeBook>();
  const h = harness([Promise.resolve(book('READY')), Promise.resolve(book('READY')), Promise.resolve(book('OPENED'))]);
  const celebration = h.celebrate(before.promise);
  const blur = h.focus(); await flush();
  assert.equal(h.box(), 'claim');
  blur(); h.focus(); await flush();
  assert.equal(h.box(), undefined);
  before.resolve(book('OPENED')); await celebration;
  assert.equal(h.box(), undefined);
});

test('이전 focus 조회가 늦어도 최신 OPENED 상태를 덮지 않는다', async () => {
  const stale = delayed<BadgeBook>();
  const h = harness([stale.promise, Promise.resolve(book('OPENED'))]);
  const blur = h.focus(); blur(); h.focus(); await flush();
  stale.resolve(book('READY')); await flush();
  assert.equal(h.box(), undefined);
});
