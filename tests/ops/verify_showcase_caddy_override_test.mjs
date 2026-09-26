import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const candidate = resolve(root, 'infra/lightsail/Caddyfile');
const base = resolve(root, 'infra/lightsail/compose.yml');
const overlay = resolve(root, 'infra/showcase-host/caddy-override.yml');

test('Caddy-only overlay replaces only the config mount and joins only Caddy to showcase edge', () => {
  const rendered = JSON.parse(execFileSync('docker', [
    'compose', '-p', 'masscom', '-f', base, '-f', overlay, 'config', '--format', 'json',
  ], {
    cwd: root, encoding: 'utf8',
    env: {
      ...process.env,
      MASSCOM_SHOWCASE_CADDYFILE: candidate,
      POSTGRES_PASSWORD: 'test-only-postgres-password',
      GOOGLE_OAUTH_CLIENT_IDS: '123-operating.apps.googleusercontent.com',
      ACCOUNT_DELETION_HMAC_SECRET: 'a'.repeat(64),
      MERCHANT_REFERENCE_HMAC_SECRET: 'b'.repeat(64),
    },
  }));
  const services = rendered.services;
  const caddyMount = services.caddy.volumes.filter((mount) =>
    mount.target === '/etc/caddy/Caddyfile');
  assert.equal(caddyMount.length, 1);
  assert.equal(caddyMount[0].source, candidate);
  assert.equal(caddyMount[0].read_only, true);
  assert.equal(services.caddy.volumes.filter((mount) =>
    mount.target === '/srv/masscom').length, 1);
  assert.deepEqual(Object.keys(services.caddy.networks).sort(), ['default', 'showcase_edge']);
  for (const name of ['api', 'postgres', 'migrate', 'production-web']) {
    assert.deepEqual(Object.keys(services[name].networks), ['default'], name);
  }
  assert.equal(rendered.networks.showcase_edge.name, 'masscom_showcase_edge');
  assert.equal(rendered.networks.showcase_edge.external, true);
});
