// Issue #412 (D-092): 앱 기록만으로는 평생 처음 온 손님인지 알 수 없다. 점주가 보는 화면·CSV·안내 문서에
// "신규 고객"이나 "첫 손님"이라는 말을 쓰지 않고, "첫 방문/재방문" 대신 "MassCOM에서 처음 확인된 방문"으로 적는다.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

const root = new URL('../../', import.meta.url).pathname;
const merchantFacing = [
  'apps/production-web/merchant.html', 'apps/production-web/admin.html',
  'apps/production-web/assets/merchant.mjs', 'apps/production-web/assets/admin.mjs',
  'apps/production-web/assets/campaign-benefit-status.mjs',
  'apps/production-web/assets/real-world-merchant.mjs', 'apps/production-web/assets/merchant-profile.mjs',
  'apps/mobile/src/merchant-insights', 'apps/mobile/src/screens/merchant-home', 'apps/mobile/src/screens/merchant-claim',
  'apps/mobile/src/screens/merchant-detail', 'apps/mobile/src/merchant/campaign-purpose.ts',
  'apps/api/src/postgres/merchant-operations.ts', 'apps/api/src/postgres/merchant-overview.ts',
  'apps/api/src/merchant-overview-rules.ts', 'apps/api/src/campaign-purpose-rules.ts',
  'apps/api/src/campaign-benefit-rules.ts', 'apps/api/src/campaign-benefits.ts',
  'apps/api/src/postgres/campaign-benefits.ts',
  'apps/mobile/src/gamification/badge-api.ts', 'apps/mobile/src/gamification/coupon-use-sheet.tsx',
  'apps/mobile/src/screens/collection/index.tsx',
  'docs/MERCHANT_ONBOARDING.md',
];

function sourceFiles(path) {
  const absolute = join(root, path);
  if (!statSync(absolute).isDirectory()) return [path];
  return readdirSync(absolute, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && /\.(?:tsx?|mjs|html|md)$/.test(entry.name) && !/\.test\.|integration\.ts$/.test(entry.name))
    .map(entry => relative(root, join(entry.parentPath, entry.name)));
}

test('merchant-facing screens, CSV and guides never call anyone a new customer or a first guest', () => {
  const files = merchantFacing.flatMap(sourceFiles);
  // 시험이 비어 있는 목록을 통과시키지 않도록 대표 파일이 실제로 검사 대상인지 먼저 본다.
  for (const required of ['apps/production-web/assets/merchant.mjs', 'apps/mobile/src/merchant-insights/view-model.ts',
    'apps/api/src/postgres/merchant-operations.ts', 'apps/production-web/admin.html', 'docs/MERCHANT_ONBOARDING.md',
    'apps/api/src/campaign-benefit-rules.ts', 'apps/api/src/campaign-benefits.ts',
    'apps/api/src/postgres/campaign-benefits.ts', 'apps/mobile/src/gamification/badge-api.ts',
    'apps/mobile/src/gamification/coupon-use-sheet.tsx', 'apps/mobile/src/screens/collection/index.tsx']) {
    assert.ok(files.includes(required), required);
  }
  assert.ok(files.length >= 20, `only ${files.length} files scanned`);
  const offenders = files.filter(file => /신규 고객|첫 손님/.test(readFileSync(join(root, file), 'utf8')));
  assert.deepEqual(offenders, []);
});

test('the first-counted-visit labels say "처음 확인된 방문" in the merchant web, the mobile cards and the CSV', () => {
  const web = readFileSync(join(root, 'apps/production-web/assets/merchant.mjs'), 'utf8');
  assert.ok(web.includes("valueCard('이번 주 처음 확인된 방문 / 다시 확인된 방문'"));
  assert.ok(web.includes('MassCOM에서 이 가게 방문이 처음 확인된 건이 "처음 확인된 방문"이에요'));
  assert.doesNotMatch(web, /이번 주 첫 방문/);
  const mobile = readFileSync(join(root, 'apps/mobile/src/merchant-insights/view-model.ts'), 'utf8');
  assert.ok(mobile.includes("label: '이번 주 처음 확인된 방문'"));
  assert.ok(mobile.includes("label: '이번 주 다시 확인된 방문'"));
  assert.doesNotMatch(mobile, /이번 주 첫 방문|이번 주 재방문/);
  const csv = readFileSync(join(root, 'apps/api/src/postgres/merchant-operations.ts'), 'utf8');
  assert.ok(csv.includes("THEN '처음 확인된 방문' ELSE '다시 확인된 방문' END AS visit_kind"));
  assert.ok(csv.includes("'방문구분(MassCOM 확인 기준)'"));
  assert.doesNotMatch(csv, /'첫 방문'|'재방문'|'방문구분'/);
});
