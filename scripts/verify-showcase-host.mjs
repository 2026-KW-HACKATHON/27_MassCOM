#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const invalid = () => { throw new Error('SHOWCASE_HOST_BOUNDARY_INVALID'); };
const requireSafe = (condition) => { if (!condition) invalid(); };
const keysAre = (value, expected) =>
  value && Object.keys(value).sort().join(',') === [...expected].sort().join(',');

export function validateShowcaseHostCompose(config, options = {}) {
  requireSafe(config?.name === 'masscom-showcase');
  requireSafe(keysAre(config.services, ['api', 'migrate', 'postgres']));
  requireSafe(keysAre(config.networks, ['default']));
  requireSafe(config.networks.default.name === 'masscom-showcase_default');
  requireSafe(config.networks.default.external !== true);
  requireSafe(keysAre(config.volumes, ['postgres_data']));
  requireSafe(config.volumes.postgres_data.name === 'masscom-showcase_postgres_data');
  requireSafe(!config.volumes.postgres_data.driver_opts);

  const { api, migrate, postgres } = config.services;
  for (const entry of [api, migrate, postgres]) {
    requireSafe(entry.security_opt?.includes('no-new-privileges:true'));
    requireSafe(keysAre(entry.networks, ['default']));
    requireSafe(!entry.network_mode && !entry.privileged && !entry.volumes_from);
    requireSafe(!entry.links && !entry.external_links && !entry.extra_hosts);
  }
  requireSafe(api.read_only === true && migrate.read_only === true);
  requireSafe((postgres.ports ?? []).length === 0 && (migrate.ports ?? []).length === 0);
  requireSafe(api.ports?.length === 1);
  const [apiPort] = api.ports;
  requireSafe(apiPort.host_ip === '127.0.0.1' && Number(apiPort.published) === 3301);
  requireSafe(Number(apiPort.target) === 3000 && apiPort.protocol === 'tcp');
  requireSafe(postgres.environment?.POSTGRES_DB === 'masscom_showcase');
  requireSafe(postgres.environment?.POSTGRES_USER === 'masscom_showcase');
  requireSafe(Boolean(postgres.environment?.POSTGRES_PASSWORD));
  requireSafe(postgres.environment?.POSTGRES_HOST_AUTH_METHOD !== 'trust');
  requireSafe(postgres.volumes?.length === 1);
  requireSafe(postgres.volumes[0].type === 'volume' &&
    postgres.volumes[0].source === 'postgres_data' &&
    postgres.volumes[0].target === '/var/lib/postgresql/data');
  requireSafe((api.volumes ?? []).length === 0 && (migrate.volumes ?? []).length === 0);
  requireSafe(migrate.depends_on?.postgres?.condition === 'service_healthy');
  requireSafe(api.depends_on?.migrate?.condition === 'service_completed_successfully');
  requireSafe(/^masscom-showcase-api:(local|[0-9a-f]{7,40})$/.test(api.image ?? ''));
  requireSafe(migrate.image === api.image);

  const dbUrl = api.environment?.DATABASE_URL;
  requireSafe(dbUrl === migrate.environment?.DATABASE_URL);
  try {
    const url = new URL(dbUrl);
    requireSafe(url.protocol === 'postgresql:' && url.hostname === 'postgres' && url.port === '5432');
    requireSafe(url.pathname === '/masscom_showcase' && url.username === 'masscom_showcase');
    requireSafe(!url.password && !url.search && !url.hash);
  } catch {
    invalid();
  }
  const password = postgres.environment.POSTGRES_PASSWORD;
  requireSafe(Object.is(api.environment?.PGPASSWORD, password) &&
    Object.is(migrate.environment?.PGPASSWORD, password));
  requireSafe(api.environment?.NODE_ENV === 'production');
  requireSafe(api.environment?.API_BIND_HOST === '0.0.0.0' && api.environment?.PORT === '3000');
  requireSafe(api.environment?.SHOWCASE_MODE === 'true');
  requireSafe(api.environment?.ALLOW_INSECURE_DEMO_ACCOUNT === 'false');
  requireSafe(api.environment?.AUTH_TRUST_CADDY_FORWARDED_FOR === 'false');
  requireSafe(api.environment?.SIWE_DOMAIN === 'demo-api.masscom.kr');
  requireSafe(api.environment?.SIWE_URI === 'https://demo-api.masscom.kr/wallet/verify');
  const audience = api.environment?.GOOGLE_OAUTH_CLIENT_IDS;
  requireSafe(/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(audience ?? ''));
  requireSafe(!options.operatingGoogleClientId || audience !== options.operatingGoogleClientId);
  requireSafe((api.environment?.SHOWCASE_INVITED_SUBJECT_SHA256 ?? '').split(',')
    .every((value) => /^[0-9a-f]{64}$/.test(value)));
  requireSafe(Buffer.byteLength(api.environment?.ACCOUNT_DELETION_HMAC_SECRET ?? '') >= 32);
  requireSafe(Buffer.byteLength(api.environment?.MERCHANT_REFERENCE_HMAC_SECRET ?? '') >= 32);
  requireSafe(api.environment.ACCOUNT_DELETION_HMAC_SECRET !== api.environment.MERCHANT_REFERENCE_HMAC_SECRET);
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const live = process.argv[2] === '--runtime-env';
  const compose = resolve(repoRoot, 'infra/showcase-host/compose.yml');
  const environment = live ? process.env : {
    ...process.env,
    SHOWCASE_HOST_POSTGRES_PASSWORD: 'test-only-postgres-password',
    SHOWCASE_GOOGLE_WEB_CLIENT_ID: '123-demo.apps.googleusercontent.com',
    SHOWCASE_INVITED_SUBJECT_SHA256: 'a'.repeat(64),
    SHOWCASE_ACCOUNT_DELETION_HMAC_SECRET: 'test-only-deletion-secret-at-least-32-bytes',
    SHOWCASE_MERCHANT_REFERENCE_HMAC_SECRET: 'test-only-reference-secret-at-least-32-bytes',
  };
  try {
    const operatingGoogleClientId = process.env.MASSCOM_OPERATING_GOOGLE_WEB_CLIENT_ID;
    if (live && !operatingGoogleClientId) invalid();
    const args = ['compose'];
    if (live) {
      if (!process.argv[3]) invalid();
      args.push('--env-file', resolve(process.argv[3]));
    }
    args.push('-f', compose, 'config', '--format', 'json');
    const rendered = execFileSync('docker', args, {
      cwd: repoRoot, env: environment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    validateShowcaseHostCompose(JSON.parse(rendered), { operatingGoogleClientId });
    console.log(live ? 'showcase host runtime boundary verified (not deployed)'
      : 'isolated showcase host Compose boundary verified (deployment not performed)');
  } catch {
    console.error('SHOWCASE_HOST_BOUNDARY_INVALID');
    process.exitCode = 1;
  }
}
