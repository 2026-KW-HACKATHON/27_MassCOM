#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const composePath = resolve(process.argv[2] ?? resolve(repoRoot, 'infra/lightsail/compose.yml'));
const caddyPath = resolve(process.argv[3] ?? resolve(repoRoot, 'infra/lightsail/Caddyfile'));
const dockerfilePath = resolve(
  process.argv[4] ?? resolve(repoRoot, 'infra/lightsail/api.Dockerfile'),
);

const scratch = await mkdtemp(resolve(tmpdir(), 'masscom-compose-'));
try {
  const environmentPath = resolve(scratch, 'runtime.env');
  const environmentLine = (name, value) => `${name}=${value}`;
  writeFileSync(
    environmentPath,
    [
      environmentLine('MASSCOM_API_DOMAIN', 'api.masscom.kr'),
      environmentLine('MASSCOM_IMAGE_TAG', 'verification'),
      environmentLine('POSTGRES_PASSWORD', '0123456789abcdef0123456789abcdef'),
      environmentLine('GOOGLE_OAUTH_CLIENT_IDS', '1234567890-test.apps.googleusercontent.com'),
      environmentLine('ACCOUNT_DELETION_HMAC_SECRET', 'a'.repeat(64)),
      environmentLine('MERCHANT_REFERENCE_HMAC_SECRET', 'b'.repeat(64)),
      '',
    ].join('\n'),
  );

  const rendered = execFileSync(
    'docker',
    ['compose', '--env-file', environmentPath, '-f', composePath, 'config', '--format', 'json'],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  const compose = JSON.parse(rendered);
  const services = compose.services ?? {};
  for (const name of ['postgres', 'migrate', 'api', 'caddy']) {
    assert(services[name], `missing ${name} service`);
  }

  assert(!services.postgres.ports, 'PostgreSQL must not publish a host port');
  assert(!services.api.ports, 'API must only be reachable through Caddy');
  assert(
    (services.api.expose ?? []).map(String).includes('3000'),
    'API must expose port 3000 to the internal Compose network',
  );
  assert(services.api.environment?.API_BIND_HOST === '0.0.0.0', 'API container must bind 0.0.0.0');
  assert(
    services.api.environment?.AUTH_TRUST_CADDY_FORWARDED_FOR === 'true',
    'API must separate login limits by Caddy client IP',
  );
  assert(
    services.api.environment?.ALLOW_INSECURE_DEMO_ACCOUNT !== 'true',
    'production deployment must reject the insecure DEMO account header',
  );
  assert(
    String(services.api.environment?.DATABASE_URL ?? '').includes('@postgres:5432/masscom'),
    'API database URL must use the private postgres service',
  );
  assert(services.api.read_only === true, 'API root filesystem must be read-only');
  assert(hasNoNewPrivileges(services.api), 'API must set no-new-privileges');
  assert(hasNoNewPrivileges(services.postgres), 'PostgreSQL must set no-new-privileges');
  assert(hasNoNewPrivileges(services.caddy), 'Caddy must set no-new-privileges');

  const publishedPorts = (services.caddy.ports ?? []).map((port) => Number(port.published));
  assert(publishedPorts.includes(80), 'Caddy must publish HTTP for ACME redirects');
  assert(publishedPorts.includes(443), 'Caddy must publish HTTPS');

  const caddyfile = readFileSync(caddyPath, 'utf8');
  assert(caddyfile.includes('{$MASSCOM_API_DOMAIN:api.masscom.kr}'), 'Caddy must use api.masscom.kr');
  assert(caddyfile.includes('reverse_proxy api:3000'), 'Caddy must only proxy the API service');
  assert(
    /^\s*header_up X-Forwarded-For \{remote_host\}\s*$/m.test(caddyfile),
    'Caddy must overwrite incoming client IP chains before proxying',
  );
  assert(!caddyfile.includes('postgres:5432'), 'Caddy must never proxy PostgreSQL');

  const dockerfile = readFileSync(dockerfilePath, 'utf8');
  assert(/^USER node$/m.test(dockerfile), 'runtime image must drop root privileges');
  assert(/npm ci --omit=dev/.test(dockerfile), 'runtime image must install production dependencies only');

  console.log('Lightsail deployment configuration verified');
} finally {
  await rm(scratch, { recursive: true, force: true });
}

function hasNoNewPrivileges(service) {
  return (service.security_opt ?? []).includes('no-new-privileges:true');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
