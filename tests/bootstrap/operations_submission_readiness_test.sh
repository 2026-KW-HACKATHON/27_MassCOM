#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const runbook = readFileSync('docs/OPERATIONS_RUNBOOK.md', 'utf8');
const migrations = readdirSync('apps/api/migrations').filter(name => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
const pending = migrations.filter(name => Number(name.slice(0, 4)) > 43);
assert.equal(pending.length, 33);
assert.equal(migrations.length, 76);
assert.equal(migrations.at(-1), '0077_ai_art_account_limits.sql');
for (const filename of pending) assert.ok(runbook.includes(`\`${filename}\``), `누락된 migration: ${filename}`);
for (const text of ['43 + 33 = 76', 'privacy-2026-10-09', '/play/', '/open', 'backward_compatible=no', 'FORWARD_RECOVERY_REQUIRED', 'outdated', '재로그인']) {
  assert.ok(runbook.includes(text), `배포 관문 누락: ${text}`);
}
for (const pattern of [/`privacy-\d{4}-\d{2}-\d{2}`/, /Preview \d+/, /test\.\d+/, /`[0-9a-f]{7,40}`/]) {
  assert.match(runbook, pattern, `배포 식별자 형식 누락: ${pattern}`);
}
assert.match(runbook, /운영.*복원.*PASS/);
console.log('A01·A02·A03 운영 문서 회귀 PASS');
JS
