import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('Lightsail 현재 상태는 마지막 실제 배포 증거와 일치한다', () => {
  const readme = readFileSync(new URL('../../infra/lightsail/README.md', import.meta.url), 'utf8');
  const evidence = JSON.parse(readFileSync(new URL('../../docs/evidence/deployment-db28003-2026-10-05.json', import.meta.url), 'utf8'));
  const current = readme.split('\n').find((line) => line.startsWith('**현재 배포 상태'));
  assert.ok(current);
  assert.ok(current.includes(evidence.sourceCommit));
  assert.ok(current.includes(`schema_migrations\` ${evidence.operating.databaseAfter.schemaMigrations}`));
  assert.ok(current.includes('deployment-db28003-2026-10-05.json'));
  assert.match(readme, /^\*\*이전 배포 상태.*0fcdfe8/m);
  assert.doesNotMatch(readme, /운영 전체 API·웹 배포 안전장치 \(후속 코드, 원격 미실행\)/);
});

test('원장 변경 릴리스는 migration 뒤 구 API 자동 복귀를 안내하지 않는다', () => {
  const readme = readFileSync(new URL('../../infra/lightsail/README.md', import.meta.url), 'utf8');
  const safety = readme.split('## 운영 전체 API·웹 배포 안전장치\n')[1]?.split('\n## ')[0];
  assert.ok(safety);
  assert.match(safety, /backward_compatible=no/);
  assert.match(safety, /FORWARD_RECOVERY_REQUIRED/);
  assert.match(safety, /migration 전에 .*API를 멈춘다/);
  assert.match(safety, /구 API.*자동.*복귀.*금지/);
});
