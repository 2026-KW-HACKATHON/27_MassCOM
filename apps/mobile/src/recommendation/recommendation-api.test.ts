import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRecommendationApiClient, RecommendationApiError } from './recommendation-api';

const payload = {
  recommendations: [
    {
      merchantId: 'merchant-new',
      merchantName: '새 가게',
      roadAddress: '서울 노원구 새길 1',
      campaignId: 'campaign-new',
      campaignTitle: '새 가게 도감',
      enrollmentStatus: 'OPEN',
      progressVisitCount: 0,
      demo: true,
      reasonCode: 'NEW_PLACE',
      reasonText: '아직 방문하지 않은 동네 가게예요.',
      nextGoal: {
        targetVisitCount: 1,
        displayName: '첫 잎새',
        remainingVisits: 1,
      },
    },
  ],
};

test('loads authenticated recommendations with explanation fields', async () => {
  const client = createRecommendationApiClient({
    apiUrl: 'https://api.example.test',
    accountId: 'customer-1',
    fetcher: async (input, init) => {
      assert.equal(input, 'https://api.example.test/recommendations');
      assert.equal(new Headers(init?.headers).get('x-account-id'), 'customer-1');
      return Response.json(payload);
    },
  });

  assert.deepEqual(await client.listRecommendations(), payload.recommendations);
});

test('rejects unknown reason codes instead of rendering an unexplained recommendation', async () => {
  const client = createRecommendationApiClient({
    apiUrl: 'https://api.example.test',
    accountId: 'customer-1',
    fetcher: async () => Response.json({
      recommendations: [{ ...payload.recommendations[0], reasonCode: 'BECAUSE_AI_SAID_SO' }],
    }),
  });

  await assert.rejects(client.listRecommendations(), /추천 응답 형식/);
});

test('preserves HTTP failure status for recovery UI', async () => {
  const client = createRecommendationApiClient({
    apiUrl: 'https://api.example.test',
    accountId: 'customer-1',
    fetcher: async () => Response.json({ code: 'ACCOUNT_AUTH_NOT_CONFIGURED' }, { status: 503 }),
  });

  await assert.rejects(client.listRecommendations(), (error: unknown) => {
    assert.ok(error instanceof RecommendationApiError);
    assert.equal(error.status, 503);
    assert.equal(error.code, 'ACCOUNT_AUTH_NOT_CONFIGURED');
    return true;
  });
});
