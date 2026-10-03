// Issue #254: 운영 Caddy가 발행 확정된 NFT 메타데이터·그림만 API로 넘기고, 컨트랙트에 고정된 실증 토큰은 정적 파일 그대로 주는지 확인한다.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { buildPublicSite } from '../../scripts/build-public-site.mjs';

const repoRoot = resolve(import.meta.dirname, '../..');
// API를 흉내 낸다: 허용된 NFT 메타데이터·가게 그림 요청은 자기 표시(X-From-Api)를 돌려준다.
const fixture = `require('node:http').createServer((request, response) => {
  response.setHeader('X-From-Api', request.method + ' ' + request.url);
  response.setHeader('X-Received-Forwarded-For', request.headers['x-forwarded-for'] || '');
  if (request.url.startsWith('/nft-metadata/') || request.url.startsWith('/merchant-art/')) {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Cache-Control', 'public, max-age=86400');
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.writeHead(200);
    response.end(JSON.stringify({ from: 'api' }));
  } else {
    response.writeHead(404);
    response.end();
  }
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

async function waitFor(check, label) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try { await check(); return; } catch {
      if (attempt === 29) throw new Error(`${label} did not become ready`);
      await new Promise((resolveWait) => setTimeout(resolveWait, 200));
    }
  }
}

test('Caddy는 확정된 메타데이터·그림 경로만 API로 넘기고 실증 토큰은 정적 바이트 그대로 둔다', async () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const network = `masscom-nft-metadata-test-${suffix}`;
  const api = `masscom-nft-metadata-api-${suffix}`;
  const caddy = `masscom-nft-metadata-caddy-${suffix}`;
  const scratch = mkdtempSync(resolve(tmpdir(), 'masscom-nft-metadata-'));
  const publicRoot = join(scratch, 'public');
  const port = await freePort();
  await buildPublicSite(repoRoot, publicRoot);
  docker('network', 'create', network);
  try {
    docker('run', '-d', '--rm', '--network', network, '--network-alias', 'api', '--name', api,
      'node:24-alpine', 'node', '-e', fixture);
    await waitFor(() => docker('exec', api, 'node', '-e',
      "fetch('http://127.0.0.1:3000/').then(() => process.exit(0)).catch(() => process.exit(1))"), 'API fixture');
    docker('run', '-d', '--rm', '--network', network, '--name', caddy,
      '-p', `127.0.0.1:${port}:8080`,
      '-e', 'MASSCOM_API_DOMAIN=:8081', '-e', 'MASSCOM_WEB_DOMAIN=:8080', '-e', 'MASSCOM_SHOWCASE_API_DOMAIN=:8082',
      '-v', `${resolve(repoRoot, 'infra/lightsail/Caddyfile')}:/etc/caddy/Caddyfile:ro`,
      '-v', `${publicRoot}:/srv/masscom:ro`, 'caddy:2.10.2-alpine');
    const url = `http://127.0.0.1:${port}`;
    await waitFor(() => fetch(`${url}/`, { signal: AbortSignal.timeout(1000) }), 'Caddy');

    // 실증 토큰 #1: 컨트랙트의 tokenURI가 가리키는 정적 파일 바이트 그대로, API를 거치지 않는다.
    const proof = await fetch(`${url}/nft-metadata/base-sepolia-proof/1.json`);
    assert.equal(proof.status, 200);
    assert.equal(proof.headers.get('x-from-api'), null);
    assert.match(proof.headers.get('content-type') ?? '', /^application\/json/);
    assert.equal(proof.headers.get('access-control-allow-origin'), '*');
    assert.equal(await proof.text(), readFileSync(join(repoRoot, 'docs/nft-metadata/base-sepolia-proof/1.json'), 'utf8'));
    // 대소문자를 바꾼 실증 경로도 API로 넘기지 않는다(Caddy path 매처는 대소문자를 무시한다). 정적 응답의 상태는
    // 파일 시스템의 대소문자 구분에 따라 다르므로(macOS 바인드 마운트는 200, Linux는 404) 상태는 보지 않는다.
    assert.equal((await fetch(`${url}/nft-metadata/BASE-SEPOLIA-PROOF/1.json`)).headers.get('x-from-api'), null);
    const otherProof = await fetch(`${url}/nft-metadata/base-sepolia-proof/2.json`);
    assert.equal(otherProof.status, 404);
    assert.equal(otherProof.headers.get('x-from-api'), null);

    // 발행 확정된 토큰·보존 그림은 API가 주고, CORS 값은 하나만 남는다(API 값과 Caddy 값이 겹치지 않음).
    const sha = 'e'.repeat(64);
    for (const [method, path] of [['GET', '/nft-metadata/series-a/7.json'], ['HEAD', '/nft-metadata/series-a/7.json'],
      ['GET', '/nft-metadata/Series_2/0.json'], ['GET', `/nft-metadata/s-${'0'.repeat(28)}c0de/12.json`],
      ['GET', `/nft-metadata/images/${sha}.webp`],
      ['GET', '/nft-metadata/default/mascot-stamp-v1.png'], ['HEAD', '/nft-metadata/default/mascot-stamp-v1.png']]) {
      const routed = await fetch(`${url}${path}`, { method });
      assert.equal(routed.status, 200, `${method} ${path}`);
      assert.equal(routed.headers.get('x-from-api'), `${method} ${path}`);
      assert.equal(routed.headers.get('access-control-allow-origin'), '*', `${method} ${path}`);
      assert.equal(routed.headers.get('cache-control'), 'public, max-age=86400', `${method} ${path}`);
      assert.equal(routed.headers.get('x-content-type-options'), 'nosniff', `${method} ${path}`);
    }

    // 운영 웹 출처의 가게 그림은 API의 원래 경로로 전달한다.
    for (const method of ['GET', 'HEAD']) {
      const path = `/merchant-art/${sha}.webp`;
      const routed = await fetch(`${url}${path}`, { method, headers: { 'X-Forwarded-For': '203.0.113.77' } });
      assert.equal(routed.status, 200, `${method} ${path}`);
      assert.equal(routed.headers.get('x-from-api'), `${method} ${path}`);
      assert.ok(routed.headers.get('x-received-forwarded-for'), `${method} ${path}`);
      assert.ok(!routed.headers.get('x-received-forwarded-for').includes('203.0.113.77'), `${method} ${path}`);
    }

    // 쓰기 메서드·다른 모양의 경로·다른 공개 경로는 API로 넘기지 않는다.
    for (const [method, path] of [['POST', '/nft-metadata/series-a/7.json'], ['DELETE', '/nft-metadata/series-a/7.json'],
      ['GET', '/nft-metadata/series-a/07.json'], ['GET', '/nft-metadata/series-a/7.json.bak'],
      ['GET', '/nft-metadata/a/b/7.json'], ['GET', '/nft-metadata/series-a/'], ['GET', '/nft-metadata/-a/7.json'],
      ['GET', `/nft-metadata/images/${sha}.png`], ['GET', '/nft-metadata/images/abc.webp'],
      ['GET', '/nft-metadata/default/mascot-stamp-v2.png'],
      ['GET', '/nft-metadata/series-a/%2e%2e/7.json'], ['GET', '/merchant-art/x.webp'],
      ['POST', `/merchant-art/${sha}.webp`], ['PUT', `/merchant-art/${sha}.webp`],
      ['GET', `/merchant-art/${sha.toUpperCase()}.webp`], ['GET', `/merchant-art/${sha.slice(1)}.webp`],
      ['GET', `/merchant-art/${sha}e.webp`], ['GET', `/merchant-art/${sha}.png`],
      ['GET', `/merchant-art/${sha}.webp/extra`]]) {
      const blocked = await fetch(`${url}${path}`, { method });
      assert.equal(blocked.headers.get('x-from-api'), null, `${method} ${path}`);
      assert.notEqual(blocked.status, 200, `${method} ${path}`);
    }
  } finally {
    docker('rm', '-f', caddy, api);
    docker('network', 'rm', network);
    rmSync(scratch, { recursive: true, force: true });
  }
});
