import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { buildPublicSite } from '../../scripts/build-public-site.mjs';

const repoRoot = resolve(import.meta.dirname, '../..');
const fixture = `const { createServer } = require('node:http');
createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Observed-Host', request.headers.host || '');
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
  } else if (request.url === '/api/web/badges') {
    response.setHeader('X-Observed-Cookie', request.headers.cookie || '');
    response.writeHead(request.headers.cookie ? 200 : 401);
  } else if (request.url === '/api/web/logout') {
    response.writeHead(204);
  } else if (request.url === '/api/web/consent') {
    response.setHeader('X-Observed-Cookie', request.headers.cookie || '');
    response.writeHead(request.headers.cookie ? 200 : 401);
  } else if (request.url.startsWith('/api/web/collectibles/')) {
    // 보유자 전용 수집품 상세. API 대역은 일부러 Cache-Control을 주지 않아, 응답의 no-store가 Caddy가 붙인 것임을 확인한다.
    response.removeHeader('Cache-Control');
    response.setHeader('X-Observed-Cookie', request.headers.cookie || '');
    response.writeHead(request.headers.cookie ? 200 : 401);
  } else if (request.url.startsWith('/api/web/v1/')) {
    // 가게 실세계 프로필 편집(/api/web/v1/{merchant,admin}/merchants/...). API 대역은 일부러 Cache-Control을 주지 않아,
    // 응답의 no-store가 Caddy가 붙인 것임을 확인한다.
    response.removeHeader('Cache-Control');
    response.setHeader('X-Observed-Cookie', request.headers.cookie || '');
    response.writeHead(request.headers.cookie ? 200 : 401);
  } else if (request.url === '/api/web/account-deletion-intake') {
    response.writeHead(202);
  } else if (request.url === '/api/web/account-deletion-intake/cancel' || request.url === '/api/web/account-deletion-status') {
    response.writeHead(200);
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

async function requestForHost(url, path, host, method = 'GET', headers = {}) {
  return new Promise((resolveResponse, reject) => {
    const request = httpRequest(`${url}${path}`, { method, headers: { Host: host, ...headers } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolveResponse({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
      response.on('error', reject);
    });
    request.on('error', reject);
    request.end();
  });
}

test('Caddy forwards allowlisted browser-session routes, preserving redirects and cookies', async () => {
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
      '-e', 'MASSCOM_SHOWCASE_API_DOMAIN=:8082',
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
    assert.equal((await fetch(`${url}/api/web/badges`)).status, 401);
    const badges = await fetch(`${url}/api/web/badges`, { headers: { cookie: 'web_session=fixture' } });
    assert.equal(badges.status, 200);
    assert.equal(badges.headers.get('x-observed-cookie'), 'web_session=fixture');
    assert.equal(badges.headers.get('cache-control'), 'no-store');
    // 동의 조회·기록은 로그인 쿠키를 API까지 그대로 넘기고 캐시하지 않는다.
    assert.equal((await fetch(`${url}/api/web/consent`)).status, 401);
    for (const method of ['GET', 'POST']) {
      const consent = await fetch(`${url}/api/web/consent`, { method, headers: { cookie: 'web_session=fixture' } });
      assert.equal(consent.status, 200, method);
      assert.equal(consent.headers.get('x-observed-cookie'), 'web_session=fixture', method);
      assert.match(consent.headers.get('cache-control') ?? '', /no-store/, method);
      assert.equal(consent.headers.get('x-robots-tag'), 'noindex, nofollow', method);
    }
    // 보유자 수집품 상세(`/api/web/collectibles/*`)는 로그인 쿠키를 API까지 넘기고 Caddy가 캐시·색인을 막는다.
    assert.equal((await fetch(`${url}/api/web/collectibles/entitlement-1`)).status, 401);
    const collectible = await fetch(`${url}/api/web/collectibles/entitlement-1`, { headers: { cookie: 'web_session=fixture' } });
    assert.equal(collectible.status, 200);
    assert.equal(collectible.headers.get('x-observed-cookie'), 'web_session=fixture');
    assert.match(collectible.headers.get('cache-control') ?? '', /no-store/);
    assert.equal(collectible.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.equal((await fetch(`${url}/api/web/collectibles`, { headers: { cookie: 'web_session=fixture' } })).status, 404, '목록 경로는 프록시하지 않는다');
    // 가게 실세계 프로필 편집 API(`/api/web/v1/*`)도 API로 넘기고 Caddy가 캐시·색인을 막는다. 정적 파일 서버로 빠지면 404다.
    for (const channel of ['merchant', 'admin']) {
      const path = `/api/web/v1/${channel}/merchants/merchant-1/real-world-profile`;
      assert.equal((await fetch(`${url}${path}`)).status, 401, path);
      for (const method of ['GET', 'PUT']) {
        const profile = await fetch(`${url}${path}`, { method, headers: { cookie: 'web_session=fixture' } });
        assert.equal(profile.status, 200, `${method} ${path}`);
        assert.equal(profile.headers.get('x-observed-cookie'), 'web_session=fixture', `${method} ${path}`);
        assert.match(profile.headers.get('cache-control') ?? '', /no-store/, `${method} ${path}`);
        assert.equal(profile.headers.get('x-robots-tag'), 'noindex, nofollow', `${method} ${path}`);
      }
    }
    assert.equal((await fetch(`${url}/api/web/consent/other`, { method: 'POST' })).status, 404);
    assert.equal((await fetch(`${url}/api/web/logout`, { method: 'POST' })).status, 204);
    const intake = await fetch(`${url}/api/web/account-deletion-intake`, { method: 'POST' });
    assert.equal(intake.status, 202);
    assert.match(intake.headers.get('cache-control') ?? '', /no-store/);
    for (const path of ['/api/web/account-deletion-intake/cancel', '/api/web/account-deletion-status']) {
      const routed = await fetch(`${url}${path}`, { method: 'POST' });
      assert.equal(routed.status, 200, path);
      assert.match(routed.headers.get('cache-control') ?? '', /no-store/, path);
      assert.equal(routed.headers.get('x-robots-tag'), 'noindex, nofollow', path);
    }
    // 접수번호는 URL이 아니라 본문으로만 오간다: 쿼리에 접수번호를 붙인 다른 경로는 프록시하지 않는다.
    for (const path of ['/api/web/account-deletion-status/7K2M', '/api/web/account-deletion-intake/other']) {
      assert.equal((await fetch(`${url}${path}`, { method: 'POST' })).status, 404, path);
    }

    // 도감 메달은 읽기 전용 GET 한 경로만 열고 상자 열기 같은 쓰기 경로는 프록시하지 않는다.
    for (const path of ['/api/web/unknown', '/api/claim', '/api/mint', '/api/web/badges/rewards/1/open']) {
      assert.equal((await fetch(`${url}${path}`)).status, 404, path);
    }
  } finally {
    docker('rm', '-f', caddy, api);
    docker('network', 'rm', network);
    rmSync(publicRoot, { recursive: true, force: true });
  }
});

test('Caddy serves the same limited web surface for exact apex and www hosts', async () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const network = `masscom-web-host-test-${suffix}`;
  const api = `masscom-web-api-host-test-${suffix}`;
  const web = `masscom-web-static-host-test-${suffix}`;
  const caddy = `masscom-web-caddy-host-test-${suffix}`;
  const scratch = mkdtempSync(resolve(tmpdir(), 'masscom-web-host-'));
  const publicRoot = join(scratch, 'public');
  const port = await freePort();
  await buildPublicSite(repoRoot, publicRoot);
  docker('network', 'create', network);
  try {
    docker('run', '-d', '--rm', '--network', network, '--network-alias', 'api', '--name', api,
      'node:24-alpine', 'node', '-e', fixture);
    docker('run', '-d', '--rm', '--network', network, '--network-alias', 'production-web', '--name', web,
      'node:24-alpine', 'node', '-e',
      "require('node:http').createServer((request,response)=>response.end('web:'+request.url)).listen(4173,'0.0.0.0')");
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        docker('exec', api, 'node', '-e',
          "fetch('http://127.0.0.1:3000/').then(() => process.exit(0)).catch(() => process.exit(1))");
        docker('exec', web, 'node', '-e',
          "fetch('http://127.0.0.1:4173/').then(() => process.exit(0)).catch(() => process.exit(1))");
        break;
      } catch {
        if (attempt === 29) throw new Error('web host fixtures did not become ready');
        await new Promise((resolveWait) => setTimeout(resolveWait, 200));
      }
    }
    docker('run', '-d', '--rm', '--network', network, '--name', caddy,
      '-p', `127.0.0.1:${port}:8080`,
      '-e', 'MASSCOM_API_DOMAIN=:8081',
      '-e', 'MASSCOM_WEB_DOMAIN=http://masscom.kr:8080, http://www.masscom.kr:8080',
      '-e', 'MASSCOM_SHOWCASE_API_DOMAIN=:8082',
      '-v', `${resolve(repoRoot, 'infra/lightsail/Caddyfile')}:/etc/caddy/Caddyfile:ro`,
      '-v', `${publicRoot}:/srv/masscom:ro`, 'caddy:2.10.2-alpine');
    const url = `http://127.0.0.1:${port}`;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        await requestForHost(url, '/', 'masscom.kr');
        break;
      } catch {
        if (attempt === 29) throw new Error('Caddy web hosts did not become ready');
        await new Promise((resolveWait) => setTimeout(resolveWait, 200));
      }
    }
    for (const host of ['masscom.kr', 'www.masscom.kr']) {
      assert.equal((await requestForHost(url, '/', host)).status, 200, host);
      assert.equal((await requestForHost(url, '/preview/', host)).status, 200, host);
      assert.equal((await requestForHost(url, '/preview/assets/showcase.css', host)).status, 200, host);
      const previewRedirect = await requestForHost(url, '/preview', host);
      assert.equal(previewRedirect.status, 308, host);
      assert.equal(previewRedirect.headers.location, '/preview/', host);
      assert.equal((await requestForHost(url, '/app/', host)).body, 'web:/', host);
      const adminPage = await requestForHost(url, '/admin/', host);
      assert.equal(adminPage.body, 'web:/admin/', host);
      assert.equal(adminPage.headers['x-robots-tag'], 'noindex, nofollow', host);
      assert.equal(adminPage.headers['cache-control'], 'no-store', host);
      const merchantPage = await requestForHost(url, '/merchant/', host);
      assert.equal(merchantPage.body, 'web:/merchant/', host);
      assert.equal(merchantPage.headers['x-robots-tag'], 'noindex, nofollow', host);
      assert.equal(merchantPage.headers['cache-control'], 'no-store', host);
      const merchantRedirect = await requestForHost(url, '/merchant', host);
      assert.equal(merchantRedirect.status, 308, host);
      assert.equal(merchantRedirect.headers.location, '/merchant/', host);
      const login = await requestForHost(url, '/api/web/auth/start', host);
      assert.equal(login.status, 302, host);
      assert.equal(login.headers['x-observed-host'], host, host);
      assert.equal((await requestForHost(url, '/api/web/collection', host)).status, 401, host);
      assert.equal((await requestForHost(url, '/api/web/badges', host)).status, 401, host);
      const badges = await requestForHost(url, '/api/web/badges', host, 'GET', { cookie: 'web_session=fixture' });
      assert.equal(badges.status, 200, host);
      assert.equal(badges.headers['x-observed-host'], host, host);
      assert.equal(badges.headers['x-observed-cookie'], 'web_session=fixture', host);
      assert.equal(badges.headers['cache-control'], 'no-store', host);
      const adminApi = await requestForHost(url, '/api/web/admin/merchants', host);
      assert.equal(adminApi.headers['x-observed-host'], host, host);
      assert.equal(adminApi.headers['x-robots-tag'], 'noindex, nofollow', host);
      const merchantApi = await requestForHost(url, '/api/web/merchant/me', host);
      assert.equal(merchantApi.headers['x-observed-host'], host, host);
      assert.equal(merchantApi.headers['x-robots-tag'], 'noindex, nofollow', host);
      const collectible = await requestForHost(url, '/api/web/collectibles/entitlement-1', host, 'GET', { cookie: 'web_session=fixture' });
      assert.equal(collectible.status, 200, host);
      assert.equal(collectible.headers['x-observed-host'], host, host);
      assert.equal(collectible.headers['x-observed-cookie'], 'web_session=fixture', host);
      assert.match(collectible.headers['cache-control'] ?? '', /no-store/, host);
      assert.equal(collectible.headers['x-robots-tag'], 'noindex, nofollow', host);
      for (const channel of ['merchant', 'admin']) {
        const path = `/api/web/v1/${channel}/merchants/merchant-1/real-world-profile`;
        const profile = await requestForHost(url, path, host, 'GET', { cookie: 'web_session=fixture' });
        assert.equal(profile.status, 200, `${host}${path}`);
        assert.equal(profile.headers['x-observed-host'], host, `${host}${path}`);
        assert.equal(profile.headers['x-observed-cookie'], 'web_session=fixture', `${host}${path}`);
        assert.equal(profile.headers['x-robots-tag'], 'noindex, nofollow', `${host}${path}`);
        assert.match(profile.headers['cache-control'] ?? '', /no-store/, `${host}${path}`);
      }
      const consent = await requestForHost(url, '/api/web/consent', host, 'POST', { cookie: 'web_session=fixture' });
      assert.equal(consent.status, 200, host);
      assert.equal(consent.headers['x-observed-host'], host, host);
      assert.equal(consent.headers['x-observed-cookie'], 'web_session=fixture', host);
      assert.equal(consent.headers['x-robots-tag'], 'noindex, nofollow', host);
      assert.match(consent.headers['cache-control'] ?? '', /no-store/, host);
      const intake = await requestForHost(url, '/api/web/account-deletion-intake', host, 'POST');
      assert.equal(intake.status, 202, host);
      assert.equal(intake.headers['x-observed-host'], host, host);
      assert.equal(intake.headers['x-robots-tag'], 'noindex, nofollow', host);
      for (const path of ['/api/web/account-deletion-intake/cancel', '/api/web/account-deletion-status']) {
        const routed = await requestForHost(url, path, host, 'POST');
        assert.equal(routed.status, 200, `${host}${path}`);
        assert.equal(routed.headers['x-observed-host'], host, `${host}${path}`);
        assert.equal(routed.headers['x-robots-tag'], 'noindex, nofollow', `${host}${path}`);
        assert.match(routed.headers['cache-control'] ?? '', /no-store/, `${host}${path}`);
      }
      for (const blocked of ['/HANDOFF.md', '/preview/.vercel/project.json', '/claim', '/mint', '/api/web/unknown',
        '/api/web/badges/rewards/1/open']) {
        assert.equal((await requestForHost(url, blocked, host)).status, 404, `${host}${blocked}`);
      }
    }
    const unknownHost = await requestForHost(url, '/', 'other.masscom.kr');
    assert.equal(unknownHost.body, '');
    assert.equal(unknownHost.headers['x-observed-host'], undefined);
  } finally {
    docker('rm', '-f', caddy, api, web);
    docker('network', 'rm', network);
    rmSync(scratch, { recursive: true, force: true });
  }
});
