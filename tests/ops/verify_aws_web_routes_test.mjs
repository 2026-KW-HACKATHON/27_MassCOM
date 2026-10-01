import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validateAwsWebCompose } from '../../scripts/verify-lightsail-web.mjs';

function safe() {
  return {
    name: 'masscom',
    services: {
      postgres: { networks: { default: null }, security_opt: ['no-new-privileges:true'] },
      migrate: { networks: { default: null } },
      api: { expose: ['3000'], networks: { default: null }, security_opt: ['no-new-privileges:true'] },
      'production-web': {
        image: 'masscom-production-web:local',
        expose: ['4173'], read_only: true,
        environment: { NODE_ENV: 'production', PORT: '4173', MASSCOM_WEB_BIND_HOST: '0.0.0.0' },
        networks: { default: null },
        security_opt: ['no-new-privileges:true'],
      },
      caddy: {
        ports: [{ target: 80, published: '80' }, { target: 443, published: '443' }],
        volumes: [
          { type: 'bind', source: '/release/infra/lightsail/Caddyfile', target: '/etc/caddy/Caddyfile', read_only: true },
          { type: 'bind', source: '/release/site/public', target: '/srv/masscom', read_only: true },
          { type: 'bind', source: '/opt/masscom-showcase/web/current', target: '/srv/showcase-web', read_only: true },
        ],
        networks: { default: null, showcase_edge: null },
        security_opt: ['no-new-privileges:true'],
      },
    },
    networks: {
      default: { name: 'masscom_default', ipam: {} },
      showcase_edge: { name: 'masscom_showcase_edge', external: true, ipam: {} },
    },
  };
}

test('web-only service does not publish a host port or mount operating data', () => {
  assert.doesNotThrow(() => validateAwsWebCompose(safe()));
  const mutations = [
    (config) => { config.services['production-web'].ports = [{ target: 4173, published: '4173' }]; },
    (config) => { config.services.postgres.ports = [{ target: 5432, published: '5432' }]; },
    (config) => { config.services.api.ports = [{ target: 3000, published: '3000' }]; },
    (config) => { config.services['production-web'].environment.DATABASE_URL = 'postgresql://operating-db'; },
    (config) => { config.services['production-web'].read_only = false; },
    (config) => { config.services.caddy.volumes[1].source = '/release/docs'; },
    (config) => { config.services.caddy.volumes[1].read_only = false; },
    (config) => { config.services.caddy.volumes.splice(1, 1); },
  ];
  for (const mutate of mutations) {
    const config = safe();
    mutate(config);
    assert.throws(() => validateAwsWebCompose(config), mutate.toString());
  }
});

test('#309 Caddy reads the showcase web bundle only read-only from the showcase directory', () => {
  const mutations = [
    (config) => { config.services.caddy.volumes[2].read_only = false; },
    (config) => { config.services.caddy.volumes[2].source = '/release/site/public'; },
    (config) => { config.services.caddy.volumes[2].source = '/opt/masscom/current'; },
    (config) => { config.services.caddy.volumes[2].source = '/opt/masscom-showcase/web/../../masscom'; },
    (config) => { config.services.caddy.volumes.splice(2, 1); },
    (config) => { config.services.caddy.volumes.push(structuredClone(config.services.caddy.volumes[2])); },
    (config) => { config.services.caddy.volumes[1].source = '/opt/masscom-showcase/web/current'; },
    (config) => { config.services.api.volumes = [{ type: 'bind', source: '/opt/masscom-showcase/web/current', target: '/srv' }]; },
  ];
  for (const mutate of mutations) {
    const config = safe();
    mutate(config);
    assert.throws(() => validateAwsWebCompose(config), mutate.toString());
  }
});

test('only Caddy joins the dedicated showcase edge network', () => {
  const mutations = [
    (config) => { config.networks.showcase_edge.external = false; },
    (config) => { config.networks.showcase_edge.name = 'masscom_default'; },
    (config) => { config.services.api.networks.showcase_edge = null; },
    (config) => { config.services.postgres.networks.showcase_edge = null; },
    (config) => { config.services['production-web'].networks.showcase_edge = null; },
    (config) => { delete config.services.caddy.networks.showcase_edge; },
  ];
  for (const mutate of mutations) {
    const config = safe();
    mutate(config);
    assert.throws(() => validateAwsWebCompose(config), mutate.toString());
  }
});
