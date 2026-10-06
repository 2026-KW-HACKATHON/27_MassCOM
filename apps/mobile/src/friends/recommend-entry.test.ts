import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

test('the recommend action shares only the shop name and its link through the system share sheet', () => {
  const share = read('./recommend-share.ts');
  assert.match(share, /Share\.share\(\{ message: merchantShareMessage\(merchant, linkVariantFor\(getAppPackageId\(\)\)\) \}\)/);
  assert.match(share, /공유창을 열지 못했어요/);
  assert.doesNotMatch(share, /fetch\(|console\./);
});

test('the merchant detail page and the map pin sheet both offer 친구에게 추천 with the demo flag', () => {
  const detail = read('../screens/merchant-detail/index.tsx');
  assert.match(detail, /친구에게 추천<\/Text>/);
  assert.match(detail, /recommendMerchant\(\{\s*id:\s*merchant\.id,\s*name:\s*merchant\.name,\s*demo:\s*merchant\.demo\s*\}\)/);
  const sheet = read('../screens/town-map/pin-sheet.tsx');
  assert.match(sheet, /label="친구에게 추천"/);
  assert.match(sheet, /recommendMerchant\(\{ id: pin\.merchantId, name: pin\.name, demo: pin\.demo \}\)/);
});

test('list and map detail entry retain their discovery source', () => {
  const discovery = read('../screens/real-map/index.tsx');
  assert.match(discovery, /function openMerchant\(id:string,source:'map'\|'list'\|'recommendation'\)/);
  assert.match(discovery, /params:\{merchantId:id,from:source\}/);
  assert.match(discovery, /visible\.map\(m=>row\(m,'list'\)\)/);
  assert.match(discovery, /\{selected\?<View[\s\S]*?\{row\(selected,'map'\)\}/);
});
