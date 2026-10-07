import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createExperienceApiClient, parseDisplayExperienceProfile, parseExperienceSnapshot } from './experience-api';

const profile = { badgeId: 'explorer-bronze', cosmetics: { hat: null, bag: null, prop: null, pose: null, decor: null }, coinEntitlementId: null, wishlist: null };
const snapshot = { catalog: { badges: [], cosmetics: [], packs: [] }, profile, progress: { badges: [], cosmetics: [], packs: [] } };

test('equipment updates use account credentials and server response', async () => {
  const calls: { path: string; method: string; body: unknown; token: string | null }[] = [];
  const api = createExperienceApiClient({ apiUrl: 'https://api.example.test/',
    credential: { kind: 'bearer', sessionToken: 'session' },
    fetcher: async (input, init) => {
      calls.push({ path: String(input), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null,
        token: new Headers(init?.headers).get('Authorization') });
      return Response.json(snapshot);
    },
  });
  assert.equal((await api.get()).profile.badgeId, 'explorer-bronze');
  await api.equip({ cosmetics: { hat: 'cafe-hat' } });
  assert.deepEqual(calls.map(({ path, method, body }) => ({ path, method, body })), [
    { path: 'https://api.example.test/me/experience', method: 'GET', body: null },
    { path: 'https://api.example.test/me/experience/equipment', method: 'PATCH', body: { cosmetics: { hat: 'cafe-hat' } } },
  ]);
  assert.ok(calls.every(({ token }) => token === 'Bearer session'));
});

test('friend display accepts only public coin information', () => {
  const friend = parseDisplayExperienceProfile({ badgeId: 'explorer-bronze', badgeName: '동네 탐험',
    cosmetics: profile.cosmetics, coin: { merchantId: 'm1', merchantName: '가게', campaignTitle: '방문', displayName: '가게 코인' } });
  assert.equal(friend.coin?.displayName, '가게 코인');
  assert.equal('coinEntitlementId' in friend, false);
});

test('equipment sends a representative source while preserving the legacy visit field', async () => {
  const source = { sourceKind: 'STORE_DRAW' as const, sourceId: 'ticket-1' };
  const bodies: unknown[] = [];
  const api = createExperienceApiClient({ apiUrl: 'https://api.example.test',
    credential: { kind: 'bearer', sessionToken: 'session' },
    fetcher: async (_input, init) => { if (init?.body) bodies.push(JSON.parse(String(init.body)));
      return Response.json({ ...snapshot, profile: { ...profile, coinSource: source, coinEntitlementId: null } }); },
  });
  assert.deepEqual((await api.equip({ coinSource: source })).profile.coinSource, source);
  assert.deepEqual(bodies, [{ coinSource: source }]);
  assert.equal(parseExperienceSnapshot({ ...snapshot, profile: { ...profile, coinEntitlementId: 'visit-1', coinSource: {
    sourceKind: 'VISIT', sourceId: 'visit-1' }, representativeCoin: null } }).profile.coinEntitlementId, 'visit-1');
  assert.throws(() => parseExperienceSnapshot({ ...snapshot, profile: { ...profile, coinSource: {
    sourceKind: 'STORE_DRAW', sourceId: '' } } }), /INVALID_EXPERIENCE/);
});
