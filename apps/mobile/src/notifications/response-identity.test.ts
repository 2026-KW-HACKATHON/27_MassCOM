import assert from 'node:assert/strict';
import test from 'node:test';

import { clearLastNotificationResponseIfCurrent, notificationResponseIdentity } from './response-identity';

const mailId = '11111111-1111-4111-8111-111111111111';

type ResponseShape = { actionIdentifier?: string; notification: { request: { identifier?: string; content: { data?: Record<string, unknown> } } } };

function response(data: Record<string, unknown>, identifier?: string, actionIdentifier?: string): ResponseShape {
  return { actionIdentifier, notification: { request: { identifier, content: { data } } } };
}

function nativeSlot(initial: unknown, options: { throwOnRead?: boolean; throwOnClear?: boolean } = {}) {
  let current = initial;
  let clearCount = 0;
  return {
    get current() { return current; },
    get clearCount() { return clearCount; },
    module: {
      getLastNotificationResponse() {
        if (options.throwOnRead) throw new Error('native read failed');
        return current;
      },
      clearLastNotificationResponse() {
        if (options.throwOnClear) throw new Error('native clear failed');
        clearCount += 1;
        current = null;
      },
    },
  };
}

test('clears only when the current native response has the same domain, payload, request and action identity', () => {
  const original = response({ mailId }, 'request-a', 'tap');
  const expected = notificationResponseIdentity(original, 'social');
  assert.ok(expected);
  const slot = nativeSlot(response({ mailId }, 'request-a', 'tap'));

  assert.equal(clearLastNotificationResponseIfCurrent(slot.module, expected), true);
  assert.equal(slot.clearCount, 1);
  assert.equal(slot.current, null);
});

test('preserves a response with the same payload but a different request or action identity', () => {
  const expected = notificationResponseIdentity(response({ notificationId: 'notice-1' }, 'request-a', 'tap'), 'notification');
  assert.ok(expected);
  const changedRequest = nativeSlot(response({ notificationId: 'notice-1' }, 'request-b', 'tap'));
  const changedAction = nativeSlot(response({ notificationId: 'notice-1' }, 'request-a', 'dismiss'));

  assert.equal(clearLastNotificationResponseIfCurrent(changedRequest.module, expected), false);
  assert.notEqual(changedRequest.current, null);
  assert.equal(clearLastNotificationResponseIfCurrent(changedAction.module, expected), false);
  assert.notEqual(changedAction.current, null);
});



test('preserves a response when colon-containing request and action identities would collide under string concatenation', () => {
  const expected = notificationResponseIdentity(response({ notificationId: 'notice-1' }, 'request:a', 'tap'), 'notification');
  assert.ok(expected);
  const collision = nativeSlot(response({ notificationId: 'notice-1' }, 'request', 'a:tap'));

  assert.equal(clearLastNotificationResponseIfCurrent(collision.module, expected), false);
  assert.notEqual(collision.current, null);
});

test('falls back to validated domain payload identity when native request id is absent', () => {
  const expected = notificationResponseIdentity(response({ mailId }), 'social');
  assert.deepEqual(expected, { domain: 'social', payloadId: mailId, requestIdentifier: mailId, actionIdentifier: '' });
  assert.ok(expected);
  const slot = nativeSlot(response({ mailId }));

  assert.equal(clearLastNotificationResponseIfCurrent(slot.module, expected), true);
  assert.equal(slot.clearCount, 1);
});

test('preserves null, wrong-domain, unavailable sync API, read failure and clear failure', () => {
  const expected = notificationResponseIdentity(response({ mailId }, 'mail-request'), 'social');
  assert.ok(expected);
  assert.equal(clearLastNotificationResponseIfCurrent({}, expected), false);
  assert.equal(clearLastNotificationResponseIfCurrent(nativeSlot(null).module, expected), false);
  assert.equal(clearLastNotificationResponseIfCurrent(nativeSlot(response({ notificationId: 'notice-1' }, 'mail-request')).module, expected), false);
  assert.equal(clearLastNotificationResponseIfCurrent(nativeSlot(response({ mailId }, 'mail-request'), { throwOnRead: true }).module, expected), false);
  const clearFailure = nativeSlot(response({ mailId }, 'mail-request'), { throwOnClear: true });
  assert.equal(clearLastNotificationResponseIfCurrent(clearFailure.module, expected), false);
  assert.notEqual(clearFailure.current, null);
});

test('rejects malformed or cross-domain payloads before they can authorize a clear', () => {
  assert.equal(notificationResponseIdentity(response({ mailId: 'not-a-uuid' }, 'bad'), 'social'), null);
  assert.equal(notificationResponseIdentity(response({ notificationId: '' }, 'bad'), 'notification'), null);
  assert.equal(notificationResponseIdentity(response({ notificationId: 'notice-1' }, 'notice'), 'social'), null);
  assert.equal(notificationResponseIdentity(response({ mailId }, 'mail'), 'notification'), null);
});
