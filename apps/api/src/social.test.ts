import assert from 'node:assert/strict';
import { test } from 'node:test';

import { startNotificationsRunner, type SocialService } from './social.js';
import {
  buildGenericPushPayload,
  computeReward,
  compareHHmm,
  kstBusinessDate,
  parseMealInvitation,
  parseMealResponse,
  parseMessageBody,
  validateRequestId,
} from './social-rules.js';

test('KST business date flips at Korean midnight', () => {
  assert.equal(kstBusinessDate(new Date('2026-10-04T14:59:59.999Z')), '2026-10-04');
  assert.equal(kstBusinessDate(new Date('2026-10-04T15:00:00.000Z')), '2026-10-05');
  assert.equal(kstBusinessDate(new Date('2026-10-04T23:30:00.000Z')), '2026-10-05');
});

test('request IDs and message bodies reject empty, invisible, and overlong input', () => {
  assert.equal(validateRequestId(' req-1 '), 'req-1');
  assert.equal(validateRequestId(''), null);
  assert.equal(validateRequestId('x'.repeat(129)), null);
  assert.equal(validateRequestId(1), null);

  assert.equal(parseMessageBody('  안녕  '), '안녕');
  assert.equal(parseMessageBody(''), null);
  assert.equal(parseMessageBody('\u3164\u3164'), null);
  assert.equal(parseMessageBody('x'.repeat(500)), 'x'.repeat(500));
  assert.equal(parseMessageBody('x'.repeat(501)), null);
});

test('friendship reward is capped to 25 daily FRIENDSHIP mileage', () => {
  assert.equal(computeReward(0), 5);
  assert.equal(computeReward(20), 5);
  assert.equal(computeReward(24), 1);
  assert.equal(computeReward(25), 0);
  assert.equal(computeReward(30), 0);
});

test('meal invitation validation accepts confirmed or ordered range only', () => {
  const now = new Date('2026-10-04T15:00:00.000Z');
  assert.deepEqual(parseMealInvitation({
    merchantId: 'shop-a', date: '2026-10-05', kind: 'CONFIRMED', time: '12:40',
  }, now), {
    merchantId: 'shop-a', date: '2026-10-05', schedule: { kind: 'CONFIRMED', time: '12:40' },
  });
  assert.deepEqual(parseMealInvitation({
    merchantId: 'shop-a', date: '2026-10-05', kind: 'RANGE', startTime: '12:00', endTime: '14:00',
  }, now), {
    merchantId: 'shop-a', date: '2026-10-05', schedule: { kind: 'RANGE', startTime: '12:00', endTime: '14:00' },
  });
  assert.equal(parseMealInvitation({ merchantId: '', date: '2026-10-05', kind: 'CONFIRMED', time: '12:40' }, now), null);
  assert.equal(parseMealInvitation({ merchantId: 'shop-a', date: '2026-10-04', kind: 'CONFIRMED', time: '12:40' }, now), null);
  assert.equal(parseMealInvitation({ merchantId: 'shop-a', date: '2026-10-05', kind: 'CONFIRMED', time: '24:00' }, now), null);
  assert.equal(parseMealInvitation({ merchantId: 'shop-a', date: '2026-10-05', kind: 'RANGE', startTime: '14:00', endTime: '12:00' }, now), null);
  assert.equal(compareHHmm('12:00', '14:00') < 0, true);
});

test('meal response validation requires selected time for ranges and keeps it inside the range', () => {
  const range = { merchantId: 'shop-a', date: '2026-10-05', schedule: { kind: 'RANGE' as const, startTime: '12:00', endTime: '14:00' } };
  assert.deepEqual(parseMealResponse({ decision: 'ACCEPT', selectedTime: '12:40' }, range), {
    kind: 'ACCEPT', selectedTime: '12:40',
  });
  assert.equal(parseMealResponse({ decision: 'ACCEPT' }, range), null);
  assert.equal(parseMealResponse({ decision: 'ACCEPT', selectedTime: '11:59' }, range), null);
  assert.equal(parseMealResponse({ decision: 'ACCEPT', selectedTime: '14:01' }, range), null);
  assert.deepEqual(parseMealResponse({ decision: 'DECLINE', selectedTime: '10:00' }, range), {
    kind: 'DECLINE', selectedTime: null,
  });

  const confirmed = { merchantId: 'shop-a', date: '2026-10-05', schedule: { kind: 'CONFIRMED' as const, time: '12:40' } };
  assert.deepEqual(parseMealResponse({ decision: 'ACCEPT' }, confirmed), { kind: 'ACCEPT', selectedTime: '12:40' });
  assert.equal(parseMealResponse({ decision: 'ACCEPT', selectedTime: '13:00' }, confirmed), null);
});

test('generic push payload contains only notification routing data', () => {
  assert.deepEqual(buildGenericPushPayload({ mailId: 'mail-1', type: 'MEAL_RESPONSE' }), {
    title: '새 우편이 도착했어요',
    body: '친구 소식이 있어요',
    data: { mailId: 'mail-1', type: 'MEAL_RESPONSE' },
  });
});

test('notification runner boots immediately, serializes work, and drains on stop', async () => {
  const calls: string[] = [];
  const service = {
    async flushNotifications() {
      calls.push('flush');
      return { claimed: 0, sent: 0, retry: 0, dead: 0, skipped: 0 };
    },
    async reconcileReceipts() {
      calls.push('receipts');
      return { checked: 0, delivered: 0, retry: 0, dead: 0 };
    },
  } satisfies Pick<SocialService, 'flushNotifications' | 'reconcileReceipts'>;
  let callback: (() => void) | undefined;
  let cleared = false;
  const runner = startNotificationsRunner(service, {
    intervalMs: 1000,
    setIntervalFn: ((fn: () => void) => {
      callback = fn;
      return 1 as unknown as NodeJS.Timeout;
    }) as typeof setInterval,
    clearIntervalFn: (() => {
      cleared = true;
    }) as typeof clearInterval,
  });
  await runner.drain();
  assert.deepEqual(calls, ['flush', 'receipts']);
  callback!();
  await runner.stop();
  assert.equal(cleared, true);
  assert.deepEqual(calls, ['flush', 'receipts', 'flush', 'receipts']);
  callback!();
  await runner.drain();
  assert.deepEqual(calls, ['flush', 'receipts', 'flush', 'receipts']);
});

test('notification runner recovers after one failure and coalesces overlapping ticks', async () => {
  const calls: string[] = [];
  let releaseFlush: (() => void) | undefined;
  let first = true;
  const errors: unknown[] = [];
  const service = {
    async flushNotifications() {
      calls.push('flush');
      if (first) {
        first = false;
        throw new Error('temporary database failure');
      }
      await new Promise<void>((resolve) => {
        releaseFlush = resolve;
      });
      return { claimed: 0, sent: 0, retry: 0, dead: 0, skipped: 0 };
    },
    async reconcileReceipts() {
      calls.push('receipts');
      return { checked: 0, delivered: 0, retry: 0, dead: 0 };
    },
  } satisfies Pick<SocialService, 'flushNotifications' | 'reconcileReceipts'>;
  let callback: (() => void) | undefined;
  const runner = startNotificationsRunner(service, {
    intervalMs: 1000,
    onError: (error) => errors.push(error),
    setIntervalFn: ((fn: () => void) => {
      callback = fn;
      return 1 as unknown as NodeJS.Timeout;
    }) as typeof setInterval,
    clearIntervalFn: (() => undefined) as typeof clearInterval,
  });

  await runner.drain();
  assert.equal(errors.length, 1);
  assert.deepEqual(calls, ['flush']);

  callback!();
  callback!();
  callback!();
  await Promise.resolve();
  assert.deepEqual(calls, ['flush', 'flush']);
  releaseFlush!();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['flush', 'flush', 'receipts', 'flush']);
  releaseFlush!();
  await runner.stop();
  assert.deepEqual(calls, ['flush', 'flush', 'receipts', 'flush', 'receipts']);

  callback!();
  await runner.drain();
  assert.deepEqual(calls, ['flush', 'flush', 'receipts', 'flush', 'receipts']);
});
