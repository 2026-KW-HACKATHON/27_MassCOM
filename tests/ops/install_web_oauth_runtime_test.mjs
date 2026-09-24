import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const installer = fileURLToPath(new URL('../../scripts/install-web-oauth-runtime.mjs', import.meta.url));
const sampleSecret = 'GOCSPX-1234567890-example-only';

function withPrivateEnv(run) {
  const directory = mkdtempSync(join(tmpdir(), 'masscom-web-oauth-test-'));
  const envFile = join(directory, 'runtime.env');
  writeFileSync(envFile, 'POSTGRES_PASSWORD=example-only\n', { mode: 0o600 });
  try { run(envFile); } finally { rmSync(directory, { recursive: true, force: true }); }
}

function invoke(envFile, secret = sampleSecret) {
  return spawnSync(process.execPath, [installer, envFile], { input: `${secret}\n`, encoding: 'utf8' });
}

test('installs only the expected web OAuth tuple in a private runtime file', () => withPrivateEnv((envFile) => {
  const result = invoke(envFile);
  assert.equal(result.status, 0, result.stderr);
  const content = readFileSync(envFile, 'utf8');
  assert.match(content, /^POSTGRES_PASSWORD=example-only$/m);
  assert.match(content, /^GOOGLE_WEB_CLIENT_ID=172380658768-n5r2vad5f2g6ndb9kh2cbcig1j9i792g.apps.googleusercontent.com$/m);
  assert.match(content, /^GOOGLE_WEB_CLIENT_SECRET=GOCSPX-1234567890-example-only$/m);
  assert.match(content, /^GOOGLE_WEB_REDIRECT_URI=https:\/\/masscom.kr\/api\/web\/auth\/callback$/m);
  assert.equal(statSync(envFile).mode & 0o777, 0o600);
  assert.equal((result.stdout + result.stderr).includes(sampleSecret), false);
}));

test('rejects repeated installation without changing the first secret', () => withPrivateEnv((envFile) => {
  assert.equal(invoke(envFile).status, 0);
  const before = readFileSync(envFile, 'utf8');
  const repeated = invoke(envFile, 'GOCSPX-another-example-only');
  assert.equal(repeated.status, 1);
  assert.equal(readFileSync(envFile, 'utf8'), before);
  assert.equal((repeated.stdout + repeated.stderr).includes('GOCSPX-another-example-only'), false);
}));

test('rejects unsafe permissions and multiline clipboard content', () => withPrivateEnv((envFile) => {
  const before = readFileSync(envFile, 'utf8');
  assert.equal(invoke(envFile, `${sampleSecret}\nINJECTED=1`).status, 1);
  assert.equal(readFileSync(envFile, 'utf8'), before);
  chmodSync(envFile, 0o644);
  assert.equal(invoke(envFile).status, 1);
  assert.equal(readFileSync(envFile, 'utf8'), before);
}));
