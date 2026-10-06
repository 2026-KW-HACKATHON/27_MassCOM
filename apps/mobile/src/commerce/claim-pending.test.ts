import assert from 'node:assert/strict';
import { test } from 'node:test';

import { clearClaimPendingIntent, createClaimPendingStore, isTerminalPendingClaimCode } from './claim-pending';
import { createCommerceApiClient } from './commerce-api';

function memoryStorage() {
  const values = new Map<string, string>();
  return { values, surface: {
    getItemAsync: async (key: string) => values.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => { values.set(key, value); },
    deleteItemAsync: async (key: string) => { values.delete(key); },
  } };
}

test('pending claim survives relaunch only for the same account and merchant, then expires', async () => {
  const { values, surface: storage } = memoryStorage();
  const now = Date.parse('2026-10-06T00:00:00Z');
  const pending = { accountId: 'staff-a', merchantId: 'shop-a', token: 'identity-token', expiresAt: new Date(now + 60_000).toISOString() };
  await createClaimPendingStore(storage, () => now).save(pending);
  assert.deepEqual(await createClaimPendingStore(storage, () => now).load('staff-a', 'shop-a'), pending);
  assert.equal(await createClaimPendingStore(storage, () => now).load('staff-b', 'shop-a'), undefined);
  assert.equal(await createClaimPendingStore(storage, () => now).load('staff-a', 'shop-b'), undefined);
  assert.equal((await createClaimPendingStore(storage, () => now + 60_000).loadState('staff-a', 'shop-a')).state, 'expired');
  assert.deepEqual(await createClaimPendingStore(storage, () => now + 60_000).load('staff-a', 'shop-a'), pending);
  assert.equal(values.size, 1);
});

test('late cleanup from another account does not erase the current account attempt', async () => {
  const { surface: storage } = memoryStorage();
  const now = Date.parse('2026-10-06T00:00:00Z');
  const store = createClaimPendingStore(storage, () => now);
  const pending = { accountId: 'staff-b', merchantId: 'shop-a', token: 'token-b', expiresAt: new Date(now + 60_000).toISOString() };
  await store.save(pending);
  await store.clear('staff-a');
  assert.deepEqual(await store.load('staff-b', 'shop-a'), pending);
});

test('delayed cleanup of A cannot erase a newer B account attempt', async () => {
  const { values, surface } = memoryStorage();
  const now = Date.parse('2026-10-06T00:00:00Z');
  const store = createClaimPendingStore(surface, () => now);
  const attempt = (accountId: string) => ({ accountId, merchantId: 'shop-a', token: `token-${accountId}`, expiresAt: new Date(now + 60_000).toISOString() });
  await store.save(attempt('staff-a'));
  const aKey = [...values.keys()][0]!;
  let release!: () => void;
  let started!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const deleting = new Promise<void>((resolve) => { started = resolve; });
  const storage = { ...surface, deleteItemAsync: async (key: string) => {
    if (key === aKey) { started(); await held; }
    values.delete(key);
  } };
  const cleanup = clearClaimPendingIntent(storage, 'staff-a');
  await deleting;
  await createClaimPendingStore(storage, () => now).save(attempt('staff-b'));
  release();
  await cleanup;
  assert.deepEqual(await createClaimPendingStore(storage, () => now).load('staff-b', 'shop-a'), attempt('staff-b'));
});

test('a lost issue response uses the saved identity after app relaunch to recover the same slot', async () => {
  const { surface: storage } = memoryStorage();
  const now = Date.parse('2026-10-06T00:00:00Z');
  const token = `masscom-customer:v1:${'A'.repeat(43)}`;
  const pending = { accountId: 'staff-a', merchantId: 'shop-a', token, expiresAt: new Date(now + 60_000).toISOString() };
  await createClaimPendingStore(storage, () => now).save(pending);
  let request = 0;
  const options = {
    apiUrl: 'https://api.example.test',
    credential: { kind: 'bearer' as const, sessionToken: 'session-a' },
    fetcher: async (input: RequestInfo | URL, init?: RequestInit) => {
      request += 1;
      if (request === 1) throw new TypeError('response lost');
      if (String(input).endsWith('/reissue')) {
        assert.deepEqual(JSON.parse(String(init?.body)), { expectedTokenVersion: 1 });
        return Response.json({ claimSlotId: 'slot-a', token: 'R'.repeat(43), tokenVersion: 2, expiresAt: new Date(now + 120_000).toISOString() });
      }
      assert.deepEqual(JSON.parse(String(init?.body)), { customerIdentityToken: token, merchantReference: token, useConfirmed: true });
      return Response.json({ claimSlotId: 'slot-a', tokenVersion: 1, expiresAt: pending.expiresAt, replayed: true });
    },
  };
  await assert.rejects(createCommerceApiClient(options).issueOrReissueIdentityClaim({ merchantId: 'shop-a', customerIdentityToken: token }), /response lost/);
  const relaunched = createClaimPendingStore(storage, () => now);
  const saved = await relaunched.load('staff-a', 'shop-a');
  assert.ok(saved);
  const recovered = await createCommerceApiClient(options).issueOrReissueIdentityClaim({ merchantId: saved.merchantId, customerIdentityToken: saved.token });
  assert.equal(recovered.claimSlotId, 'slot-a');
  assert.equal(recovered.tokenVersion, 2);
});

test('expired pending identity is retained for canonical consumed-identity replay', async () => {
  const { values, surface: storage } = memoryStorage();
  const time = Date.parse('2026-10-06T00:00:00Z');
  const pending = { accountId: 'staff-expired', merchantId: 'shop', token: 'consumed-identity', expiresAt: new Date(time + 1000).toISOString() };
  await createClaimPendingStore(storage, () => time).save(pending);
  const store = createClaimPendingStore(storage, () => time + 2000);
  const loaded = await store.loadState('staff-expired', 'shop');
  assert.deepEqual(loaded, { state: 'expired', pending });
  assert.equal(values.size, 1);
  const replay = await restoreLikeServer(loaded.pending!.token);
  assert.equal(replay, 'same-slot');
});
async function restoreLikeServer(token: string) { assert.equal(token, 'consumed-identity'); return 'same-slot'; }

test('late terminal cleanup of token A cannot erase newer token B for the same account', async () => {
  const { surface: storage } = memoryStorage();
  const time = Date.parse('2026-10-06T00:00:00Z');
  const store = createClaimPendingStore(storage, () => time, 'customer');
  const a = { accountId: 'same', merchantId: 'shop', token: 'A', expiresAt: new Date(time+60_000).toISOString() };
  const b = { ...a, token: 'B' };
  await store.save(a);await store.save(b);
  assert.equal(await store.clearIfMatches('same', a), false);
  assert.deepEqual(await store.load('same','shop'), b);
  assert.equal(await store.clearIfMatches('same', b), true);
  assert.equal(await store.load('same','shop'), undefined);
});

test('overlapping same-account clear of A and save of B is serialized without losing B', async () => {
  const { values, surface } = memoryStorage();
  const time = Date.parse('2026-10-06T00:00:00Z');
  const a = { accountId: 'same-race', merchantId: 'shop', token: 'A', expiresAt: new Date(time+60_000).toISOString() };
  const b = { ...a, token: 'B' };
  const store = createClaimPendingStore(surface, () => time, 'customer');
  await store.save(a);
  let release!: () => void, started!: () => void;
  const held = new Promise<void>(resolve => { release=resolve; });
  const readStarted = new Promise<void>(resolve => { started=resolve; });
  const delayed = { ...surface, getItemAsync: async (key: string) => { started(); await held; return values.get(key) ?? null; } };
  const racing = createClaimPendingStore(delayed, () => time, 'customer');
  const oldClear = racing.clearIfMatches('same-race', a);
  await readStarted;
  const newSave = racing.save(b);
  release();
  assert.equal(await oldClear, true);
  await newSave;
  assert.deepEqual(await store.load('same-race','shop'), b);
});

test('expired customer pending token still reaches canonical redeem and recovers consumed visit', async () => {
  const { surface: storage } = memoryStorage();
  const time = Date.parse('2026-10-06T00:00:00Z');
  const pending = { accountId: 'customer-expired', merchantId: 'shop', token: 'old-claim-token', expiresAt: new Date(time+1000).toISOString() };
  await createClaimPendingStore(storage, () => time, 'customer').save(pending);
  const store = createClaimPendingStore(storage, () => time+2000, 'customer');
  const loaded = await store.loadState('customer-expired','shop');
  assert.equal(loaded.state, 'expired');
  let requests=0;
  const api=createCommerceApiClient({apiUrl:'https://api.example.test',credential:{kind:'bearer',sessionToken:'session'},fetcher:async (_input,init)=>{
    requests++;assert.deepEqual(JSON.parse(String(init?.body)),{token:loaded.pending.token});
    return Response.json({claimSlotId:'slot',merchantId:'shop',merchantName:'가게',campaignTitle:'캠페인',status:'CLAIMED',replayed:true,
      visit:{visitEventId:'visit',campaignId:'campaign',businessDate:'2026-10-06',verificationLevel:'MERCHANT_CONFIRMED',progressCounted:true,progressVisitCount:1},grantedRewards:[]});
  }});
  const result=await api.redeemClaim(loaded.pending.token);
  assert.equal(result.replayed,true);assert.equal(requests,1);
  assert.equal(await store.clearIfMatches('customer-expired',loaded.pending),true);
});


test('recovery stays queryable through 48h grace, then is deleted without retaining old identity',async()=>{
  const {values,surface:storage}=memoryStorage();const time=Date.parse('2026-10-06T00:00:00Z');
  const pending={accountId:'staff-grace',merchantId:'shop',token:'identity',expiresAt:new Date(time+1000).toISOString()};
  await createClaimPendingStore(storage,()=>time).save(pending);
  assert.deepEqual(await createClaimPendingStore(storage,()=>time+1000+48*60*60*1000).loadState('staff-grace','shop'),{state:'expired',pending});
  assert.equal(values.size,1);
  assert.deepEqual(await createClaimPendingStore(storage,()=>time+1000+48*60*60*1000+1).loadState('staff-grace','shop'),{state:'none'});
  assert.equal(values.size,0);
});

test('customer pending cleanup recognizes only final server token outcomes',()=>{
  for(const code of ['CLAIM_TOKEN_EXPIRED','CLAIM_TOKEN_INVALID','CLAIM_SLOT_NOT_FOUND'])assert.equal(isTerminalPendingClaimCode(code),true,code);
  for(const code of ['CLAIM_TOKEN_UNAVAILABLE','CLAIM_CAMPAIGN_UNAVAILABLE','SESSION_INVALID','NETWORK_ERROR'])assert.equal(isTerminalPendingClaimCode(code),false,code);
});
