import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RecentVisit } from '@/commerce/commerce-api';
import { createIssuedVisitController, issuedVisitNotice, preselectedCancelableVisit, type IssuedVisitState } from './issued-visit';

const claim = { claimSlotId: 'slot-mine', expiresAt: '2026-10-03T03:05:00Z' };
const visit = (over: Partial<RecentVisit> = {}): RecentVisit => ({
  visitEventId: 'visit-mine', claimSlotId: 'slot-mine', occurredAt: '2026-10-03T03:01:00Z',
  customerLabel: '손님 ABCD', status: 'VALID', progressCounted: true, cancellationReason: null, canCancel: true, ...over,
});
function fixture() {
  let now = Date.parse('2026-10-03T03:02:00Z');
  let state: IssuedVisitState | undefined;
  let rows: RecentVisit[] = [];
  let failure = false;
  const requests: string[] = [];
  const timers = new Map<number, () => void>();
  let timerId = 0;
  const controller = createIssuedVisitController({
    listRecentVisits: async (merchantId) => {
      requests.push(merchantId);
      if (failure) throw new Error('offline');
      return { visits: rows };
    },
  }, 'shop', (next) => { state = next; }, {
    now: () => now,
    schedule: (callback) => { timers.set(++timerId, callback); return timerId; },
    unschedule: (id) => { if (typeof id === 'number') timers.delete(id); },
  });
  return { controller, requests, timers, state: () => state, setRows: (next: RecentVisit[]) => { rows = next; },
    setFailure: (value: boolean) => { failure = value; }, setNow: (value: string) => { now = Date.parse(value); },
    async poll() { const entry = timers.entries().next().value; if (entry) { timers.delete(entry[0]); entry[1](); await new Promise<void>((resolve) => setImmediate(resolve)); } },
  };
}

test('발급 직후에는 수령 전 안내, 정확한 claimSlotId 수령 뒤에만 취소 대상이 생긴다', async () => {
  const f = fixture();
  f.setRows([visit({ visitEventId: 'someone-else', claimSlotId: 'other-slot' })]);
  await f.controller.issued(claim);
  assert.equal(f.state()?.visit, undefined);
  assert.equal(issuedVisitNotice(f.state(), Date.parse('2026-10-03T03:02:00Z'))?.kind, 'pending');
  f.setRows([visit({ claimSlotId: 'other-slot' }), visit()]);
  await f.poll();
  const notice = issuedVisitNotice(f.state(), Date.parse('2026-10-03T03:02:00Z'));
  assert.equal(notice?.kind, 'confirmed');
  assert.equal(notice?.visit?.visitEventId, 'visit-mine');
  assert.equal(notice?.canCancel, true);
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.requests, ['shop', 'shop']);
});

test('자동 확인은 발급당 3회까지만, 이후 focus와 수동 새로 고침으로 수령을 확인한다', async () => {
  const f = fixture();
  await f.controller.issued(claim);
  for (let i = 0; i < 5; i += 1) await f.poll();
  assert.equal(f.requests.length, 3);
  assert.equal(f.timers.size, 0);
  f.setRows([visit()]);
  await f.controller.refresh();
  assert.equal(f.state()?.visit?.visitEventId, 'visit-mine');
});

test('확인 실패를 아직 수령하지 않은 것으로 단정하지 않고 새로 고침 뒤 복구한다', async () => {
  const f = fixture();
  f.setFailure(true);
  await f.controller.issued(claim);
  assert.equal(issuedVisitNotice(f.state(), Date.parse('2026-10-03T03:02:00Z'))?.kind, 'unknown');
  f.setFailure(false);
  f.setRows([visit()]);
  await f.controller.refresh();
  assert.equal(issuedVisitNotice(f.state(), Date.parse('2026-10-03T03:02:00Z'))?.kind, 'confirmed');
});

test('한국 날짜 마감부터 안내를 숨기고 서버가 취소 불가인 방문에는 바로가기를 주지 않는다', () => {
  const state = { claim, visit: visit() };
  assert.equal(issuedVisitNotice(state, Date.parse('2026-10-03T14:59:59.999Z'))?.canCancel, true);
  assert.equal(issuedVisitNotice(state, Date.parse('2026-10-03T15:00:00Z')), undefined);
  assert.equal(issuedVisitNotice({ claim, visit: visit({ canCancel: false }) }, Date.parse('2026-10-03T03:02:00Z'))?.canCancel, false);
  assert.equal(issuedVisitNotice({ claim, visit: visit({ status: 'CANCELED', canCancel: false }) }, Date.parse('2026-10-03T03:02:00Z')), undefined);
  // 자정 직전에 발급한 코드는 다음 날 수령할 수 있어 expiresAt의 한국 날짜까지 안내를 유지한다.
  const midnight = { claim: { claimSlotId: 'late', expiresAt: '2026-10-03T15:04:00Z' } };
  assert.equal(issuedVisitNotice(midnight, Date.parse('2026-10-03T15:01:00Z'))?.kind, 'pending');
  assert.equal(issuedVisitNotice(midnight, Date.parse('2026-10-04T15:00:00Z')), undefined);
});

test('새 발급·화면 해제 뒤 이전 읽기 응답과 예약 확인은 버린다', async () => {
  let resolve!: (value: { visits: RecentVisit[] }) => void;
  let state: IssuedVisitState | undefined;
  let requests = 0;
  const controller = createIssuedVisitController({ listRecentVisits: async () => {
    if (++requests === 1) return new Promise((done) => { resolve = done; });
    return { visits: [] };
  // 실제 시계를 쓰면 픽스처 날짜(2026-10-03)가 지난 뒤 안내가 만료돼 요청 순서가 바뀌고 시험이 끝나지 않는다(#358). 시각을 고정한다.
  } }, 'shop', (next) => { state = next; }, {
    now: () => Date.parse('2026-10-03T03:02:00Z'),
    schedule: () => 0,
    unschedule: () => {},
  });
  const old = controller.issued(claim);
  await controller.issued({ ...claim, claimSlotId: 'new-slot', expiresAt: '2099-01-01T00:00:00Z' });
  resolve({ visits: [visit()] });
  await old;
  assert.equal(state?.claim.claimSlotId, 'new-slot');
  assert.equal(state?.visit, undefined);
  controller.dispose();
  await controller.refresh();
  assert.equal(requests, 2);
});

test('새 발급 시작은 이전 안내를 지우고 대기 응답도 무효화한다', async () => {
  const f = fixture();
  await f.controller.issued(claim);
  f.controller.clear();
  assert.equal(f.state(), undefined);
  assert.equal(f.timers.size, 0);
});

test('기존 취소 양식의 사전 선택은 새 목록의 두 ID·서버 권한·한국 날짜를 다시 대조한다', () => {
  const selection = { claimSlotId: 'slot-mine', visitEventId: 'visit-mine' };
  const now = Date.parse('2026-10-03T03:02:00Z');
  assert.equal(preselectedCancelableVisit([visit()], selection, now)?.visitEventId, 'visit-mine');
  for (const row of [visit({ claimSlotId: 'other' }), visit({ visitEventId: 'other' }), visit({ canCancel: false }), visit({ status: 'CANCELED' })]) {
    assert.equal(preselectedCancelableVisit([row], selection, now), undefined);
  }
  assert.equal(preselectedCancelableVisit([visit()], selection, Date.parse('2026-10-03T15:00:00Z')), undefined);
  assert.equal(preselectedCancelableVisit(undefined, selection, now), undefined);
});
