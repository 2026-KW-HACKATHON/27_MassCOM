import assert from 'node:assert/strict';
import { test } from 'node:test';
import { consumeMerchantNotificationRole, consumeNotificationTarget, queueMerchantNotificationRole, queueNotificationTarget, subscribeMerchantNotificationRole, subscribeNotificationTarget } from './pending-target';

test('notification target waits for navigation and never crosses accounts', () => {
  let changed = 0;
  const unsubscribe = subscribeNotificationTarget(() => { changed++; });
  queueNotificationTarget('first', '/collection');
  assert.equal(changed, 1);
  assert.equal(consumeNotificationTarget('second'), undefined);
  queueNotificationTarget('second', '/notifications');
  assert.equal(consumeNotificationTarget('second'), '/notifications');
  assert.equal(consumeNotificationTarget('second'), undefined);
  unsubscribe();
});

test('merchant notification role request is account scoped and consumed once', () => {
  let changed = 0;
  const unsubscribe = subscribeMerchantNotificationRole(() => { changed++; });
  queueMerchantNotificationRole('owner');
  assert.equal(changed, 1);
  assert.equal(consumeMerchantNotificationRole('other'), false);
  queueMerchantNotificationRole('owner');
  assert.equal(consumeMerchantNotificationRole('owner'), true);
  assert.equal(consumeMerchantNotificationRole('owner'), false);
  unsubscribe();
});
