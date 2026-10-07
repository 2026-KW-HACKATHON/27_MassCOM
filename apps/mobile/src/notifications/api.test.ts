import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';

import { NotificationApiClient } from './api';

const credential = { kind: 'bearer' as const, sessionToken: 'expired' };
afterEach(() => mock.restoreAll());

test('notification endpoints invalidate a rejected bearer session', async () => {
  let invalidations = 0;
  mock.method(globalThis, 'fetch', async () => Response.json({ code: 'SESSION_INVALID' }, { status: 401 }));
  const client = new NotificationApiClient('https://example.test', credential, () => { invalidations += 1; });
  for (const request of [
    () => client.list(),
    () => client.preferences(),
    () => client.updatePreferences({ pushEnabled: false }),
    () => client.markRead('notice-1'),
    () => client.registerDevice('device-1', 'token'),
    () => client.unregisterDevice('device-1'),
  ]) await assert.rejects(request());
  assert.equal(invalidations, 6);
});

test('other notification failures do not invalidate the session', async () => {
  let invalidations = 0;
  mock.method(globalThis, 'fetch', async () => Response.json({ code: 'OTHER' }, { status: 401 }));
  const client = new NotificationApiClient('https://example.test', credential, () => { invalidations += 1; });
  await assert.rejects(client.list());
  assert.equal(invalidations, 0);
});
