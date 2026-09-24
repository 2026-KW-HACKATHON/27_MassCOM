import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

const repoRoot = resolve(import.meta.dirname, '../..');
const fixture = `const { createServer } = require('node:http');
createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/api/web/auth/start') {
    response.writeHead(302, {
      Location: '/app/',
      'Set-Cookie': 'web_auth_state=fixture; Path=/api/web/auth; HttpOnly; Secure; SameSite=Lax',
    });
  } else if (request.url === '/api/web/auth/callback?code=fixture') {
    response.writeHead(303, {
      Location: '/app/',
      'Set-Cookie': 'web_session=fixture; Path=/api/web; HttpOnly; Secure; SameSite=Lax',
    });
  } else if (request.url === '/api/web/collection') {
    response.writeHead(401);
  } else if (request.url === '/api/web/logout') {
    response.writeHead(204);
  } else {
    response.writeHead(200);
  }
  response.end();
}).listen(3000, '0.0.0.0');`;

function docker(...args) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolvePort(address.port));
    });
  });
}

test('Caddy forwards only the four browser-session routes, preserving redirects and cookies', async () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const network = `masscom-web-proxy-test-${suffix}`;
  const api = `masscom-web-api-test-${suffix}`;
  const caddy = `masscom-web-caddy-test-${suffix}`;
  const publicRoot = mkdtempSync(resolve(tmpdir(), 'masscom-web-proxy-'));
  const port = await freePort();
  docker('network', 'create', network);
  try {
    docker('run', '-d', '--rm', '--network', network, '--network-alias', 'api', '--name', api,
      'node:24-alpine', 'node', '-e', fixture);
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        docker('exec', api, 'node', '-e',
          "fetch('http://127.0.0.1:3000/').then(() => process.exit(0)).catch(() => process.exit(1))");
        break;
      } catch {
        if (attempt === 29) throw new Error('API fixture did not become ready');
        await new Promise((resolveWait) => setTimeout(resolveWait, 200));
      }
    }
    docker('run', '-d', '--rm', '--network', network, '--name', caddy,
      '-p', `127.0.0.1:${port}:8080`,
      '-e', 'MASSCOM_API_DOMAIN=:8081', '-e', 'MASSCOM_WEB_DOMAIN=:8080',
      '-v', `${resolve(repoRoot, 'infra/lightsail/Caddyfile')}:/etc/caddy/Caddyfile:ro`,
      '-v', `${publicRoot}:/srv/masscom:ro`, 'caddy:2.10.2-alpine');

    const url = `http://127.0.0.1:${port}`;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        await fetch(`${url}/`, { signal: AbortSignal.timeout(1000) });
        break;
      } catch {
        if (attempt === 29) throw new Error('Caddy fixture did not become ready');
        await new Promise((resolveWait) => setTimeout(resolveWait, 200));
      }
    }

    const start = await fetch(`${url}/api/web/auth/start`, { redirect: 'manual' });
    assert.equal(start.status, 302);
    assert.equal(start.headers.get('location'), '/app/');
    assert.match(start.headers.get('set-cookie') ?? '', /HttpOnly; Secure; SameSite=Lax/);
    assert.equal(start.headers.get('cache-control'), 'no-store');

    const callback = await fetch(`${url}/api/web/auth/callback?code=fixture`, { redirect: 'manual' });
    assert.equal(callback.status, 303);
    assert.equal(callback.headers.get('location'), '/app/');
    assert.match(callback.headers.get('set-cookie') ?? '', /web_session=fixture/);

    const collection = await fetch(`${url}/api/web/collection`);
    assert.equal(collection.status, 401);
    assert.equal(collection.headers.get('cache-control'), 'no-store');
    assert.equal((await fetch(`${url}/api/web/logout`, { method: 'POST' })).status, 204);

    for (const path of ['/api/web/unknown', '/api/claim', '/api/mint']) {
      assert.equal((await fetch(`${url}${path}`)).status, 404, path);
    }
  } finally {
    docker('rm', '-f', caddy, api);
    docker('network', 'rm', network);
    rmSync(publicRoot, { recursive: true, force: true });
  }
});
