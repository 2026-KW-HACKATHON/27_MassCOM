import assert from 'node:assert/strict';
import test from 'node:test';

import { parseFriendStudioSnapshot, parseStudioSnapshot } from './studio-api';

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
