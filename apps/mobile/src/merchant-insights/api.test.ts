import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createMerchantInsightsApiClient, MerchantInsightsApiError, parseMerchantOverview, parseVisitorFeedbackSummary } from './api';
import { feedbackSections, overviewCards, visitBars } from './view-model';

const overview = {
  generatedAt: '2026-10-03T04:00:00.000Z', businessDate: '2026-10-03', weekStartsOn: '2026-09-28',
  visits: { today: 3, thisWeek: 9, lastWeek: 6, last7Days: [{ date: '2026-10-03', count: 3 }], total: 20 },
  comparison: { lastWeekSameSpan: 5, delta: 4 }, couponsRedeemedThisWeek: 2, repeatVisitors: 4,
  campaign: null,
  readiness: { steps: [{ key: 'basic', label: '가게 기본 정보', state: 'DONE', hint: '' }], remaining: 0, message: '준비됐어요' },
};
const feedback = {
  tags: [{ code: 'SOLO', label: '혼밥하기 좋아요', count: 2 }],
  suggestions: [{ code: 'MORE_PHOTOS', label: '메뉴 사진이 더 있으면 좋겠어요', count: 1 }],
  notes: [{ customerLabel: '손님 K7QM', date: '2026-10-03', text: '좋았어요' }],
};
const credential = { kind: 'bearer', sessionToken: 'test-token' } as const;

test('authenticated overview and feedback GETs use merchant routes and validate response shapes', async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  const client = createMerchantInsightsApiClient({ apiUrl: 'https://api.example.test/', credential,
    fetcher: async (input, init) => {
      requests.push({ url: String(input), init: init! });
      return Response.json(String(input).endsWith('/overview') ? overview : feedback);
    },
  });
  assert.deepEqual(await client.getOverview('shop 1'), overview);
  assert.deepEqual(await client.getVisitorFeedback('shop 1'), feedback);
  assert.deepEqual(requests.map(({ url }) => url), [
    'https://api.example.test/merchant/merchants/shop%201/overview',
    'https://api.example.test/merchant/merchants/shop%201/visitor-feedback',
  ]);
  for (const request of requests) {
    assert.equal(new Headers(request.init.headers).get('authorization'), 'Bearer test-token');
    assert.equal(new Headers(request.init.headers).get('accept'), 'application/json');
  }
});

test('malformed overview and feedback payloads produce typed errors', () => {
  for (const value of [{}, { ...overview, visits: { ...overview.visits, today: '3' } },
    { ...overview, comparison: { lastWeekSameSpan: 5, delta: '4' } },
    { ...overview, readiness: { ...overview.readiness, steps: [{ key: 'unknown', label: '', state: 'DONE', hint: '' }] } }]) {
    assert.throws(() => parseMerchantOverview(value), (error: unknown) => error instanceof MerchantInsightsApiError && error.code === 'INVALID_RESPONSE');
  }
  for (const value of [{}, { ...feedback, tags: [{ ...feedback.tags[0], count: -1 }] },
    { ...feedback, notes: [{ ...feedback.notes[0], date: 'bad' }] }, { ...feedback, suggestions: [{ ...feedback.suggestions[0], code: 'UNKNOWN' }] }]) {
    assert.throws(() => parseVisitorFeedbackSummary(value), (error: unknown) => error instanceof MerchantInsightsApiError && error.code === 'INVALID_RESPONSE');
  }
});

test('401 and 403 stay distinct; only expired bearer sessions invoke the callback', async () => {
  let invalidations = 0;
  for (const [status, serverCode, expected] of [
    [401, 'SESSION_INVALID', 'UNAUTHORIZED'], [403, 'MERCHANT_ACCESS_DENIED', 'FORBIDDEN'],
  ] as const) {
    const client = createMerchantInsightsApiClient({ apiUrl: 'https://api.example.test', credential,
      onSessionInvalid: () => { invalidations += 1; },
      fetcher: async () => Response.json({ code: serverCode }, { status }),
    });
    await assert.rejects(client.getOverview('shop'), (error: unknown) =>
      error instanceof MerchantInsightsApiError && error.code === expected && error.status === status);
  }
  assert.equal(invalidations, 1);
});

test('network and invalid JSON failures are typed', async () => {
  const offline = createMerchantInsightsApiClient({ apiUrl: 'https://api.example.test', credential, fetcher: async () => { throw new Error('offline'); } });
  await assert.rejects(offline.getOverview('shop'), (error: unknown) => error instanceof MerchantInsightsApiError && error.code === 'NETWORK');
  const malformed = createMerchantInsightsApiClient({ apiUrl: 'https://api.example.test', credential, fetcher: async () => new Response('bad json') });
  await assert.rejects(malformed.getVisitorFeedback('shop'), (error: unknown) => error instanceof MerchantInsightsApiError && error.code === 'INVALID_RESPONSE');
});

test('view models show four cards, conditional comparison, and safe feedback text', () => {
  const cards = overviewCards(parseMerchantOverview(overview));
  assert.deepEqual(cards.map(({ label, value }) => [label, value]), [
    ['오늘 방문', '3'], ['이번 주 방문', '9'], ['재방문 고객', '4'], ['이번 주 쿠폰 사용', '2'],
  ]);
  assert.equal(cards[1]?.comparison, '지난주 같은 시간보다 +4명');
  assert.equal(overviewCards(parseMerchantOverview({ ...overview, comparison: null }))[1]?.comparison, undefined);
  assert.deepEqual(feedbackSections(parseVisitorFeedbackSummary(feedback)), {
    tags: [{ label: '혼밥하기 좋아요', count: 2 }], suggestions: [{ label: '메뉴 사진이 더 있으면 좋겠어요', count: 1 }],
    notes: [{ customerLabel: '손님 K7QM', date: '2026-10-03', text: '좋았어요' }], empty: false,
  });
  assert.equal(feedbackSections(parseVisitorFeedbackSummary({ tags: [], suggestions: [], notes: [] })).empty, true);
});

test('API-3 fields are optional, validated, and retain zero values in cards', () => {
  const current = parseMerchantOverview({ ...overview,
    weekVisitors: { first: 0, repeat: 2 },
    weekCollectibles: [{ gradeId: 'bronze', gradeName: '브론즈', count: 0 }, { gradeId: 'gold', gradeName: '골드', count: 1 }],
    weekCoupons: { issued: 0, redeemed: 1 }, weekDetailViews: 0,
  });
  assert.deepEqual(overviewCards(current).map(({ label, value }) => [label, value]), [
    ['오늘 방문', '3'], ['이번 주 방문', '9'], ['재방문 고객', '4'],
    ['이번 주 처음 확인된 방문', '0'], ['이번 주 다시 확인된 방문', '2'],
    ['이번 주 받은 수집품 · 브론즈', '0'], ['이번 주 받은 수집품 · 골드', '1'],
    ['이번 주 쿠폰 발급', '0'], ['이번 주 쿠폰 사용', '1'], ['이번 주 가게 상세 조회', '0'],
  ]);
  assert.deepEqual(overviewCards(parseMerchantOverview({ ...overview, weekCollectibles: [] })).at(-2),
    { label: '이번 주 받은 수집품', value: '0' });
  for (const patch of [
    { weekVisitors: { first: -1, repeat: 1 } },
    { weekCollectibles: [{ gradeId: 'bronze', gradeName: '브론즈', count: '1' }] },
    { weekCoupons: { issued: 0, redeemed: -1 } },
    { weekDetailViews: '0' },
  ]) assert.throws(() => parseMerchantOverview({ ...overview, ...patch }),
    (error: unknown) => error instanceof MerchantInsightsApiError && error.code === 'INVALID_RESPONSE');
});

test('seven-day visit bars preserve daily counts and expose a readable summary', () => {
  const model = visitBars(parseMerchantOverview({ ...overview, visits: { ...overview.visits, last7Days: [
    { date: '2026-10-01', count: 0 }, { date: '2026-10-02', count: 2 }, { date: '2026-10-03', count: 4 },
  ] } }));
  assert.equal(model.summary, '최근 7일 방문: 10월 1일 0회, 10월 2일 2회, 10월 3일 4회');
  assert.deepEqual(model.days.map(({ heightPercent }) => heightPercent), [0, 50, 100]);
  assert.equal(visitBars(parseMerchantOverview({ ...overview, visits: { ...overview.visits, last7Days: [{ date: '2026-10-03', count: 0 }] } })).days[0]?.heightPercent, 0);
});
