import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

// Issue #253: 컨테이너 로그는 용량 기준으로 순환한다. 두 compose를 실제로 렌더해 서비스별 logging을 확인한다.
const repoRoot = resolve(import.meta.dirname, '../..');
const expectedLogging = { driver: 'json-file', options: { 'max-file': '3', 'max-size': '10m' } };

function render(file, env) {
  const rendered = execFileSync('docker', ['compose', '-f', resolve(repoRoot, file), 'config', '--format', 'json'], {
    cwd: repoRoot, encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(rendered).services;
}

const production = () => render('infra/lightsail/compose.yml', {
  POSTGRES_PASSWORD: 'test-only-postgres-password',
  GOOGLE_OAUTH_CLIENT_IDS: '123-test.apps.googleusercontent.com',
  ACCOUNT_DELETION_HMAC_SECRET: 'a'.repeat(64),
  MERCHANT_REFERENCE_HMAC_SECRET: 'b'.repeat(64),
});
const showcase = () => render('infra/showcase-host/compose.yml', {
  SHOWCASE_HOST_POSTGRES_PASSWORD: 'test-only-postgres-password',
  SHOWCASE_GOOGLE_WEB_CLIENT_ID: '123-demo.apps.googleusercontent.com',
  SHOWCASE_INVITED_SUBJECT_SHA256: 'a'.repeat(64),
  SHOWCASE_ACCOUNT_DELETION_HMAC_SECRET: 'test-only-deletion-secret-at-least-32-bytes',
  SHOWCASE_MERCHANT_REFERENCE_HMAC_SECRET: 'test-only-reference-secret-at-least-32-bytes',
});

test('operating stack: postgres, api, web and caddy rotate their logs by size', () => {
  const services = production();
  for (const name of ['postgres', 'api', 'production-web', 'caddy']) {
    assert.deepEqual(services[name].logging, expectedLogging, name);
  }
});

test('showcase stack: postgres and the showcase API rotate their logs by size', () => {
  const services = showcase();
  for (const name of ['postgres', 'showcase-api']) {
    assert.deepEqual(services[name].logging, expectedLogging, name);
  }
});

test('every long-running service in both stacks has the size limit, so a new service cannot skip it', () => {
  for (const services of [production(), showcase()]) {
    for (const [name, service] of Object.entries(services)) {
      if (name === 'migrate') continue; // one-shot container removed by `run --rm`
      assert.deepEqual(service.logging, expectedLogging, name);
    }
  }
});

test('the bound is a size, not a promise about time: the files say so and no compose sets a time limit', () => {
  for (const file of ['infra/lightsail/compose.yml', 'infra/showcase-host/compose.yml']) {
    const source = readFileSync(resolve(repoRoot, file), 'utf8');
    assert.match(source, /시간 기준 삭제는 아니다/, file);
    assert.doesNotMatch(source, /max-age|days|3개월/, file);
  }
});
