import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';

import { loadMerchants } from '../../apps/production-web/assets/production.mjs';
import { createProductionServer, resolveProductionBindHost } from '../../apps/production-web/server.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const web = join(repo, 'apps/production-web');
const html = readFileSync(join(web, 'index.html'), 'utf8');
const script = readFileSync(join(web, 'assets/production.mjs'), 'utf8');
const css = readFileSync(join(web, 'assets/production.css'), 'utf8');
const serverSource = readFileSync(join(web, 'server.mjs'), 'utf8');

test('운영 웹은 로컬 기본 바인딩을 유지하고 명시한 컨테이너 바인딩만 허용한다', () => {
  assert.equal(resolveProductionBindHost(undefined), '127.0.0.1');
  assert.equal(resolveProductionBindHost('0.0.0.0'), '0.0.0.0');
  assert.throws(() => resolveProductionBindHost('::'), /WEB_BIND_HOST_INVALID/);
  assert.throws(() => resolveProductionBindHost('api.masscom.kr'), /WEB_BIND_HOST_INVALID/);
});

function element() {
  return {
    textContent: '',
    children: [],
    className: '',
    append(...children) { this.children.push(...children); },
    replaceChildren() { this.children = []; },
  };
}

function documentFixture() {
  const status = element();
  const list = element();
  return {
    status,
    list,
    doc: {
      getElementById(id) { return { 'merchant-status': status, 'merchant-list': list }[id]; },
      createElement: element,
    },
  };
}

test('운영 웹은 시연 데이터와 쓰기 UI 없이 개인 도감을 닫는다', () => {
  assert.match(html, /현재 웹 도감은 이용할 수 없습니다/);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /lang="ko"/);
  assert.match(html, /viewport/);
  assert.match(css, /prefers-color-scheme/);
  assert.match(css, /#2456d6/);
  assert.doesNotMatch(html + script + serverSource, /localStorage|innerHTML|dangerouslySetInnerHTML/);
  assert.doesNotMatch(html + script, /가상 점포|예시 방문|실제 NFT가 아닙니다|DEMO 배지/);
  assert.doesNotMatch(html, /<form\b|<button\b|wallet|mint|QR|claim/i);
  assert.match(script, /textContent = merchant\.name/);
  assert.match(script, /merchant\.demo === false/);
});

test('실제 공개 응답 0건은 빈 상태를 표시한다', async () => {
  const { status, list, doc } = documentFixture();
  await loadMerchants(async (url, options) => {
    assert.equal(url, '/merchants');
    assert.equal(options.method, 'GET');
    return { ok: true, json: async () => ({ merchants: [] }) };
  }, doc);
  assert.equal(status.textContent, '현재 공개된 음식점이 없습니다.');
  assert.equal(list.children.length, 0);
});

test('운영 응답만 안전한 텍스트 노드로 렌더링한다', async () => {
  const { status, list, doc } = documentFixture();
  await loadMerchants(async () => ({
    ok: true,
    json: async () => ({ merchants: [
      { name: '<img src=x onerror=alert(1)>', story: '운영 설명', roadAddress: '서울', demo: false },
      { name: '가상 점포', story: '시연', roadAddress: '가상', demo: true },
    ] }),
  }), doc);
  assert.equal(status.textContent, '1곳의 음식점을 불러왔습니다.');
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].children[0].textContent, '<img src=x onerror=alert(1)>');
});

test('연결 실패와 잘못된 응답은 목록 없이 이용 불가 상태를 표시한다', async () => {
  for (const fetcher of [
    async () => { throw new TypeError('Failed to fetch'); },
    async () => ({ ok: false }),
    async () => ({ ok: true, json: async () => ({ merchants: [{ name: '불완전' }] }) }),
  ]) {
    const { status, list, doc } = documentFixture();
    await loadMerchants(fetcher, doc);
    assert.match(status.textContent, /불러올 수 없습니다/);
    assert.equal(list.children.length, 0);
  }
});

let server;
let base;
const calls = [];
before(async () => {
  server = createProductionServer(async (url, options) => {
    calls.push({ url, options });
    return new Response('{"merchants":[]}', { headers: { 'Content-Type': 'application/json' } });
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((done) => server.close(done)); });

test('로컬 서버는 공개 GET /merchants만 운영 API에 전달한다', async () => {
  const response = await fetch(`${base}/merchants`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { merchants: [] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.masscom.kr/merchants');
  assert.equal(calls[0].options.method, 'GET');

  for (const [path, method] of [['/collection', 'GET'], ['/claim', 'GET'], ['/merchants/1', 'GET'], ['/merchants', 'POST'], ['/auth/login', 'POST']]) {
    const blocked = await fetch(`${base}${path}`, { method });
    assert.ok(blocked.status === 404 || blocked.status === 405);
  }
  assert.equal(calls.length, 1);
});

test('운영 API 오류는 502로 전달하고 임의 데이터가 없다', async () => {
  const failing = createProductionServer(async () => { throw new Error('offline'); });
  await new Promise((done) => failing.listen(0, '127.0.0.1', done));
  try {
    const response = await fetch(`http://127.0.0.1:${failing.address().port}/merchants`);
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'MERCHANTS_UNAVAILABLE' });
  } finally {
    await new Promise((done) => failing.close(done));
  }
});

test('운영 웹 프록시는 시연 행과 불필요한 필드를 응답에서 제거한다', async () => {
  const guarded = createProductionServer(async () => new Response(JSON.stringify({ merchants: [
    { id: 'real-1', name: '실제 점포', story: '가게 소개', roadAddress: '서울', demo: false, privateNote: '공개 금지' },
    { id: 'demo-1', name: '가상 점포', story: '예시', roadAddress: '가상', demo: true },
  ] }), { headers: { 'Content-Type': 'application/json' } }));
  await new Promise((done) => guarded.listen(0, '127.0.0.1', done));
  try {
    const response = await fetch(`http://127.0.0.1:${guarded.address().port}/merchants`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { merchants: [
      { name: '실제 점포', story: '가게 소개', roadAddress: '서울', demo: false },
    ] });
  } finally {
    await new Promise((done) => guarded.close(done));
  }
});

test('운영 웹 프록시는 불완전한 공개 목록을 0곳으로 오인하지 않는다', async () => {
  for (const invalidMerchant of [
    null,
    { name: '불완전', story: '', roadAddress: '서울' },
    { name: '잘못된 시연값', story: '', roadAddress: '서울', demo: 'false' },
    { name: '주소 누락', story: '', demo: false },
  ]) {
    const guarded = createProductionServer(async () => new Response(JSON.stringify({ merchants: [
      { name: '정상', story: '', roadAddress: '서울', demo: false }, invalidMerchant,
    ] }), { headers: { 'Content-Type': 'application/json' } }));
    await new Promise((done) => guarded.listen(0, '127.0.0.1', done));
    try {
      const response = await fetch(`http://127.0.0.1:${guarded.address().port}/merchants`);
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), { error: 'MERCHANTS_UNAVAILABLE' });
    } finally {
      await new Promise((done) => guarded.close(done));
    }
  }
});
