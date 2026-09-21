#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? '.');
function read(path = '') {
  return readFileSync(join(root, path), 'utf8');
}
const api = read('apps/api/README.md');
const mobile = read('apps/mobile/README.md');
const worker = read('apps/worker/README.md');
const handoff = read('docs/HANDOFF.md');
const state = read('docs/PROJECT_STATE.md');
/** @type {Record<string, { scripts: Record<string, string> }>} */
const packages = Object.fromEntries(['api', 'mobile', 'worker'].map((name) => [
  name, JSON.parse(read(`apps/${name}/package.json`)),
]));
/** @type {Array<[string, string]>} */
const required = [
  [api, '운영 계정 API는 `Authorization: Bearer <sessionToken>`만 사용'],
  [api, 'loopback 개발 DEMO는 `x-account-id`만 사용'],
  [mobile, '운영 계정 삭제는 승인된 별도 사용자 확인 설계 전까지 `BLOCKED`'],
  [worker, 'CHAIN_ID=31337'], [worker, 'ALLOW_UNLOCKED_LOCAL_MINTER=true'],
  [worker, 'Base Sepolia encrypted keystore'], [worker, 'CHAIN_ID=84532'],
  [worker, 'MINTER_KEYSTORE_PATH'], [worker, 'MINTER_KEYSTORE_PASSWORD_FILE'],
  [worker, 'npm run db:migrate --prefix ../api'], [worker, '실제 Base Sepolia 전송은 `NOT_RUN`'],
  [handoff, '기준 main 커밋 SHA: `a50f678`'], [handoff, 'main CI `35620303554` PASS'],
  [handoff, '열린 PR 최종 기준: `gh pr list`'], [state, 'API 78'], [state, '모바일 140'], [state, 'PostgreSQL 37'],
];
let failures = 0;
for (const [source, text] of required) {
  if (!source.includes(text)) { console.error(`operations documentation missing: ${text}`); failures += 1; }
}
/** @type {Array<[string, { scripts: Record<string, string> }, string[]]>} */
const requiredScripts = [
  ['api', packages.api, ['test', 'test:postgres', 'typecheck', 'build']],
  ['mobile', packages.mobile, ['test', 'typecheck', 'lint', 'export:android']],
  ['worker', packages.worker, ['start:once', 'test', 'test:postgres', 'test:anvil', 'typecheck', 'build']],
];
for (const [name, packageDefinition, scripts] of requiredScripts) {
  for (const script of scripts) {
    if (typeof packageDefinition.scripts[script] !== 'string') {
      console.error(`missing package script: ${name}:${script}`); failures += 1;
    }
  }
}
if (!packages.worker.scripts['test:postgres'].includes('db:migrate --prefix ../api')) {
  console.error('worker test:postgres no longer runs API migrations'); failures += 1;
}
if (failures) process.exit(1);
console.log('operations documentation verified');
