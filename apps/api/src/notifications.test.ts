import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NotificationError, validateNotification } from './notifications.js';
import { fcmConfigFromEnv, fcmRetryAfter } from './postgres/notifications.js';
import { startNotificationScheduler } from './notification-scheduler.js';

const valid = { accountId: 'account-1', category: 'REWARD_AVAILABLE' as const, dedupeKey: 'reward:1', title: 'Reward', body: 'Open reward', targetPath: '/collection' };

test('notification targets are restricted to app destinations', () => {
  validateNotification(valid);
  validateNotification({ ...valid, targetPath: '/collection?focus=collectible&entitlement=12345678-1234-1234-1234-123456789abc' });
  for (const targetPath of ['https://evil.example', '//evil.example', '/merchant/../../admin', '/settings', '/merchants/a/b', '/collection?focus=rewards&coupon=other', '/collection?url=https://evil.example']) {
    assert.throws(() => validateNotification({ ...valid, targetPath }), (error: unknown) => error instanceof NotificationError && error.code === 'INVALID_NOTIFICATION');
  }
});

test('FCM stays disabled without complete credentials and rejects invalid project identifiers', () => {
  assert.equal(fcmConfigFromEnv({ FCM_PROJECT_ID: 'project' }), undefined);
  assert.throws(() => fcmConfigFromEnv({ FCM_PROJECT_ID: '../other', FCM_CLIENT_EMAIL: 'a@b', FCM_PRIVATE_KEY: 'key' }));
});

test('FCM Retry-After honors seconds and HTTP dates without unbounded delay', () => {
  const now = new Date('2026-10-05T00:00:00Z');
  assert.equal(fcmRetryAfter('120', now)?.toISOString(), '2026-10-05T00:02:00.000Z');
  assert.equal(fcmRetryAfter('Mon, 05 Oct 2026 00:03:00 GMT', now)?.toISOString(), '2026-10-05T00:03:00.000Z');
  assert.equal(fcmRetryAfter('NaN', now), undefined);
});

test('scheduler prevents overlapping scans and stops cleanly', async () => {
  let scans = 0;
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const stop = startNotificationScheduler({ async enqueueDueReminders() { scans++; await pending; return 0; }, async deliverDue() { return { sent: 0, failed: 0, skipped: 0 }; }, async pruneExpired() {} }, { intervalMs: 1_000 });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(scans, 1);
  stop(); finish();
});
