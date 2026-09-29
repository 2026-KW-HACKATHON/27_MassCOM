import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

test('the recommend action shares only the shop name and its link through the system share sheet', () => {
  const share = read('./recommend-share.ts');
  assert.match(share, /Share\.share\(\{ message: merchantShareMessage\(merchant, linkVariantFor\(Application\.applicationId\)\) \}\)/);
  assert.match(share, /공유창을 열지 못했어요/);
  assert.doesNotMatch(share, /fetch\(|console\./);
});

test('the merchant detail page and the map pin sheet both offer 친구에게 추천 with the demo flag', () => {
  const detail = read('../screens/merchant-detail/index.tsx');
  assert.match(detail, /label="친구에게 추천"/);
  assert.match(detail, /recommendMerchant\(\{ id: merchant\.id, name: merchant\.name, demo: merchant\.demo \}\)/);
  const sheet = read('../screens/town-map/pin-sheet.tsx');
  assert.match(sheet, /label="친구에게 추천"/);
  assert.match(sheet, /recommendMerchant\(\{ id: pin\.merchantId, name: pin\.name, demo: pin\.demo \}\)/);
});
