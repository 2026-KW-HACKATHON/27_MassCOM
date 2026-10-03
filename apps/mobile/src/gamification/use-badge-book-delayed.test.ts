import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

import type { BadgeApiClient, BadgeBook, OpenedReward } from './badge-api';

// 네이티브 렌더러 없이 실제 훅을 실행한다. 상태·의존성·effect 정리만 React 경계에서 대체한다.
function badgeHookHarness() {
  const slots: any[] = [];
  let cursor = 0;
  let dirty = false;
  const layoutEffects: (() => void)[] = [];
  const effects: (() => void)[] = [];
  const changed = (before: unknown[] | undefined, after: unknown[]) => !before || after.some((value, i) => value !== before[i]);
  const react = {
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (next: any) => {
        const value = typeof next === 'function' ? next(slots[index]) : next;
        if (value !== slots[index]) { slots[index] = value; dirty = true; }
      }];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      return slots[index] ??= { current: initial };
    },
    useCallback(callback: unknown, deps: unknown[]) {
      const index = cursor++;
      if (changed(slots[index]?.deps, deps)) slots[index] = { deps, callback };
      return slots[index].callback;
    },
    useEffect(effect: () => (() => void) | void, deps: unknown[]) {
      const index = cursor++;
      if (!changed(slots[index]?.deps, deps)) return;
      const previous = slots[index];
      const slot = slots[index] = { deps, cleanup: undefined as (() => void) | undefined };
      effects.push(() => { previous?.cleanup?.(); slot.cleanup = effect() || undefined; });
    },
    useLayoutEffect(effect: () => (() => void) | void, deps: unknown[]) {
      const index = cursor++;
      if (!changed(slots[index]?.deps, deps)) return;
      const previous = slots[index];
      const slot = slots[index] = { deps, cleanup: undefined as (() => void) | undefined };
      layoutEffects.push(() => { previous?.cleanup?.(); slot.cleanup = effect() || undefined; });
    },
  };
  const exports: any = {};
  const source = readFileSync(new URL('./use-badge-book.ts', import.meta.url), 'utf8');
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, require: () => react });
  return {
    render(api: BadgeApiClient | undefined) {
      let result: ReturnType<typeof import('./use-badge-book').useBadgeBook>;
      do { cursor = 0; dirty = false; result = exports.useBadgeBook(api); } while (dirty);
      layoutEffects.splice(0).forEach((effect) => effect());
      effects.splice(0).forEach((effect) => effect());
      return result!;
    },
    dispose() { slots.forEach((slot) => slot?.cleanup?.()); },
  };
}

function delayed<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
const book = (earnedTiers: number): BadgeBook => ({
  medals: (['explorer', 'regular', 'steady'] as const).map((kind) => ({
    kind, value: earnedTiers, tier: 0 as const, thresholds: [1, 2, 3] as const,
  })),
  earnedTiers,
  rewards: ([1, 2, 3] as const).map((milestone) => ({
    milestone, requiredTiers: milestone, state: 'READY' as const, offer: null, coupon: null,
  })),
});
const opened: OpenedReward = {
  coupon: {
    milestone: 1, couponId: 'A-coupon', merchantId: 'store-1', merchantName: '가게', title: '쿠폰',
    detail: '안내', status: 'ISSUED', issuedAt: '2026-10-03T00:00:00.000Z',
    expiresAt: '2026-10-04T00:00:00.000Z', redeemedAt: null,
  },
  replayed: false,
};

test('A 상자 지연 완료·실패 콜백과 외부 교체는 B 배지 책을 바꾸거나 A API를 재조회하지 않는다', async () => {
  const harness = badgeHookHarness();
  let aReads = 0;
  const apiA = { getBadgeBook: async () => { aReads++; return book(0); } } as BadgeApiClient;
  const apiB = { getBadgeBook: async () => book(1) } as BadgeApiClient;
  harness.render(apiA); await flush();
  const a = harness.render(apiA);
  const completion = delayed<OpenedReward>();
  const failure = delayed<OpenedReward>();
  const pendingCompletion = completion.promise.then(a.applyOpened);
  const pendingFailure = failure.promise.catch(() => a.refreshQuietly());
  harness.render(undefined);
  harness.render(apiB); await flush();
  const b = harness.render(apiB).book;
  completion.resolve(opened);
  failure.reject(new Error('A 실패'));
  await Promise.all([pendingCompletion, pendingFailure]); await flush();
  a.replace(book(2));
  await a.retry();
  assert.equal(harness.render(apiB).book, b);
  assert.equal(aReads, 1);
  assert.equal(harness.render(apiB).retrying, false);
  // 현재 세대의 변경은 정상 반영한다.
  harness.render(apiB).replace(book(3));
  assert.equal(harness.render(apiB).book?.earnedTiers, 3);
  harness.dispose();
});

test('계정 변경 전 시작한 배지 재시도의 늦은 응답도 버린다', async () => {
  const harness = badgeHookHarness();
  const response = delayed<BadgeBook>();
  const apiA = { getBadgeBook: () => response.promise } as BadgeApiClient;
  const apiB = { getBadgeBook: async () => book(1) } as BadgeApiClient;
  const a = harness.render(apiA);
  const pending = a.retry();
  harness.render(apiB); await flush();
  response.resolve(book(0)); await pending; await flush();
  assert.equal(harness.render(apiB).book?.earnedTiers, 1);
  assert.equal(harness.render(apiB).retrying, false);
  harness.dispose();
});

test('A의 늦은 재시도 종료는 진행 중인 B의 재시도 표시를 지우지 않는다', async () => {
  const harness = badgeHookHarness();
  const aRetry = delayed<BadgeBook>();
  const bRetry = delayed<BadgeBook>();
  let aReads = 0;
  let bReads = 0;
  const apiA = { getBadgeBook: () => ++aReads === 1 ? Promise.resolve(book(0)) : aRetry.promise } as BadgeApiClient;
  const apiB = { getBadgeBook: () => ++bReads === 1 ? Promise.resolve(book(1)) : bRetry.promise } as BadgeApiClient;
  harness.render(apiA); await flush();
  const pendingA = harness.render(apiA).retry();
  harness.render(apiB); await flush();
  const pendingB = harness.render(apiB).retry();
  assert.equal(harness.render(apiB).retrying, true);
  aRetry.resolve(book(0)); await pendingA;
  assert.equal(harness.render(apiB).retrying, true);
  bRetry.resolve(book(1)); await pendingB;
  assert.equal(harness.render(apiB).retrying, false);
  harness.dispose();
});

test('로그아웃 상태에서는 외부 교체와 열기·재시도가 책을 만들지 않는다', async () => {
  const harness = badgeHookHarness();
  const signedOut = harness.render(undefined);
  signedOut.replace(book(1));
  signedOut.applyOpened(opened);
  await signedOut.retry();
  assert.equal(harness.render(undefined).book, undefined);
  assert.equal(harness.render(undefined).retrying, false);
  harness.dispose();
});
