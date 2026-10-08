import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { progressNote } from './progress-note';
import { customerBenefitNote, outsideWindowCustomerNote, outsideWindowStaffNote, staffWindowNote } from './benefit-window';

test('the staff note appears only for a code issued outside the benefit window and says the visit still counts', () => {
  assert.equal(outsideWindowStaffNote, '이 코드를 만든 시각은 캠페인 시간대 밖이에요(방문은 인정돼요)');
  // 혜택은 뒤 PR에서 생기므로 아직 혜택을 말하지 않는다.
  assert.doesNotMatch(outsideWindowStaffNote, /혜택/);
  assert.equal(staffWindowNote({ windowStatus: 'OUTSIDE_WINDOW' }), outsideWindowStaffNote);
  for (const claim of [undefined, {}, { windowStatus: 'IN_WINDOW' as const }, { windowStatus: 'NONE' as const }]) {
    assert.equal(staffWindowNote(claim), undefined);
  }
});

const counted = { progressCounted: true, progressVisitCount: 1 } as const;
const sameDay = { progressCounted: false, progressVisitCount: 1 } as const;
const staffSelf = { progressCounted: false, progressVisitCount: 0, progressExcludedReason: 'STAFF_SELF' } as const;

test('the customer line is neutral, mentions that the visit and collectible count, and shows only outside the window', () => {
  assert.equal(customerBenefitNote({ visit: counted, benefit: { state: 'OUTSIDE_WINDOW' } }), outsideWindowCustomerNote);
  assert.match(outsideWindowCustomerNote, /방문과 수집품은 그대로 인정돼요/);
  assert.doesNotMatch(outsideWindowCustomerNote, /실패|거절|불가|놓쳤|아쉽/);
  // 혜택은 뒤 PR에서 생기므로 아직 혜택을 말하지 않는다.
  assert.doesNotMatch(outsideWindowCustomerNote, /혜택/);
  for (const claim of [undefined, { visit: counted }, { visit: counted, benefit: { state: 'ELIGIBLE' as const } }, { visit: counted, benefit: { state: 'NONE' as const } }]) {
    assert.equal(customerBenefitNote(claim), undefined);
  }
});

test('the customer line never appears on a visit that does not count, so it cannot contradict the progress note (#412)', () => {
  for (const visit of [sameDay, staffSelf]) {
    for (const state of ['OUTSIDE_WINDOW', 'ELIGIBLE', 'NONE'] as const) {
      assert.equal(customerBenefitNote({ visit, benefit: { state } }), undefined, `${JSON.stringify(visit)} ${state}`);
    }
    assert.equal(customerBenefitNote({ visit }), undefined);
  }
  // 진행 안내와 함께 보이는 조합: 세어진 방문에서만 두 줄이 같이 나온다.
  assert.match(progressNote(counted), /반영됐습니다/);
  assert.match(progressNote(sameDay), /한 번만 셉니다/);
  assert.match(progressNote(staffSelf), /세지 않습니다/);
});

test('the staff QR modal and the customer success card render these notes', () => {
  const staff = readFileSync(new URL('../screens/merchant-claim/staff.tsx', import.meta.url), 'utf8');
  assert.match(staff, /import \{ staffWindowNote \} from '@\/commerce\/benefit-window'/);
  assert.match(staff, /staffWindowNote\(issued\)/);
  const customer = readFileSync(new URL('../screens/claim-redeem/index.tsx', import.meta.url), 'utf8');
  assert.match(customer, /import \{ customerBenefitNote \} from '@\/commerce\/benefit-window'/);
  assert.match(customer, /customerBenefitNote\(redeemed\)/);
});
