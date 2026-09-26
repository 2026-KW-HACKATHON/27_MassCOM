import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const overlay = resolve(root, 'infra/showcase-host/caddy-override.yml');

test('Caddy-only overlay replaces an old config mount without changing operating services', (t) => {
  const scratch = mkdtempSync(join(tmpdir(), 'masscom-old-caddy-'));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const oldCaddyfile = join(scratch, 'old-Caddyfile');
  const candidate = join(scratch, 'candidate-Caddyfile');
  const site = join(scratch, 'site');
  mkdirSync(site);
  writeFileSync(oldCaddyfile, 'old operating config\n');
  writeFileSync(candidate, 'new showcase config\n');
  const base = join(scratch, 'old-operating.compose.yml');
  writeFileSync(base, `name: masscom
services:
  api:
    image: node:22-alpine
  postgres:
    image: postgres:16-alpine
  migrate:
    image: node:22-alpine
  production-web:
    image: node:22-alpine
  caddy:
    image: caddy:2.10.2-alpine
    environment:
      MASSCOM_API_DOMAIN: api.masscom.kr
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ${oldCaddyfile}:/etc/caddy/Caddyfile:ro
      - ${site}:/srv/masscom:ro
    networks:
      - default
`);

  const render = (...files) => JSON.parse(execFileSync('docker', [
    'compose', '-p', 'masscom', ...files.flatMap((file) => ['-f', file]),
    'config', '--format', 'json',
  ], {
    cwd: root, encoding: 'utf8',
    env: { ...process.env, MASSCOM_SHOWCASE_CADDYFILE: candidate },
  }));
  const before = render(base);
  const after = render(base, overlay);
  assert.equal(before.services.caddy.volumes.find((mount) =>
    mount.target === '/etc/caddy/Caddyfile').source, oldCaddyfile);
  assert.notEqual(oldCaddyfile, candidate);

  const mounts = after.services.caddy.volumes;
  assert.equal(mounts.filter((mount) => mount.target === '/etc/caddy/Caddyfile').length, 1);
  assert.equal(mounts.find((mount) => mount.target === '/etc/caddy/Caddyfile').source, candidate);
  assert.equal(mounts.find((mount) => mount.target === '/etc/caddy/Caddyfile').read_only, true);
  assert.equal(mounts.filter((mount) => mount.target === '/srv/masscom').length, 1);
  assert.deepEqual(mounts.find((mount) => mount.target === '/srv/masscom'),
    before.services.caddy.volumes.find((mount) => mount.target === '/srv/masscom'));
  assert.deepEqual(Object.keys(after.services.caddy.networks).sort(), ['default', 'showcase_edge']);
  for (const name of ['api', 'postgres', 'migrate', 'production-web']) {
    assert.deepEqual(after.services[name], before.services[name], name);
  }
  for (const field of ['image', 'environment', 'ports', 'security_opt']) {
    assert.deepEqual(after.services.caddy[field], before.services.caddy[field], field);
  }
  assert.equal(after.networks.showcase_edge.name, 'masscom_showcase_edge');
  assert.equal(after.networks.showcase_edge.external, true);
});
