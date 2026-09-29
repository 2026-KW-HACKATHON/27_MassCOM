#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(process.argv[2] ?? '.');
/** @param {string} path */
const read = (path) => readFileSync(join(root, path), 'utf8');
const catalog = read('tests/catalog/required-tests.tsv');
const ledger = read('docs/TEST_STATUS.md');
const portal = read('docs/index.html');
const readme = read('README.md');
const manifest = JSON.parse(read('docs/SUBMISSION_EVIDENCE.json'));

/** @type {Record<'PASS' | 'FAIL' | 'BLOCKED' | 'NOT_RUN', number>} */
const counts = { PASS: 0, FAIL: 0, BLOCKED: 0, NOT_RUN: 0 };
const catalogRows = catalog.trim().split(/\r?\n/).slice(1).map((line) => line.split('\t'));
for (const [id, , status] of catalogRows) {
  if (!(status in counts)) throw new Error(`unknown catalog status: ${id}:${status}`);
  counts[/** @type {keyof typeof counts} */ (status)] += 1;
  const row = new RegExp(`\\|\\s*${id}\\s*\\|[^\\n]*\\|\\s*${status}\\s*\\|`).test(ledger);
  if (!row) throw new Error(`TEST_STATUS mismatch for ${id}:${status}`);
}
const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
if (total !== catalogRows.length || total !== 36) throw new Error(`required test total mismatch: ${total}`);
for (const [key, value] of Object.entries({ total, ...counts })) {
  if (manifest.requiredTests?.[key] !== value) throw new Error(`manifest requiredTests.${key} mismatch`);
}
// 원장에는 카탈로그에 없는 필수 시험 행이 남아 있어도 안 된다: 원장 행 수와 상태별 합계도 manifest와 맞아야 한다.
const ledgerStatuses = ledger.split('\n')
  .filter((line) => /^\| (Q|R|W|M|C|D|A|O)\d{2} \|/.test(line))
  .map((line) => line.split('|')[3].trim());
if (ledgerStatuses.length !== manifest.requiredTests?.total
  || ['PASS', 'BLOCKED', 'NOT_RUN'].some((status) => ledgerStatuses.filter((value) => value === status).length !== manifest.requiredTests?.[status])) {
  throw new Error('submission evidence totals differ from TEST_STATUS');
}
const summary = `${counts.PASS} PASS · ${counts.BLOCKED} BLOCKED · ${counts.NOT_RUN} NOT_RUN`;
if (!portal.includes(summary)) throw new Error('portal test summary drift');
if (!readme.includes('36개 ID')) throw new Error('README required-test total drift');

// README와 두 상태 문서는 필수 시험 합계를 문장으로 다시 적는다. 확인하지 않으면 조용히 어긋난다.
const totalsLine = `${counts.PASS} PASS / ${counts.BLOCKED} BLOCKED / ${counts.NOT_RUN} NOT_RUN`;
for (const stateFile of ['README.md', 'docs/PROJECT_STATE.md', 'docs/HANDOFF.md']) {
  const text = read(stateFile).replace(/`/g, '');
  const stated = text.match(/\d+ PASS \/ \d+ BLOCKED \/ \d+ NOT_RUN/g) ?? [];
  if (stated.length === 0 || stated.some((value) => value !== totalsLine)) {
    throw new Error(`${stateFile} states required-test totals other than ${totalsLine}: ${stated.join(', ') || 'none'}`);
  }
}
if (manifest.truthBoundary?.partnerStoresClaimed !== 0 || manifest.truthBoundary?.fieldParticipantsClaimed !== 0) {
  throw new Error('submission evidence invents field achievements');
}
if (manifest.recordedAt !== '2026-09-23 KST' || !portal.includes('2026-09-23 KST')) {
  throw new Error('evidence date drift');
}
if (!/^[0-9a-f]{40}$/.test(manifest.baselineCommit)) throw new Error('invalid manifest baseline commit');
for (const paths of [manifest.androidEvidence, manifest.securityEvidence]) {
  for (const path of paths ?? []) if (!existsSync(join(root, path))) throw new Error(`missing evidence path: ${path}`);
}
if (existsSync(join(root, '.git'))) {
  const ancestor = spawnSync('git', ['-C', root, 'merge-base', '--is-ancestor', manifest.baselineCommit, 'HEAD']);
  if (ancestor.status !== 0) throw new Error('manifest baseline is not an ancestor of HEAD');
}
for (const required of [117, 119, 120]) {
  if (!manifest.mergedPullRequests.includes(required)) throw new Error(`manifest missing merged PR #${required}`);
}
console.log(`evidence consistency verified: ${summary}`);
