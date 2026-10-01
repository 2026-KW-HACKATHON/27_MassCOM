import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { showcaseWebCsp } from '../../scripts/verify-showcase-edge-routes.mjs';

const repoRoot = resolve(import.meta.dirname, '../..');
const fixture = `const { createServer } = require('node:http');
createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({ source: process.env.SOURCE, forwardedFor: request.headers['x-forwarded-for'] }));
}).listen(3000, '0.0.0.0');`;

function docker(...args) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolvePort(address.port));
    });
  });
}

test('dual-network Caddy keeps operating and showcase upstreams apart and rewrites spoofed IP', async () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const operatingNetwork = `masscom-edge-operating-${suffix}`;
  const showcaseNetwork = `masscom-edge-showcase-${suffix}`;
  const operatingApi = `masscom-edge-api-${suffix}`;
  const showcaseApi = `masscom-edge-demo-${suffix}`;
  const caddy = `masscom-edge-caddy-${suffix}`;
  const operatingPort = await freePort();
  let showcasePort = await freePort();
  while (showcasePort === operatingPort) showcasePort = await freePort();
  let webPort = await freePort();
  while (webPort === operatingPort || webPort === showcasePort) webPort = await freePort();
  // 시연 웹 체험(Issue #309) 번들 자리: SPA 진입 파일과 정적 자산 하나.
  const showcaseWeb = mkdtempSync(resolve(tmpdir(), 'masscom-showcase-web-'));
  mkdirSync(resolve(showcaseWeb, '_expo/static/js'), { recursive: true });
  writeFileSync(resolve(showcaseWeb, 'index.html'), '<!doctype html><title>showcase-web-entry</title>');
  writeFileSync(resolve(showcaseWeb, '_expo/static/js/app.js'), 'globalThis.showcaseWebAsset = true;');
  docker('network', 'create', operatingNetwork);
  try {
    docker('network', 'create', showcaseNetwork);
    docker('run', '-d', '--rm', '--network', operatingNetwork,
      '--network-alias', 'api', '--name', operatingApi, '-e', 'SOURCE=operating',
      'node:24-alpine', 'node', '-e', fixture);
    docker('run', '-d', '--rm', '--network', showcaseNetwork,
      '--network-alias', 'showcase-api', '--name', showcaseApi, '-e', 'SOURCE=showcase',
      'node:24-alpine', 'node', '-e', fixture);
    docker('run', '-d', '--rm', '--network', operatingNetwork, '--name', caddy,
      '-p', `127.0.0.1:${operatingPort}:8081`, '-p', `127.0.0.1:${showcasePort}:8082`,
      '-p', `127.0.0.1:${webPort}:8080`,
      '-e', 'MASSCOM_API_DOMAIN=:8081', '-e', 'MASSCOM_WEB_DOMAIN=:8080',
      '-e', 'MASSCOM_SHOWCASE_API_DOMAIN=:8082',
      '-v', `${resolve(repoRoot, 'infra/lightsail/Caddyfile')}:/etc/caddy/Caddyfile:ro`,
      '-v', `${showcaseWeb}:/srv/showcase-web:ro`,
      'caddy:2.10.2-alpine');
    docker('network', 'connect', showcaseNetwork, caddy);

    async function routed(port) {
      const response = await fetch(`http://127.0.0.1:${port}/merchants`, {
        headers: { 'X-Forwarded-For': '203.0.113.99' },
        signal: AbortSignal.timeout(1500),
      });
      assert.equal(response.status, 200);
      return response.json();
    }
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        const operating = await routed(operatingPort);
        const showcase = await routed(showcasePort);
        assert.equal(operating.source, 'operating');
        assert.equal(showcase.source, 'showcase');
        for (const body of [operating, showcase]) {
          assert.notEqual(body.forwardedFor, '203.0.113.99');
          assert.ok(isIP(body.forwardedFor) > 0);
        }
        ready = true;
        break;
      } catch (error) {
        if (attempt === 29) throw error;
        await new Promise((resolveWait) => setTimeout(resolveWait, 200));
      }
    }
    assert.equal(ready, true);

    // 시연 출처의 /play/만 정적 번들(+CSP)이고 나머지는 그대로 시연 API다. 운영 API 출처의 /play/는 운영 API로 간다.
    const noRedirect = { redirect: 'manual', signal: AbortSignal.timeout(1500) };
    const playRoot = await fetch(`http://127.0.0.1:${showcasePort}/play`, noRedirect);
    assert.equal(playRoot.status, 308);
    assert.equal(playRoot.headers.get('location'), '/play/');
    for (const path of ['/play/', '/play/role/merchant', '/play/index.html']) {
      const page = await fetch(`http://127.0.0.1:${showcasePort}${path}`, noRedirect);
      assert.equal(page.status, 200, path);
      assert.match(await page.text(), /showcase-web-entry/, path);
      assert.equal(page.headers.get('content-security-policy'), showcaseWebCsp, path);
      assert.equal(page.headers.get('x-frame-options'), 'DENY', path);
    }
    const asset = await fetch(`http://127.0.0.1:${showcasePort}/play/_expo/static/js/app.js`, noRedirect);
    assert.equal(asset.status, 200);
    assert.equal(await asset.text(), 'globalThis.showcaseWebAsset = true;');
    const apiAfterPlay = await fetch(`http://127.0.0.1:${showcasePort}/playground`, noRedirect);
    assert.equal((await apiAfterPlay.json()).source, 'showcase');
    assert.equal(apiAfterPlay.headers.get('content-security-policy'), null);
    const operatingPlay = await fetch(`http://127.0.0.1:${operatingPort}/play/`, noRedirect);
    assert.equal((await operatingPlay.json()).source, 'operating');

    // 운영 웹 출처의 /demo(/*)는 시연 출처 /play/로 302만 한다.
    for (const path of ['/demo', '/demo/', '/demo/anything']) {
      const entry = await fetch(`http://127.0.0.1:${webPort}${path}`, noRedirect);
      assert.equal(entry.status, 302, path);
      assert.equal(entry.headers.get('location'), 'https://demo-api.masscom.kr/play/', path);
    }
  } finally {
    for (const name of [caddy, showcaseApi, operatingApi]) {
      try { docker('rm', '-f', name); } catch { /* Already stopped. */ }
    }
    for (const name of [showcaseNetwork, operatingNetwork]) {
      try { docker('network', 'rm', name); } catch { /* Already removed. */ }
    }
    rmSync(showcaseWeb, { recursive: true, force: true });
  }
});
