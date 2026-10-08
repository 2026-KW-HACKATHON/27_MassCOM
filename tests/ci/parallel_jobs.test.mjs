import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const root = new URL('../../', import.meta.url);
const workflow = readFileSync(new URL('.github/workflows/ci.yml', root), 'utf8');
const jobs = Object.fromEntries([...workflow.matchAll(/^  ([\w-]+):\n([\s\S]*?)(?=^  [\w-]+:|$(?![\s\S]))/gm)]
  .map(([, name, body]) => [name, body]));

function runBlock(job, name) {
  const step = jobs[job].split('      - name: ').find((part) => part.startsWith(`${name}\n`));
  assert.ok(step, `${job}: ${name}`);
  return step.match(/        run: \|\n((?:          .*\n|\n)+)/)[1].replace(/^          /gm, '');
}

test('PostgreSQL shards execute every integration file once, in deterministic serial order', () => {
  assert.match(jobs['api-postgres'], /fail-fast: false/);
  assert.match(jobs['api-postgres'], /shard: \[0, 1\]/);
  assert.match(jobs['api-postgres'], /SHARD_INDEX: \$\{\{ matrix.shard \}\}/);
  assert.match(jobs['api-postgres'], /npm run db:migrate --prefix apps\/api/);
  const files = readdirSync(new URL('apps/api/src/', root), { recursive: true })
    .filter((file) => file.endsWith('.postgres.integration.ts'))
    .map((file) => `src/${file}`).sort();
  assert.ok(files.length >= 2);
  const scratch = mkdtempSync(join(tmpdir(), 'masscom-ci-shards-'));
  try {
    const api = join(scratch, 'apps/api');
    mkdirSync(join(api, 'node_modules/.bin'), { recursive: true });
    for (const file of files) {
      mkdirSync(join(api, file, '..'), { recursive: true });
      writeFileSync(join(api, file), '');
    }
    writeFileSync(join(api, 'node_modules/.bin/tsx'),
      `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(process.env.CAPTURE, JSON.stringify(process.argv.slice(2)));\n`,
      { mode: 0o755 });
    const seen = [];
    for (const shard of [0, 1]) {
      const capture = join(scratch, `shard-${shard}.json`);
      const result = spawnSync('bash', ['-euo', 'pipefail', '-c', runBlock('api-postgres', 'API PostgreSQL 샤드 시험')], {
        cwd: scratch, env: { ...process.env, SHARD_INDEX: String(shard), CAPTURE: capture }, encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stderr);
      const args = JSON.parse(readFileSync(capture, 'utf8'));
      assert.deepEqual(args.slice(0, 2), ['--test', '--test-concurrency=1']);
      assert.deepEqual(args.slice(2), files.filter((_, index) => index % 2 === shard));
      seen.push(...args.slice(2));
    }
    assert.deepEqual(seen.sort(), files);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('required bootstrap-contract status rejects failed, cancelled and skipped dependencies', () => {
  const needs = ['api', 'api-postgres', 'mobile', 'web-ops-docs', 'contracts-worker'];
  assert.match(jobs['bootstrap-contract'], /if: \$\{\{ always\(\) \}\}/);
  assert.deepEqual(jobs['bootstrap-contract'].match(/needs: \[([^\]]+)\]/)[1].split(', '), needs);
  assert.match(jobs['bootstrap-contract'], /NEEDS_RESULTS: \$\{\{ toJSON\(needs\) \}\}/);
  const run = (results) => spawnSync('bash', ['-e', '-c', runBlock('bootstrap-contract', '모든 CI 작업 결과 확인')], {
    env: { ...process.env, NEEDS_RESULTS: JSON.stringify(results) }, encoding: 'utf8',
  }).status;
  const success = Object.fromEntries(needs.map((job) => [job, { result: 'success' }]));
  assert.equal(run(success), 0);
  for (const job of needs) {
    for (const result of ['failure', 'cancelled', 'skipped']) {
      assert.equal(run({ ...success, [job]: { result } }), 1, `${job}: ${result}`);
    }
  }
});
