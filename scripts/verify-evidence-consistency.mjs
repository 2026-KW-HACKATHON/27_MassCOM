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
const presentation = read('docs/presentation.html');
const presentationNotes = read('docs/PRESENTATION.md');
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
const summary = `${counts.PASS} PASS · ${counts.BLOCKED} BLOCKED · ${counts.NOT_RUN} NOT_RUN`;
if (!portal.includes(summary)) throw new Error('portal test summary drift');
if (!presentationNotes.includes(`36개 중 ${counts.PASS} PASS, ${counts.BLOCKED} BLOCKED, ${counts.NOT_RUN} NOT_RUN`)) {
  throw new Error('presentation notes test summary drift');
}
if (!readme.includes('36개 ID')) throw new Error('README required-test total drift');

const scenes = (presentation.match(/<section class="scene(?:\s|\")/g) ?? []).length;
const navItems = (presentation.match(/<nav class="scene-nav"[\s\S]*?<\/nav>/)?.[0].match(/<a /g) ?? []).length;
if (scenes !== 7 || navItems !== scenes) throw new Error(`presentation scene/nav mismatch: ${scenes}/${navItems}`);
if (!presentation.includes('일곱 장면') || presentation.includes('아홉 장면')) {
  throw new Error('presentation scene copy drift');
}
if (manifest.recordedAt !== '2026-09-23 KST'
  || !portal.includes('2026-09-23 KST')
  || !presentation.includes('2026-09-23')) {
  throw new Error('evidence date drift');
}
if (!/^[0-9a-f]{40}$/.test(manifest.baselineCommit)) throw new Error('invalid manifest baseline commit');
for (const paths of [manifest.androidEvidence, manifest.securityEvidence, manifest.presentationEvidence]) {
  for (const path of paths ?? []) if (!existsSync(join(root, path))) throw new Error(`missing evidence path: ${path}`);
}
if (existsSync(join(root, '.git'))) {
  const ancestor = spawnSync('git', ['-C', root, 'merge-base', '--is-ancestor', manifest.baselineCommit, 'HEAD']);
  if (ancestor.status !== 0) throw new Error('manifest baseline is not an ancestor of HEAD');
}
for (const required of [117, 119, 120]) {
  if (!manifest.mergedPullRequests.includes(required)) throw new Error(`manifest missing merged PR #${required}`);
}
console.log(`evidence consistency verified: ${summary}, ${scenes} scenes`);
