import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeMerchantProfileFields } from './merchant-profile-rules.js';

test('shared merchant profile rules normalize operator and merchant fields', () => {
  assert.deepEqual(normalizeMerchantProfileFields({ story: ' 소개 ' }), { story: '소개' });
  assert.deepEqual(normalizeMerchantProfileFields({
    story: ' 소개 ', businessHours: ' 매일 ', menuItems: [{ name: ' 커피 ', priceWon: 4500 }],
  }), { story: '소개', businessHours: '매일', menuItems: [{ name: '커피', priceWon: 4500 }] });
  assert.deepEqual(normalizeMerchantProfileFields({
    story: '가'.repeat(4000), businessHours: '나'.repeat(1000),
    menuItems: Array.from({ length: 30 }, (_, index) => ({ name: `메뉴 ${index}`, priceWon: 1_000_000_000 })),
  })?.menuItems?.length, 30);
});

test('shared merchant profile limits reject invalid content without changing operator rules', () => {
  const valid = { story: '', businessHours: '', menuItems: [{ name: '메뉴', priceWon: 0 }] };
  for (const fields of [
    { story: '가'.repeat(4001) },
    { businessHours: '가'.repeat(1001) },
    { menuItems: Array.from({ length: 31 }, () => ({ name: '메뉴', priceWon: 0 })) },
    { menuItems: [{ name: '  ', priceWon: 0 }] },
    { menuItems: [{ name: '가'.repeat(201), priceWon: 0 }] },
    { menuItems: [{ name: '메뉴', priceWon: -1 }] },
    { menuItems: [{ name: '메뉴', priceWon: 1.5 }] },
    { menuItems: [{ name: '메뉴', priceWon: 1_000_000_001 }] },
  ]) assert.equal(normalizeMerchantProfileFields({ ...valid, ...fields }), undefined);
});
