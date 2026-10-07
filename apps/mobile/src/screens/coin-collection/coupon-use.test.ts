import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath, URL } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./coupon-use.tsx', import.meta.url)), 'utf8');

test('coupon identity is revoked on app background and route blur; late requests cannot restore the QR', () => {
  assert.match(source, /AppState\.addEventListener\('change'/);
  assert.match(source, /if \(!isActive\) hideIdentity\(\)/);
  assert.match(source, /useFocusEffect\(useCallback\(\(\) => \(\) => hideIdentity\(\)/);
  assert.match(source, /gate\.cancel\(\)/);
  assert.match(source, /if \(cancelled \|\| !activeRef\.current \|\| !gate\.isCurrent\(request\)\) \{/);
  assert.match(source, /revokeIdentity\(next\.token\)/);
  assert.match(source, /active && usable && identityValid/);
  assert.match(source, /coupon\.status === 'REVOKED'.*방문 취소로 철회된 쿠폰/);
});
