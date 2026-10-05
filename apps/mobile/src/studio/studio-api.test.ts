import assert from 'node:assert/strict';
import test from 'node:test';

import { createStudioApiClient, parseFriendStudioSnapshot, parseStudioSnapshot, studioErrorMessage, StudioApiError } from './studio-api';

const studio = { theme: 'daylight', layout: 'shelf', accent: 'mint', slots: ['owned-1'], goal: { kind: 'discover', merchantId: 'shop-1' } };
const item = { entitlementId: 'owned-1', merchantId: 'shop-1', merchantName: '가게', campaignTitle: '방문', displayName: '첫 그림' };

test('self studio keeps only selected entitlement identity and chosen display', () => {
  const parsed = parseStudioSnapshot({ studio, items: [item], avatar: 'cook-cat', records: [], unlockedThemes: ['daylight'] });
  assert.deepEqual(parsed.studio.slots, ['owned-1']);
  assert.equal(parsed.items[0].entitlementId, 'owned-1');
  assert.equal(parsed.avatar, 'cook-cat');
});

test('friend studio drops accidental entitlement IDs even if present in response', () => {
  const parsed = parseFriendStudioSnapshot({ nickname: '친구', studio, items: [item], avatar: null });
  assert.equal('slots' in parsed.studio, false);
  assert.equal('entitlementId' in parsed.items[0], false);
});

test('studio rejects duplicate or excessive owned slots', () => {
  assert.throws(() => parseStudioSnapshot({ studio: { ...studio, slots: ['owned-1', 'owned-1'] }, items: [], avatar: null, records: [], unlockedThemes: ['daylight'] }));
  assert.throws(() => parseStudioSnapshot({ studio: { ...studio, slots: Array.from({ length: 7 }, (_, index) => `${index}`) }, items: [], avatar: null, records: [], unlockedThemes: ['daylight'] }));
});

test('studio retains 403 CONSENT_REQUIRED on own and friend reads and explains re-consent in Korean', async () => {
  const api = createStudioApiClient({ apiUrl: 'https://api.test',
    credential: { kind: 'bearer', sessionToken: 'test-session' },
    fetcher: async () => Response.json({ code: 'CONSENT_REQUIRED' }, { status: 403 }) });
  for (const read of [() => api.getMine(), () => api.getFriend('friend-1')]) {
    await assert.rejects(read, (error) => error instanceof StudioApiError
      && error.status === 403 && error.code === 'CONSENT_REQUIRED'
      && studioErrorMessage(error) === '개인정보 처리방침이 바뀌어 다시 동의가 필요해요.');
  }
});


test('studio keeps version two records separate and rejects malformed counts', () => {
  const payload = { studio, items: [item], avatar: null, records: [{ kind: 'stack', bestScore: 999, plays: 12, version2BestScore: 20, version2Plays: 1 }], unlockedThemes: ['daylight'] };
  assert.deepEqual(parseStudioSnapshot(payload).records, payload.records);
  assert.throws(() => parseStudioSnapshot({ ...payload, records: [{ ...payload.records[0], version2Plays: -1 }] }));
  for (const version2BestScore of [Infinity, -1, .5, Number.MAX_SAFE_INTEGER + 1, null]) {
    assert.throws(() => parseStudioSnapshot({ ...payload, records: [{ ...payload.records[0], version2BestScore }] }));
  }
  assert.throws(() => parseStudioSnapshot({ ...payload, records: [{ ...payload.records[0], version2Plays: 13 }] }));
  assert.throws(() => parseStudioSnapshot({ ...payload, records: [{ kind: 'stack', bestScore: 0, plays: 0, version2BestScore: 0 }] }));
});
