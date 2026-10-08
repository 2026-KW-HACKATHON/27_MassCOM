import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { customerBenefitNote, outsideWindowCustomerNote, outsideWindowStaffNote, staffWindowNote } from './benefit-window';

test('the staff note appears only for a code issued outside the benefit window and says the visit still counts', () => {
  assert.equal(outsideWindowStaffNote, '지금은 혜택 시간대가 아니에요(방문은 인정돼요)');
  assert.equal(staffWindowNote({ windowStatus: 'OUTSIDE_WINDOW' }), outsideWindowStaffNote);
  for (const claim of [undefined, {}, { windowStatus: 'IN_WINDOW' as const }, { windowStatus: 'NONE' as const }]) {
    assert.equal(staffWindowNote(claim), undefined);
  }
});

test('the customer line is neutral, mentions that the visit and collectible count, and shows only outside the window', () => {
  assert.equal(customerBenefitNote({ benefit: { state: 'OUTSIDE_WINDOW' } }), outsideWindowCustomerNote);
  assert.match(outsideWindowCustomerNote, /방문과 수집품은 그대로 인정돼요/);
  assert.doesNotMatch(outsideWindowCustomerNote, /실패|거절|불가|놓쳤|아쉽/);
  for (const claim of [undefined, {}, { benefit: { state: 'ELIGIBLE' as const } }, { benefit: { state: 'NONE' as const } }]) {
    assert.equal(customerBenefitNote(claim), undefined);
  }
});

test('the staff QR modal and the customer success card render these notes', () => {
  const staff = readFileSync(new URL('../screens/merchant-claim/staff.tsx', import.meta.url), 'utf8');
  assert.match(staff, /import \{ staffWindowNote \} from '@\/commerce\/benefit-window'/);
  assert.match(staff, /staffWindowNote\(issued\)/);
  const customer = readFileSync(new URL('../screens/claim-redeem/index.tsx', import.meta.url), 'utf8');
  assert.match(customer, /import \{ customerBenefitNote \} from '@\/commerce\/benefit-window'/);
  assert.match(customer, /customerBenefitNote\(redeemed\)/);
});
