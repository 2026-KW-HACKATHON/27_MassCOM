import assert from 'node:assert/strict';
import test from 'node:test';
import type { CampaignSummary, MerchantSummary } from '../../../api/src/real-world-contract';
import { merchantCardFacts, missingFactsNotice, unlocatedNotice } from './merchant-card-facts';

const business = { state: 'OPEN', basis: 'SCHEDULE', evaluatedAt: '2026-10-06T03:00:00Z', nextChangeAt: null, informationUpdatedAt: null, acceptingOrders: true, lastOrderAt: null } as const;
const campaign: CampaignSummary = { id: 'c', title: '캠페인', startsAt: '2026-10-01T00:00:00Z', endsAt: '2026-11-01T00:00:00Z', state: 'ACTIVE', enrollment: 'OPEN', rewardAvailability: 'AVAILABLE', goals: [] };
const base: MerchantSummary = {
  id: 'm', name: '가게', roadAddress: '도로', category: null, demo: false, profileVersion: 1, position: { latitude: 37.6, longitude: 127 }, positionBasis: 'OWNED',
  positionExpiresAt: null, floor: '2층', entranceNote: '골목 안쪽', thumbnail: null, business, campaign, distance: { meters: 123.6, kind: 'STRAIGHT_LINE', origin: 'MANUAL' },
};
const critical = (facts: ReturnType<typeof merchantCardFacts>) => Object.fromEntries(facts.critical.map((fact) => [fact.key, fact]));

test('a fully known open store has normal-tone critical facts and no gaps except the photo', () => {
  const facts = merchantCardFacts(base);
  assert.deepEqual(facts.core.map((fact) => fact.key), ['floor', 'entrance', 'distance']);
  assert.equal(facts.core[2]!.value, '124m 직선거리 · 선택한 출발지');
  assert.deepEqual(facts.critical.map((fact) => fact.key), ['business', 'lastOrder', 'reward']);
  assert.ok(facts.critical.every((fact) => fact.tone === 'normal' || fact.key === 'lastOrder'));
  assert.deepEqual(facts.missing.map((fact) => fact.key), ['photo']);
});

test('unknown business state and a stopped reward stay visible in warning tone; a missing last-order time is only a plain note', () => {
  const unknown = critical(merchantCardFacts({ ...base, business: { ...business, state: 'UNKNOWN', basis: 'UNKNOWN', acceptingOrders: null }, campaign: { ...campaign, rewardAvailability: 'UNKNOWN' } }));
  assert.deepEqual([unknown.business!.value, unknown.business!.tone, unknown.business!.known], ['영업 상태 미확인', 'warning', false]);
  assert.equal(unknown.lastOrder, undefined, 'an unknown state already says so once; no second 미확인 line');
  assert.deepEqual([unknown.reward!.tone, unknown.reward!.known], ['warning', false]);

  const openNoLastOrder = critical(merchantCardFacts(base));
  assert.deepEqual([openNoLastOrder.lastOrder!.text, openNoLastOrder.lastOrder!.tone, openNoLastOrder.lastOrder!.known], ['마지막 주문 정보 없음', 'normal', false]);

  const exhausted = critical(merchantCardFacts({ ...base, campaign: { ...campaign, rewardAvailability: 'EXHAUSTED' } }));
  assert.equal(exhausted.reward!.tone, 'warning');
  assert.equal(critical(merchantCardFacts({ ...base, campaign: null })).reward!.value, '진행 중인 캠페인 없음');
});

test('last order is shown in Korean time; it warns only once ordering stopped or within 30 minutes of the server\'s evaluation time', () => {
  const open = critical(merchantCardFacts({ ...base, business: { ...business, lastOrderAt: '2026-10-06T11:00:00Z' } }));
  assert.deepEqual([open.lastOrder!.value, open.lastOrder!.tone], ['20:00', 'normal']);
  const soon = critical(merchantCardFacts({ ...base, business: { ...business, evaluatedAt: '2026-10-06T10:31:00Z', lastOrderAt: '2026-10-06T11:00:00Z' } }));
  assert.deepEqual([soon.lastOrder!.text, soon.lastOrder!.tone], ['마지막 주문 20:00 (곧 마감)', 'warning']);
  const edge = critical(merchantCardFacts({ ...base, business: { ...business, evaluatedAt: '2026-10-06T10:30:00Z', lastOrderAt: '2026-10-06T11:00:00Z' } }));
  assert.equal(edge.lastOrder!.tone, 'warning', 'exactly 30 minutes still counts');
  const later = critical(merchantCardFacts({ ...base, business: { ...business, evaluatedAt: '2026-10-06T10:29:00Z', lastOrderAt: '2026-10-06T11:00:00Z' } }));
  assert.equal(later.lastOrder!.tone, 'normal');
  const passedButStillOrdering = critical(merchantCardFacts({ ...base, business: { ...business, evaluatedAt: '2026-10-06T11:05:00Z', lastOrderAt: '2026-10-06T11:00:00Z' } }));
  assert.equal(passedButStillOrdering.lastOrder!.tone, 'normal', 'only acceptingOrders === false means ordering stopped');
  const past = critical(merchantCardFacts({ ...base, business: { ...business, acceptingOrders: false, lastOrderAt: '2026-10-06T11:00:00Z' } }));
  assert.deepEqual([past.lastOrder!.value, past.lastOrder!.tone, past.business!.tone], ['주문 마감 (마지막 주문 20:00)', 'warning', 'warning']);
});

test('a temporary closure from the owner replaces the last-order line and warns', () => {
  const todayOverride = { state: 'CLOSED', startsAt: '2026-10-06T00:00:00Z', expiresAt: '2026-10-07T00:00:00Z', note: '재료 소진' } as const;
  const closure = critical(merchantCardFacts({ ...base, todayOverride, business: { ...business, state: 'CLOSED', basis: 'OWNER_OVERRIDE' } }));
  assert.deepEqual([closure.lastOrder!.label, closure.lastOrder!.value, closure.lastOrder!.tone], ['임시 안내', '임시 휴업 · 재료 소진', 'warning']);
});

test('minimum spend is critical on the detail only: the list payload does not carry it, and a hint on every campaign card would only repeat noise, so cards show none by design', () => {
  assert.equal(critical(merchantCardFacts(base)).minimumSpend, undefined);
  assert.equal(critical(merchantCardFacts({ ...base, minimumSpendWon: 12000 })).minimumSpend!.value, '12,000원');
  assert.equal(critical(merchantCardFacts({ ...base, minimumSpendWon: 0 })).minimumSpend!.value, '정해진 금액 없음');
});

test('everything else that is unknown is grouped as missing, never as a critical fact', () => {
  const sparse = merchantCardFacts({ ...base, position: null, floor: null, entranceNote: null, schedule: null, photos: [] });
  assert.deepEqual(sparse.missing.map((fact) => fact.key), ['position', 'entrance', 'floor', 'photo', 'schedule']);
  assert.deepEqual(sparse.core.map((fact) => fact.key), ['distance']);
  assert.ok(sparse.critical.every((fact) => !['position', 'entrance', 'floor', 'photo', 'schedule'].includes(fact.key)));
  // A schedule that was never requested (list payload) is not reported as missing.
  assert.ok(!merchantCardFacts(base).missing.some((fact) => fact.key === 'schedule'));
});

test('an entrance photo counts as a known entrance', () => {
  const photo = { id: 'p', url: '/p', width: 1, height: 1, kind: 'ENTRANCE', source: 'OWNER_PHOTO', caption: null, updatedAt: '2026-10-01T00:00:00Z' } as const;
  const facts = merchantCardFacts({ ...base, entranceNote: null, thumbnail: photo });
  assert.ok(!facts.missing.some((fact) => fact.key === 'entrance' || fact.key === 'photo'));
});

test('the list notice is one sentence driven by the unlocated count; the detail notice names what is missing', () => {
  assert.equal(unlocatedNotice(0), null);
  assert.match(unlocatedNotice(3)!, /^일부 가게는 위치·입구 정보가 아직 없어요\. 3곳은 지도에 표시되지 않으니/);
  assert.equal(missingFactsNotice([]), null);
  assert.equal(missingFactsNotice([{ key: 'floor', label: '층·호수' }, { key: 'photo', label: '사진' }]), '아직 확인되지 않았어요: 층·호수, 사진.');
  assert.match(missingFactsNotice([{ key: 'position', label: '위치' }])!, /지도에는 표시하지 않아요/);
});
