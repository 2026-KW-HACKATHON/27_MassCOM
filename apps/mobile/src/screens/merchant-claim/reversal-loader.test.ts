import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CommerceApiError,
  type CanceledVisit,
  type RecentCouponRedemption,
  type RecentVisit,
} from '@/commerce/commerce-api';
import {
  createReversalController,
  initialReversalState,
  type ReversalApi,
  type ReversalState,
} from './reversal-loader';

const visit = (id: string, over: Partial<RecentVisit> = {}): RecentVisit => ({
  visitEventId: id, claimSlotId: 'slot-' + id, occurredAt: '2026-09-30T03:05:00.000Z', customerLabel: '손님 K7QM', status: 'VALID',
  progressCounted: true, cancellationReason: null, canCancel: true, ...over,
});
const redemption = (id: string): RecentCouponRedemption => ({
  couponId: id, title: '음료 1잔', redeemedAt: '2026-09-30T03:00:00.000Z', customerLabel: '손님 K7QM',
  redeemedByMe: true, undoUntil: '2026-09-30T03:10:00.000Z', canUndo: true,
});
const canceled = (over: Partial<CanceledVisit> = {}): CanceledVisit => ({
  visitEventId: 'v1', status: 'CANCELED', reason: 'DUPLICATE', note: null, canceledAt: '2026-09-30T03:06:00.000Z',
  revokedRewardCount: 0, voidedCouponCount: 0, replayed: false, ...over,
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

type Calls = { listVisits: string[]; listRedemptions: string[]; cancel: unknown[]; undo: unknown[] };

// 상태 저장소 한 개와 가짜 API. 컨트롤러가 화면에 그릴 상태를 바꾸는 순서를 그대로 시험한다.
function fixture(over: Partial<ReversalApi> = {}) {
  const calls: Calls = { listVisits: [], listRedemptions: [], cancel: [], undo: [] };
  const api: ReversalApi = {
    listRecentVisits: async (merchantId) => { calls.listVisits.push(merchantId); return { visits: [visit('v1')] }; },
    listRecentCouponRedemptions: async (merchantId) => { calls.listRedemptions.push(merchantId); return [redemption('c1')]; },
    cancelVisit: async (input) => { calls.cancel.push(input); return canceled(); },
    undoCouponRedemption: async (input) => { calls.undo.push(input); return { couponId: input.couponId, status: 'ISSUED', replayed: false }; },
    ...over,
  };
  // 상태는 함수로 읽는다: assert.equal이 속성 접근을 좁히면 await 뒤의 값이 타입에서 사라진다.
  let current: ReversalState = initialReversalState;
  const box = { get: (): ReversalState => current, set: (next: ReversalState) => { current = next; } };
  const apply = (update: (state: ReversalState) => ReversalState) => { current = update(current); };
  return { api, calls, box, apply };
}

test('start clears the previous store and reads both lists', async () => {
  const { api, calls, box, apply } = fixture();
  box.set({ ...initialReversalState, merchantId: 'old-shop', visits: [visit('old')], redemptions: [redemption('old')], visitMessage: undefined, redemptionMessage: undefined });
  const controller = createReversalController(api, 'shop-2', apply);
  const loading = controller.start();
  // 읽는 동안에는 이전 점포의 목록이 없고 "불러오는 중"만 있다.
  assert.equal(box.get().merchantId, 'shop-2');
  assert.equal(box.get().visits, undefined);
  assert.equal(box.get().redemptions, undefined);
  assert.equal(box.get().visitMessage, '최근 방문을 불러오는 중이에요.');
  await loading;
  assert.deepEqual(calls.listVisits, ['shop-2']);
  assert.deepEqual(calls.listRedemptions, ['shop-2']);
  assert.deepEqual(box.get().visits?.map((item) => item.visitEventId), ['v1']);
  assert.deepEqual(box.get().redemptions?.map((item) => item.couponId), ['c1']);
  assert.equal(box.get().visitMessage, undefined);
  assert.equal(box.get().redemptionMessage, undefined);
});

test('empty and failed lists show a message and never keep stale rows', async () => {
  const { api, box, apply } = fixture({
    listRecentVisits: async () => ({ visits: [] }),
    listRecentCouponRedemptions: async () => { throw new CommerceApiError(403, 'MERCHANT_ACCESS_DENIED'); },
  });
  await createReversalController(api, 'shop', apply).start();
  assert.deepEqual(box.get().visits, []);
  assert.equal(box.get().visitMessage, '오늘 확인한 방문이 없어요.');
  assert.equal(box.get().redemptions, undefined);
  assert.match(box.get().redemptionMessage ?? '', /볼 권한이 없어요/);

  const broken = fixture({
    listRecentVisits: async () => { throw new Error('offline'); },
    listRecentCouponRedemptions: async () => [],
  });
  await createReversalController(broken.api, 'shop', broken.apply).start();
  assert.equal(broken.box.get().visits, undefined);
  assert.match(broken.box.get().visitMessage ?? '', /불러오지 못했어요/);
  assert.equal(broken.box.get().redemptionMessage, '최근 24시간 안에 사용 처리한 쿠폰이 없어요.');
});

test('only the newest read may reach the screen', async () => {
  const first = deferred<{ visits: RecentVisit[] }>();
  const second = deferred<{ visits: RecentVisit[] }>();
  const queue = [first, second];
  const { api, box, apply } = fixture({ listRecentVisits: () => queue.shift()!.promise });
  const controller = createReversalController(api, 'shop', apply);
  const older = controller.start();
  const newer = controller.refresh();
  second.resolve({ visits: [visit('new')] });
  await newer;
  first.resolve({ visits: [visit('old')] });
  await older;
  assert.deepEqual(box.get().visits?.map((item) => item.visitEventId), ['new']);
});

test('nothing reaches the screen after dispose, for reads and for actions', async () => {
  const read = deferred<{ visits: RecentVisit[] }>();
  const { api, box, apply } = fixture({ listRecentVisits: () => read.promise });
  const controller = createReversalController(api, 'shop', apply);
  const loading = controller.start();
  const snapshot = box.get();
  controller.dispose();
  read.resolve({ visits: [visit('late')] });
  await loading;
  assert.equal(box.get(), snapshot);

  const cancel = deferred<CanceledVisit>();
  const acting = fixture({ cancelVisit: () => cancel.promise });
  const live = createReversalController(acting.api, 'shop', acting.apply);
  await live.start();
  const running = live.cancelVisit(visit('v1'), { reason: 'DUPLICATE', note: '' });
  const before = acting.box.get();
  live.dispose();
  cancel.resolve(canceled());
  await running;
  assert.equal(acting.box.get(), before);
});

test('cancelling sends one request while busy and reports success with the reloaded list', async () => {
  const cancel = deferred<CanceledVisit>();
  const { api, calls, box, apply } = fixture({ cancelVisit: async (input) => { calls.cancel.push(input); return cancel.promise; } });
  const controller = createReversalController(api, 'shop', apply);
  await controller.start();
  const first = controller.cancelVisit(visit('v1'), { reason: 'NOT_A_REAL_VISIT', note: '옆 테이블' });
  // 렌더를 기다리지 않은 두 번째 누름은 서버로 가지 않는다.
  assert.equal(controller.isBusy(), true);
  assert.equal(box.get().busy, true);
  assert.equal(await controller.cancelVisit(visit('v1'), { reason: 'OTHER', note: '' }), false);
  assert.equal(await controller.undoCoupon(redemption('c1')), false);
  assert.equal(calls.cancel.length, 1);
  assert.deepEqual(calls.cancel[0], { merchantId: 'shop', visitEventId: 'v1', reason: 'NOT_A_REAL_VISIT', note: '옆 테이블' });
  cancel.resolve(canceled({ revokedRewardCount: 1, voidedCouponCount: 2 }));
  assert.equal(await first, true);
  assert.equal(controller.isBusy(), false);
  assert.equal(box.get().busy, false);
  // 성공 문구는 새 목록을 읽은 뒤에도 남는다.
  assert.equal(box.get().visitMessage, '방문을 취소했어요. (보상 권리 1개 취소, 미사용 쿠폰 2장 무효)');
  assert.equal(calls.listVisits.length, 2);
  assert.equal(calls.listRedemptions.length, 2);
});

test('a failed cancellation shows the coded message, refreshes only stale lists and unlocks', async () => {
  for (const [code, refreshes] of [
    ['VISIT_CANCEL_WINDOW_CLOSED', true], ['VISIT_NOT_FOUND', true],
    ['VISIT_REWARD_ALREADY_MINTED', false], ['VISIT_REWARD_MINT_IN_PROGRESS', false],
  ] as const) {
    const { api, calls, box, apply } = fixture({ cancelVisit: async () => { throw new CommerceApiError(409, code); } });
    const controller = createReversalController(api, 'shop', apply);
    await controller.start();
    assert.equal(await controller.cancelVisit(visit('v1'), { reason: 'OTHER', note: '' }), false, code);
    assert.equal(calls.listVisits.length, refreshes ? 2 : 1, code);
    assert.equal(controller.isBusy(), false, code);
    assert.equal(box.get().busy, false, code);
    assert.notEqual(box.get().visitMessage, undefined, code);
    // 잠금이 풀렸으니 다시 시도할 수 있다.
    assert.equal(await controller.cancelVisit(visit('v1'), { reason: 'OTHER', note: '' }), false, code);
    assert.equal(calls.listVisits.length, refreshes ? 3 : 1, code);
  }
  const plain = fixture({ cancelVisit: async () => { throw new Error('network'); } });
  const controller = createReversalController(plain.api, 'shop', plain.apply);
  await controller.start();
  assert.equal(await controller.cancelVisit(visit('v1'), { reason: 'OTHER', note: '' }), false);
  assert.match(plain.box.get().visitMessage ?? '', /방문을 취소하지 못했어요/);
});

test('undoing a coupon is guarded, reloads the coupon list and refreshes when the coupon list is stale', async () => {
  const undo = deferred<{ couponId: string; status: 'ISSUED'; replayed: boolean }>();
  const { api, calls, box, apply } = fixture({ undoCouponRedemption: async (input) => { calls.undo.push(input); return undo.promise; } });
  const controller = createReversalController(api, 'shop', apply);
  await controller.start();
  const first = controller.undoCoupon(redemption('c1'));
  assert.equal(await controller.undoCoupon(redemption('c1')), false);
  assert.equal(await controller.cancelVisit(visit('v1'), { reason: 'OTHER', note: '' }), false);
  assert.equal(calls.undo.length, 1);
  undo.resolve({ couponId: 'c1', status: 'ISSUED', replayed: false });
  assert.equal(await first, true);
  assert.equal(box.get().redemptionMessage, '쿠폰 사용을 되돌렸어요. 고객이 다시 사용할 수 있어요.');
  assert.equal(calls.listRedemptions.length, 2);

  for (const [code, refreshes] of [
    ['COUPON_UNDO_WINDOW_CLOSED', true], ['COUPON_NOT_REDEEMED', true], ['COUPON_NOT_FOUND', true],
    ['COUPON_REQUIREMENT_LOST', true], ['COUPON_SELF_UNDO', false],
  ] as const) {
    const failing = fixture({ undoCouponRedemption: async () => { throw new CommerceApiError(code === 'COUPON_SELF_UNDO' ? 403 : 409, code); } });
    const failed = createReversalController(failing.api, 'shop', failing.apply);
    await failed.start();
    assert.equal(await failed.undoCoupon(redemption('c1')), false, code);
    assert.equal(failing.calls.listRedemptions.length, refreshes ? 2 : 1, code);
    assert.equal(failing.box.get().busy, false, code);
  }
  const self = fixture({ undoCouponRedemption: async () => { throw new CommerceApiError(403, 'COUPON_SELF_UNDO'); } });
  const selfController = createReversalController(self.api, 'shop', self.apply);
  await selfController.start();
  await selfController.undoCoupon(redemption('c1'));
  assert.match(self.box.get().redemptionMessage ?? '', /본인 쿠폰은 직접 되돌릴 수 없어요/);
});
