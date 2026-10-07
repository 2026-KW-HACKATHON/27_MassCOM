import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { PostgresCoinEconomyService, chooseWeightedCoin } from './postgres/coin-economy.js';

test('weighted draw obeys exact integer boundaries', () => {
  const entries = [{ id: 'first', weight: 1 }, { id: 'second', weight: 3 }];
  assert.equal(chooseWeightedCoin(entries, () => 0).id, 'first');
  for (const value of [1, 2, 3]) assert.equal(chooseWeightedCoin(entries, () => value).id, 'second');
  assert.throws(() => chooseWeightedCoin(entries, () => 4), { code: 'INVALID_REQUEST' });
});

test('malformed nested publishing inputs and missing grant actor reject before database work', async () => {
  const service = new PostgresCoinEconomyService({} as never, {
    accountLifecycle: new PostgresAccountLifecycle({ hmacSecret: 'coin-input-validation-secret-at-least-32-bytes' }),
  });
  await assert.rejects(service.publishPool({
    actorAccountId:'admin',merchantId:'merchant',eventName:'event',grade:'SILVER',price:10,
    purchaseStartsAt:'2026-10-08T00:00:00Z',purchaseEndsAt:'2026-10-09T00:00:00Z',useExpiresAt:'2026-10-10T00:00:00Z',
    perAccountLimit:1,issuanceCap:1,entries:null,
  } as never), {code:'INVALID_REQUEST'});
  await assert.rejects(service.publishSeries({
    actorAccountId:'admin',merchantId:'merchant',title:'title',endsAt:'2026-10-20T00:00:00Z',
    baseCoins:null,prismCoins:null,baseCoupon:null,prismCoupon:null,consentDocumentRef:'consent-1',
  } as never), {code:'INVALID_REQUEST'});
  await assert.rejects(service.grantTicket({
    actorAccountId:'',accountId:'customer',poolId:'9e19825b-85e0-4dad-8e67-1b58a35ea1ef',requestId:'request',
  }), {code:'INVALID_REQUEST'});
});
