#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const runbook = readFileSync('docs/OPERATIONS_RUNBOOK.md', 'utf8');
const migrations = readdirSync('apps/api/migrations').filter(name => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
const pending = migrations.filter(name => Number(name.slice(0, 4)) > 43);
assert.equal(pending.length, 25);
assert.equal(migrations.length, 68);
for (const filename of pending) assert.ok(runbook.includes(`\`${filename}\``), `누락된 migration: ${filename}`);
for (const text of ['43 + 25 = 68', 'privacy-2026-10-07', 'Preview 20', 'test.11', '/play/', '/open', 'backward_compatible=no', 'FORWARD_RECOVERY_REQUIRED', 'db280032', 'outdated', '재로그인']) {
  assert.ok(runbook.includes(text), `배포 관문 누락: ${text}`);
}
assert.match(runbook, /운영.*복원.*PASS/);
console.log('Issue #401 A01·A02·A03 운영 문서 회귀 41 PASS / 0 FAIL');
JS
