import assert from 'node:assert/strict';
import { test } from 'node:test';
import { notificationTarget } from './navigation';

test('notification press accepts only known local destinations', () => {
  assert.equal(notificationTarget('/collection'), '/collection');
  assert.equal(notificationTarget('/merchants/shop-1'), '/merchants/shop-1');
  const id = '12345678-1234-1234-1234-123456789abc';
  assert.equal(notificationTarget(`/collection?focus=collectible&entitlement=${id}`), `/collection?focus=collectible&entitlement=${id}`);
  assert.equal(notificationTarget(`/collection?focus=rewards&coupon=${id}`), `/collection?focus=rewards&coupon=${id}`);
  for (const target of ['https://evil.example', '//evil.example', '/merchant/../admin', '/merchants/a/b', '/collection?focus=rewards&coupon=other', '/collection?focus=rewards&coupon=123&url=https://evil.example', undefined]) {
    assert.equal(notificationTarget(target), undefined);
  }
});
