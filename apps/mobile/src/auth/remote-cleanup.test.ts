import assert from 'node:assert/strict';
import { test } from 'node:test';

import { waitForRemoteCleanup } from './remote-cleanup';

test('stalled and rejected remote cleanup cannot block local session cleanup', async () => {
  let localCleared = false;
  await waitForRemoteCleanup(() => new Promise(() => undefined), 5);
  localCleared = true;
  assert.equal(localCleared, true);
  await assert.doesNotReject(waitForRemoteCleanup(() => Promise.reject(new Error('network')), 5));
});
