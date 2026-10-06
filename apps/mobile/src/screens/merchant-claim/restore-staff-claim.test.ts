import assert from 'node:assert/strict';
import { test } from 'node:test';
import { URL } from 'node:url';
import {readFileSync} from 'node:fs';
import {CommerceApiError} from '../../commerce/commerce-api';
import { createClaimPendingStore } from '../../commerce/claim-pending';
import { restoreStaffClaim, terminalStaffClaimError } from './restore-staff-claim';

test('restart replays the stored consumed identity instead of resolving it as a fresh QR', async () => {
  const values = new Map<string, string>();
  const storage = { async getItemAsync(key: string) { return values.get(key) ?? null; },
    async setItemAsync(key: string, value: string) { values.set(key, value); },
    async deleteItemAsync(key: string) { values.delete(key); } };
  const store = createClaimPendingStore(storage, () => 1000);
  await store.save({ accountId: 'staff-a', merchantId: 'shop-a', token: 'consumed-test-identity', expiresAt: new Date(2000).toISOString() });
  const afterRestart = createClaimPendingStore(storage, () => 2500);
  assert.equal((await afterRestart.loadState('staff-a', 'shop-a')).state, 'expired');
  const pending = await afterRestart.load('staff-a', 'shop-a');
  assert.ok(pending);
  let freshResolution = 0;
  const result = await restoreStaffClaim({
    async issueOrReissueIdentityClaim(input) {
      assert.deepEqual(input, { merchantId: 'shop-a', customerIdentityToken: 'consumed-test-identity' });
      return { claimSlotId: 'same-slot', tokenVersion: 2, token: 'reissued-test-code', expiresAt: new Date(3000).toISOString() };
    },
    async resolveCustomerIdentity() { freshResolution++; throw Error('Consumed identities are not fresh'); },
  } as Parameters<typeof restoreStaffClaim>[0], pending);
  assert.ok(result);
  assert.equal(result.claimSlotId, 'same-slot');
  assert.equal(result.tokenVersion, 2);
  assert.equal(freshResolution, 0);
});

test('late cold restore after a new scan is ignored by the shared request generation', async () => {
  const { createIdentityRequestGate } = await import('../../commerce/customer-identity');
  const gate = createIdentityRequestGate();
  const restore = gate.start();
  let finish!: (value: any) => void;
  const pending = { accountId: 'staff-a', merchantId: 'shop-a', token: 'old', expiresAt: new Date(2000).toISOString() };
  const api = { issueOrReissueIdentityClaim: () => new Promise(resolve => { finish = resolve; }) } as Parameters<typeof restoreStaffClaim>[0];
  const result = restoreStaffClaim(api, pending, () => gate.isCurrent(restore));
  gate.start(); // a new scan supersedes restore
  finish({ claimSlotId: 'old-slot', tokenVersion: 1, token: 'old-qr', expiresAt: new Date(3000).toISOString() });
  assert.equal(await result, undefined);
});


test('staff restore shares scan/cancel generation and clears only exact terminal server failures',()=>{
  const source=readFileSync(new URL('./staff.tsx',import.meta.url),'utf8');
  const effect=source.slice(source.indexOf('void pendingStore.loadState(accountId, merchantId)'),source.indexOf('}, [accountId, merchantId, api, pendingStore, securePending, requestGate])'));
  assert.match(source,/const restoreRequest = requestGate.start\(\)/);
  assert.match(effect,/if \(!isCurrent\(\) \|\| saved.state === 'none'\) return/);
  assert.match(effect,/restoreStaffClaim\(api, pending, isCurrent\)/);
  assert.match(effect,/pendingStore.clearIfMatches\(accountId, pending\)/);
  assert.doesNotMatch(source.slice(source.indexOf('function cancel()'),source.indexOf('async function resolve(')),/pendingStore.clear\(accountId\)/);
  assert.equal(terminalStaffClaimError(new CommerceApiError(410,'CUSTOMER_IDENTITY_EXPIRED')),true);
  assert.equal(terminalStaffClaimError(new CommerceApiError(503,'SERVICE_UNAVAILABLE')),false);
  assert.equal(terminalStaffClaimError(new CommerceApiError(401,'SESSION_INVALID')),false);
});
