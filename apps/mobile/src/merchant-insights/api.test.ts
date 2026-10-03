import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createMerchantInsightsApiClient, MerchantInsightsApiError, parseMerchantOverview, parseVisitorFeedbackSummary } from './api';
import { feedbackSections, overviewCards } from './view-model';

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
