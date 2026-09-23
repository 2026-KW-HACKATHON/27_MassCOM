import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateShowcaseCompose } from '../../scripts/verify-showcase-local.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const safePort = (target, published) => ({ target, published: String(published), host_ip: '127.0.0.1', protocol: 'tcp' });
const safeService = (extra = {}) => ({ security_opt: ['no-new-privileges:true'], ...extra });
const safe = () => ({
  name: 'masscom-showcase-local',
  services: {
    postgres: safeService({ environment: { POSTGRES_DB: 'masscom_showcase_test', POSTGRES_USER: 'masscom_showcase', POSTGRES_PASSWORD: 'test-only' }, ports: [safePort(5432, 55434)], volumes: [{ type: 'volume', source: 'postgres_data', target: '/var/lib/postgresql/data' }] }),
    migrate: safeService({ image: 'masscom-showcase-local-api:local', environment: { DATABASE_URL: 'postgresql://masscom_showcase@postgres:5432/masscom_showcase_test', PGPASSWORD: 'test-only' }, depends_on: { postgres: { condition: 'service_healthy' } }, read_only: true }),
    api: safeService({ image: 'masscom-showcase-local-api:local', build: { context: repoRoot, dockerfile: 'infra/lightsail/api.Dockerfile' }, environment: { NODE_ENV: 'production', PORT: '3000', SIWE_DOMAIN: 'demo-api.masscom.local', SIWE_URI: 'https://demo-api.masscom.local/wallet/verify', DATABASE_URL: 'postgresql://masscom_showcase@postgres:5432/masscom_showcase_test', PGPASSWORD: 'test-only', API_BIND_HOST: '0.0.0.0', ALLOW_INSECURE_DEMO_ACCOUNT: 'false', GOOGLE_OAUTH_CLIENT_IDS: '', AUTH_TRUST_CADDY_FORWARDED_FOR: 'false' }, depends_on: { migrate: { condition: 'service_completed_successfully' } }, ports: [safePort(3000, 3301)], read_only: true }),
  },
  networks: { default: { name: 'masscom-showcase-local_default' } },
  volumes: { postgres_data: { name: 'masscom-showcase-local_postgres_data' } },
});

test('isolated local showcase configuration is accepted', () => {
  assert.doesNotThrow(() => validateShowcaseCompose(safe()));
});

test('production namespace, auth, public ports, and extra services are rejected', () => {
  const mutations = [
    (config) => { config.name = 'masscom'; },
    (config) => { config.volumes.postgres_data.name = 'masscom_postgres_data'; },
    (config) => { config.services.api.environment.DATABASE_URL = 'postgresql://masscom:pw@postgres:5432/masscom'; },
    (config) => { config.services.api.environment.ALLOW_INSECURE_DEMO_ACCOUNT = 'true'; },
    (config) => { config.services.api.environment.GOOGLE_OAUTH_CLIENT_IDS = 'prod-client'; },
    (config) => { config.services.api.environment.AUTH_TRUST_CADDY_FORWARDED_FOR = 'true'; },
    (config) => { config.services.api.ports[0].host_ip = '0.0.0.0'; },
    (config) => { config.services.postgres.ports[0].published = '5432'; },
    (config) => { config.services.postgres.environment.POSTGRES_HOST_AUTH_METHOD = 'trust'; },
    (config) => { config.services.migrate.environment.DATABASE_URL = 'postgresql://masscom:pw@postgres:5432/masscom'; },
    (config) => { config.services.api.environment.PGPASSWORD = 'different'; },
    (config) => { config.services.api.environment.DATABASE_URL = 'postgresql://masscom_showcase:pw@postgres:5432/masscom_showcase_test'; },
    (config) => { config.services.api.environment.DATABASE_URL += '?host=production-db'; },
    (config) => { config.services.api.build.dockerfile = 'unreviewed.Dockerfile'; },
    (config) => { config.services.api.privileged = true; },
    (config) => { config.services.api.network_mode = 'service:postgres'; },
    (config) => { config.services.api.depends_on = {}; },
    (config) => { config.services.worker = {}; },
    (config) => { config.networks.default.external = true; },
  ];
  for (const mutate of mutations) {
    const config = safe();
    mutate(config);
    assert.throws(() => validateShowcaseCompose(config), mutate.toString());
  }
});
