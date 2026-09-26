import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validateShowcaseHostCompose } from '../../scripts/verify-showcase-host.mjs';

const port = { target: 3000, published: '3301', host_ip: '127.0.0.1', protocol: 'tcp' };
const service = (extra) => ({ security_opt: ['no-new-privileges:true'], networks: { default: null }, ...extra });

function safeConfig() {
  const password = 'test-only-not-a-runtime-secret';
  const databaseUrl = 'postgresql://masscom_showcase@postgres:5432/masscom_showcase';
  return {
    name: 'masscom-showcase',
    services: {
      postgres: service({
        environment: { POSTGRES_DB: 'masscom_showcase', POSTGRES_USER: 'masscom_showcase', POSTGRES_PASSWORD: password },
        volumes: [{ type: 'volume', source: 'postgres_data', target: '/var/lib/postgresql/data', volume: {} }],
      }),
      migrate: service({
        image: 'masscom-showcase-api:local', read_only: true,
        environment: { DATABASE_URL: databaseUrl, PGPASSWORD: password },
        depends_on: { postgres: { condition: 'service_healthy' } },
      }),
      api: service({
        image: 'masscom-showcase-api:local', read_only: true,
        environment: {
          NODE_ENV: 'production', API_BIND_HOST: '0.0.0.0', PORT: '3000',
          DATABASE_URL: databaseUrl, PGPASSWORD: password,
          SHOWCASE_MODE: 'true', SHOWCASE_INVITED_SUBJECT_SHA256: 'a'.repeat(64),
          GOOGLE_OAUTH_CLIENT_IDS: '123-demo.apps.googleusercontent.com',
          ALLOW_INSECURE_DEMO_ACCOUNT: 'false', AUTH_TRUST_CADDY_FORWARDED_FOR: 'true',
          ACCOUNT_DELETION_HMAC_SECRET: 'test-deletion-secret-at-least-32-bytes',
          MERCHANT_REFERENCE_HMAC_SECRET: 'test-reference-secret-at-least-32-bytes',
          SIWE_DOMAIN: 'demo-api.masscom.kr', SIWE_URI: 'https://demo-api.masscom.kr/wallet/verify',
        },
        depends_on: { migrate: { condition: 'service_completed_successfully' } },
        ports: [structuredClone(port)],
        networks: { default: null, edge: { aliases: ['showcase-api'] } },
      }),
    },
    networks: {
      default: { name: 'masscom-showcase_default', ipam: {} },
      edge: { name: 'masscom_showcase_edge', external: true, ipam: {} },
    },
    volumes: { postgres_data: { name: 'masscom-showcase_postgres_data' } },
  };
}

test('independent hosted showcase config is accepted', () => {
  assert.doesNotThrow(() => validateShowcaseHostCompose(safeConfig()));
});

test('operating namespace, public ports, demo auth, and worker injection are refused', () => {
  const mutations = [
    (config) => { config.name = 'masscom'; },
    (config) => { config.volumes.postgres_data.name = 'masscom_postgres_data'; },
    (config) => { config.services.postgres.environment.POSTGRES_DB = 'masscom'; },
    (config) => { config.services.api.environment.DATABASE_URL = 'postgresql://masscom@postgres:5432/masscom'; },
    (config) => { config.services.api.ports[0].host_ip = '0.0.0.0'; },
    (config) => { config.services.postgres.ports = [{ target: 5432, published: '5432', host_ip: '0.0.0.0', protocol: 'tcp' }]; },
    (config) => { config.services.api.environment.ALLOW_INSECURE_DEMO_ACCOUNT = 'true'; },
    (config) => { config.services.api.environment.SHOWCASE_MODE = 'false'; },
    (config) => { config.services.api.environment.GOOGLE_OAUTH_CLIENT_IDS = ''; },
    (config) => { config.services.api.environment.SHOWCASE_INVITED_SUBJECT_SHA256 = ''; },
    (config) => { Reflect.set(config.services.api.environment, 'ACCOUNT_DELETION_HMAC_SECRET', 'short'); },
    (config) => { Reflect.set(config.services.api.environment, 'MERCHANT_REFERENCE_HMAC_SECRET', 'short'); },
    (config) => { Reflect.set(config.services.api.environment, 'MERCHANT_REFERENCE_HMAC_SECRET', config.services.api.environment.ACCOUNT_DELETION_HMAC_SECRET); },
    (config) => { config.services.worker = {}; },
    (config) => { config.networks.default.external = true; },
    (config) => { config.networks.edge.external = false; },
    (config) => { config.networks.edge.name = 'masscom_default'; },
    (config) => { config.networks.edge.ipam = { config: [{ subnet: '10.20.0.0/24' }] }; },
    (config) => { config.services.postgres.networks.edge = null; },
    (config) => { config.services.migrate.networks.edge = null; },
    (config) => { config.services.api.networks.edge.aliases = ['api']; },
    (config) => { config.services.api.environment.AUTH_TRUST_CADDY_FORWARDED_FOR = 'false'; },
    (config) => { config.services.api.networks = { operating: null }; },
    (config) => { config.services.postgres.volumes[0].type = 'bind'; },
  ];
  for (const mutate of mutations) {
    const config = safeConfig();
    mutate(config);
    assert.throws(() => validateShowcaseHostCompose(config), mutate.toString());
  }
});

test('known operating Google audience cannot be reused by the showcase', () => {
  const config = safeConfig();
  assert.throws(() => validateShowcaseHostCompose(config, {
    operatingGoogleClientId: '123-demo.apps.googleusercontent.com',
  }));
});
