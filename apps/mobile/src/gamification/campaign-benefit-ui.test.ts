import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const collection = readFileSync(new URL('../screens/collection/index.tsx', import.meta.url), 'utf8');
const sheet = readFileSync(new URL('./coupon-use-sheet.tsx', import.meta.url), 'utf8');

test('benefit coupons share collection tickets and refresh through the benefit endpoint while using the QR', () => {
  assert.match(collection, /campaignBenefits\.flatMap\(\(benefit\) => benefit\.coupon/);
  assert.match(collection, /coupons\.map\(\(coupon\) => <CouponTicket/);
  assert.match(collection, /loadCoupon=\{campaignBenefits\.some/);
  assert.match(sheet, /const benefitCoupon = loadCoupon \? await loadCoupon\(\)/);
});

test('the QR waits for usableFrom and can become available without reopening the sheet', () => {
  assert.match(sheet, /const notYetUsable = coupon\.usableFrom !== undefined && Date\.parse\(coupon\.usableFrom\) > now/);
  assert.match(sheet, /!current\.usableFrom \|\| Date\.parse\(current\.usableFrom\) <= Date\.now\(\)/);
  assert.match(sheet, /if \(\(!identity && !notYetUsable\) \|\| \(done && !notYetUsable\)\) return/);
});
