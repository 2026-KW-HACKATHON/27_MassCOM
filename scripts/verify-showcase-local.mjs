#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function validateShowcaseCompose(config) {
  assert.equal(config.name, 'masscom-showcase-local');
  assert.deepEqual(Object.keys(config.services ?? {}).sort(), ['api', 'migrate', 'postgres']);
  assert.deepEqual(Object.keys(config.networks ?? {}), ['default']);
  assert.equal(config.networks.default.name, 'masscom-showcase-local_default');
  assert.notEqual(config.networks.default.external, true);
  assert.deepEqual(Object.keys(config.volumes ?? {}), ['postgres_data']);
  assert.equal(config.volumes.postgres_data.name, 'masscom-showcase-local_postgres_data');
  assert.notEqual(config.volumes.postgres_data.external, true);

  const { postgres, migrate, api } = config.services;
  assert.equal(postgres.environment.POSTGRES_DB, 'masscom_showcase_test');
  assert.equal(postgres.environment.POSTGRES_USER, 'masscom_showcase');
  assert.ok(postgres.environment.POSTGRES_PASSWORD);
  assert.deepEqual(Object.keys(postgres.environment).sort(), [
    'POSTGRES_DB', 'POSTGRES_PASSWORD', 'POSTGRES_USER',
  ]);
  assert.deepEqual((postgres.volumes ?? []).map(({ source, target }) => [source, target]), [
    ['postgres_data', '/var/lib/postgresql/data'],
  ]);
  assert.deepEqual((migrate.ports ?? []), []);
  assert.deepEqual((migrate.volumes ?? []), []);
  assert.deepEqual((api.volumes ?? []), []);
  assertPort(postgres, 5432, 55434);
  assertPort(api, 3000, 3301);
  assertDatabaseUrl(migrate.environment.DATABASE_URL);
  assertDatabaseUrl(api.environment.DATABASE_URL);
  assert.deepEqual(Object.keys(migrate.environment).sort(), ['DATABASE_URL', 'PGPASSWORD']);
  assert.equal(migrate.environment.DATABASE_URL, api.environment.DATABASE_URL);
  assert.equal(migrate.environment.PGPASSWORD, postgres.environment.POSTGRES_PASSWORD);
  assert.equal(api.environment.PGPASSWORD, postgres.environment.POSTGRES_PASSWORD);
  assert.equal(migrate.depends_on?.postgres?.condition, 'service_healthy');
  assert.equal(api.depends_on?.migrate?.condition, 'service_completed_successfully');
  assert.equal(api.environment.API_BIND_HOST, '0.0.0.0');
  assert.equal(api.environment.GOOGLE_OAUTH_CLIENT_IDS, '');
  assert.equal(api.environment.ALLOW_INSECURE_DEMO_ACCOUNT, 'false');
  assert.equal(api.environment.AUTH_TRUST_CADDY_FORWARDED_FOR, 'false');
  assert.deepEqual(Object.keys(api.environment).sort(), [
    'ALLOW_INSECURE_DEMO_ACCOUNT', 'API_BIND_HOST', 'AUTH_TRUST_CADDY_FORWARDED_FOR',
    'DATABASE_URL', 'GOOGLE_OAUTH_CLIENT_IDS', 'NODE_ENV', 'PGPASSWORD', 'PORT', 'SIWE_DOMAIN', 'SIWE_URI',
  ].sort());
  for (const service of [postgres, migrate, api]) {
    assert.ok((service.security_opt ?? []).includes('no-new-privileges:true'));
    assert.equal(service.network_mode, undefined);
    assert.notEqual(service.privileged, true);
  }
  assert.equal(api.read_only, true);
  assert.equal(migrate.read_only, true);
  assert.equal(api.image, 'masscom-showcase-local-api:local');
  assert.equal(migrate.image, 'masscom-showcase-local-api:local');
  assert.equal(api.build?.context, repoRoot);
  assert.equal(api.build?.dockerfile, 'infra/lightsail/api.Dockerfile');
}

function assertPort(service, target, published) {
  assert.equal((service.ports ?? []).length, 1);
  const [port] = service.ports;
  assert.equal(Number(port.target), target);
  assert.equal(Number(port.published), published);
  assert.equal(port.host_ip, '127.0.0.1');
  assert.equal(port.protocol, 'tcp');
}

function assertDatabaseUrl(value) {
  const url = new URL(value);
  assert.equal(url.protocol, 'postgresql:');
  assert.equal(url.hostname, 'postgres');
  assert.equal(url.port, '5432');
  assert.equal(url.pathname, '/masscom_showcase_test');
  assert.equal(url.search, '');
  assert.equal(url.hash, '');
  assert.equal(decodeURIComponent(url.username), 'masscom_showcase');
  assert.equal(url.password, '');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const composePath = resolve(process.argv[2] ?? resolve(repoRoot, 'infra/showcase-local/compose.yml'));
  const rendered = execFileSync(
    'docker', ['compose', '-f', composePath, 'config', '--format', 'json'],
    { cwd: repoRoot, encoding: 'utf8', env: { ...process.env, SHOWCASE_LOCAL_POSTGRES_PASSWORD: 'local-verification-only' } },
  );
  validateShowcaseCompose(JSON.parse(rendered));
  const dockerfile = readFileSync(resolve(repoRoot, 'infra/lightsail/api.Dockerfile'), 'utf8');
  assert.match(dockerfile, /^USER node$/m);
  console.log('local showcase Compose boundary verified');
}
