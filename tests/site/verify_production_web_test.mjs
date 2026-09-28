import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';

import { bindCollectionControls, loadCollection, loadMerchants } from '../../apps/production-web/assets/production.mjs';
import { bindAdmin, loadAdmin } from '../../apps/production-web/assets/admin.mjs';
import { bindMerchant, loadMerchant } from '../../apps/production-web/assets/merchant.mjs';
import { createProductionServer, resolveProductionBindHost } from '../../apps/production-web/server.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const web = join(repo, 'apps/production-web');
const html = readFileSync(join(web, 'index.html'), 'utf8');
const script = readFileSync(join(web, 'assets/production.mjs'), 'utf8');
const css = readFileSync(join(web, 'assets/production.css'), 'utf8');
const serverSource = readFileSync(join(web, 'server.mjs'), 'utf8');
const webDockerfile = readFileSync(join(repo, 'infra/lightsail/production-web.Dockerfile'), 'utf8');

test('운영 웹 이미지는 관리자 HTML과 자산을 함께 포함한다', () => {
  assert.match(webDockerfile, /COPY apps\/production-web\/admin\.html \.\/admin\.html/);
  assert.match(webDockerfile, /COPY apps\/production-web\/assets \.\/assets/);
});

test('운영 웹은 로컬 기본 바인딩을 유지하고 명시한 컨테이너 바인딩만 허용한다', () => {
  assert.equal(resolveProductionBindHost(undefined), '127.0.0.1');
  assert.equal(resolveProductionBindHost('0.0.0.0'), '0.0.0.0');
  assert.throws(() => resolveProductionBindHost('::'), /WEB_BIND_HOST_INVALID/);
  assert.throws(() => resolveProductionBindHost('api.masscom.kr'), /WEB_BIND_HOST_INVALID/);
});

function element() {
  const listeners = new Map();
  return {
    textContent: '',
    children: [],
    className: '',
    append(...children) { this.children.push(...children); },
    replaceChildren() { this.children = []; },
    addEventListener(type, callback) { listeners.set(type, callback); },
    async click() { return listeners.get('click')?.(); },
    async submit() { return listeners.get('submit')?.({ preventDefault() {}, currentTarget: this }); },
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

test('운영 웹은 시연 데이터와 쓰기 UI 없이 개인 도감을 읽기 전용으로 둔다', () => {
  assert.match(html, /내 도감/);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /lang="ko"/);
  assert.match(html, /viewport/);
  assert.match(css, /prefers-color-scheme/);
  assert.match(css, /#2456d6/);
  assert.doesNotMatch(html + script + serverSource, /localStorage|innerHTML|dangerouslySetInnerHTML/);
  assert.doesNotMatch(html + script, /가상 점포|예시 방문|실제 NFT가 아닙니다|DEMO 배지/);
  assert.doesNotMatch(html, /<form\b|href="[^"]*(?:wallet|mint|claim|qr)|data-action="[^"]*(?:wallet|mint|claim|qr)/i);
  assert.match(script, /textContent = merchant\.name/);
  assert.match(script, /merchant\.demo === false/);
});

function collectionFixture() {
  const ids = [
    'collection-status', 'collection-login', 'collection-retry', 'collection-logout',
    'collection-content', 'visit-list', 'collectible-list',
  ];
  const nodes = Object.fromEntries(ids.map((id) => [id, { ...element(), hidden: true }]));
  return {
    nodes,
    doc: {
      getElementById(id) { return nodes[id]; },
      createElement: element,
      hidden: false,
      listeners: new Map(),
      addEventListener(type, callback) { this.listeners.set(type, callback); },
      async dispatch(type) { return this.listeners.get(type)?.(); },
    },
  };
}

function sharedWindows(...docs) {
  const channels = new Set();
  class Channel {
    constructor() { channels.add(this); }
    postMessage(value) {
      for (const peer of channels) if (peer !== this) peer.onmessage?.({ data: value });
    }
  }
  for (const doc of docs) {
    doc.defaultView = {
      BroadcastChannel: Channel,
      listeners: new Map(),
      addEventListener(type, callback) { this.listeners.set(type, callback); },
      async dispatch(type) { return this.listeners.get(type)?.(); },
    };
  }
}

test('다른 탭 로그아웃과 계정 전환은 오래 열린 도감의 이전 기록을 지운다', async () => {
  const a = collectionFixture();
  const b = collectionFixture();
  const c = collectionFixture();
  sharedWindows(a.doc, b.doc, c.doc);
  let account = 'ACCOUNT_A_PRIVATE_VISIT';
  const fetcher = async (url) => {
    if (url === '/api/web/logout') {
      account = '';
      return { ok: true };
    }
    if (!account) return { ok: false, status: 401 };
    return { ok: true, json: async () => ({
      visits: [{ merchantName: account, businessDate: '2026-09-25' }], collectibles: [],
    }) };
  };
  await bindCollectionControls(fetcher, a.doc);
  await bindCollectionControls(fetcher, b.doc);
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(a.nodes['visit-list'].children[0].children[0].textContent, 'ACCOUNT_A_PRIVATE_VISIT');
  await b.nodes['collection-logout'].click();
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(a.nodes['visit-list'].children.length, 0);
  assert.equal(a.nodes['collection-content'].hidden, true);

  account = 'ACCOUNT_B_PRIVATE_VISIT';
  await bindCollectionControls(fetcher, c.doc);
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(a.nodes['visit-list'].children[0].children[0].textContent, 'ACCOUNT_B_PRIVATE_VISIT');
});

test('숨긴 탭과 뒤로 가기로 보존된 문서는 개인 DOM을 즉시 비운 뒤 다시 조회한다', async () => {
  const { nodes, doc } = collectionFixture();
  doc.defaultView = { addEventListener(type, callback) { this[type] = callback; } };
  const fetcher = async () => ({ ok: true, json: async () => ({
    visits: [{ merchantName: '민감한 이전 방문', businessDate: '2026-09-25' }], collectibles: [],
  }) });
  await bindCollectionControls(fetcher, doc);
  doc.hidden = true;
  await doc.dispatch('visibilitychange');
  assert.equal(nodes['visit-list'].children.length, 0);
  assert.equal(nodes['collection-content'].hidden, true);
  doc.hidden = false;
  await doc.dispatch('visibilitychange');
  assert.equal(nodes['visit-list'].children.length, 1);
  await doc.defaultView.pagehide();
  assert.equal(nodes['visit-list'].children.length, 0);
  await doc.defaultView.pageshow();
  assert.equal(nodes['visit-list'].children.length, 1);
});

test('운영 도감은 미로그인과 실제 기록 0건을 구분하고 다른 계정의 이전 화면을 지운다', async () => {
  const { nodes, doc } = collectionFixture();
  await loadCollection(async (url, options) => {
    assert.equal(url, '/api/web/collection');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.cache, 'no-store');
    return { status: 401, ok: false };
  }, doc);
  assert.match(nodes['collection-status'].textContent, /로그인/);
  assert.equal(nodes['collection-login'].hidden, false);
  assert.equal(nodes['collection-content'].hidden, true);

  await loadCollection(async () => ({ ok: true, json: async () => ({ visits: [], collectibles: [] }) }), doc);
  assert.match(nodes['collection-status'].textContent, /아직 없습니다/);
  assert.equal(nodes['collection-login'].hidden, true);
  assert.equal(nodes['collection-logout'].hidden, false);
  assert.equal(nodes['visit-list'].children.length, 0);
  assert.equal(nodes['collectible-list'].children.length, 0);
});

test('운영 도감은 방문과 앱 수집품을 실제 NFT 완료와 구분해 텍스트로 표시한다', async () => {
  const { nodes, doc } = collectionFixture();
  await loadCollection(async () => ({ ok: true, json: async () => ({
    visits: [{
      visitEventId: 'visit-1', merchantId: 'merchant-1', merchantName: '<script>bad</script>',
      campaignId: 'campaign-1', campaignTitle: '방문', businessDate: '2026-09-24',
      progressCounted: true, verificationLevel: 'MERCHANT_CONFIRMED',
    }],
    collectibles: [{
      entitlementId: 'reward-1', merchantId: 'merchant-1', merchantName: '월계 가게',
      campaignId: 'campaign-1', campaignTitle: '방문', targetVisitCount: 1,
      displayName: '마스코트', appCollectibleStatus: 'COLLECTED', mintJobId: null,
      recipient: null, nftStatus: 'NOT_REQUESTED', nft: null,
    }],
  }) }), doc);
  assert.equal(nodes['visit-list'].children.length, 1);
  assert.equal(nodes['visit-list'].children[0].children[0].textContent, '<script>bad</script>');
  assert.equal(nodes['collectible-list'].children.length, 1);
  const cardText = nodes['collectible-list'].children[0].children.map((child) => child.textContent).join(' ');
  assert.match(cardText, /앱 수집품/);
  assert.match(cardText, /NFT 미신청/);
  assert.doesNotMatch(cardText, /발행 완료/);
});

test('운영 도감 API 오류는 이전 기록을 지우고 재시도 선택지를 표시한다', async () => {
  const { nodes, doc } = collectionFixture();
  nodes['visit-list'].children.push({ textContent: '다른 계정 방문' });
  await loadCollection(async () => { throw new Error('offline'); }, doc);
  assert.equal(nodes['visit-list'].children.length, 0);
  assert.equal(nodes['collection-content'].hidden, true);
  assert.equal(nodes['collection-retry'].hidden, false);
  assert.match(nodes['collection-status'].textContent, /다시 시도/);
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

test('관리 화면은 별도 경로에서 제공하고 검색 색인 및 캐시를 막는다', async () => {
  const page = await fetch(`${base}/admin/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /관리자/);
  assert.equal(page.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal(page.headers.get('cache-control'), 'no-store');
  const script = await fetch(`${base}/admin/assets/admin.mjs`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type'), /javascript/);
  assert.equal(script.headers.get('x-robots-tag'), 'noindex, nofollow');
  const stylesheet = await fetch(`${base}/app/assets/production.css`);
  assert.equal(stylesheet.status, 200);
  assert.match(stylesheet.headers.get('content-type'), /text\/css/);
});

test('점포 화면은 별도 경로에서 제공하고 검색 색인 및 캐시를 막는다', async () => {
  const page = await fetch(`${base}/merchant/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /직원 등록 요청/);
  assert.equal(page.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal(page.headers.get('cache-control'), 'no-store');
  const script = await fetch(`${base}/merchant/assets/merchant.mjs`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type'), /javascript/);
  assert.equal(script.headers.get('x-robots-tag'), 'noindex, nofollow');
});

test('관리 화면은 로그인·권한 거부·실제 상점 목록을 구분하고 상점 이름을 텍스트로 표시한다', async () => {
  const nodes = Object.fromEntries(['admin-status', 'admin-login', 'admin-content',
    'admin-merchants', 'admin-create', 'admin-logout'].map(id => [id, { ...element(), hidden: true }]));
  const doc = {
    getElementById(id) { return nodes[id]; },
    createElement: element,
  };
  await loadAdmin(async () => ({ status: 401, ok: false }), doc);
  assert.equal(nodes['admin-login'].hidden, false);
  assert.equal(nodes['admin-logout'].hidden, true);
  assert.equal(nodes['admin-content'].hidden, true);
  await loadAdmin(async () => ({ status: 403, ok: false }), doc);
  assert.match(nodes['admin-status'].textContent, /권한이 없습니다/);
  assert.equal(nodes['admin-logout'].hidden, false);
  assert.equal(nodes['admin-content'].hidden, true);
  await loadAdmin(async path => ({ ok: true, json: async () => path.endsWith('/me')
    ? { admin: true } : { merchants: [{ id: 'real-1', name: '<script>alert(1)</script>',
      story: '소개', roadAddress: '서울', minimumSpendWon: 1000, status: 'PAUSED', demo: false, version: 1 }] } }), doc);
  assert.equal(nodes['admin-content'].hidden, false);
  assert.equal(nodes['admin-logout'].hidden, false);
  assert.equal(nodes['admin-merchants'].children.length, 2);
  assert.equal(nodes['admin-merchants'].children[0].children[0].textContent, '<script>alert(1)</script>');
});

test('관리 화면의 빈 점포 목록은 예시 자료 없이 등록 행동을 안내한다', async () => {
  const nodes = Object.fromEntries(['admin-status', 'admin-login', 'admin-content',
    'admin-merchants', 'admin-create', 'admin-logout'].map(id => [id, { ...element(), hidden: true }]));
  const doc = { getElementById(id) { return nodes[id]; }, createElement: element };
  await loadAdmin(async path => ({ ok: true, json: async () => path.endsWith('/me')
    ? { admin: true } : { merchants: [] } }), doc);
  assert.equal(nodes['admin-merchants'].children.length, 1);
  assert.match(nodes['admin-merchants'].children[0].textContent, /등록된 점포가 없습니다/);
  assert.match(nodes['admin-merchants'].children[0].textContent, /비공개로 등록/);
  assert.doesNotMatch(nodes['admin-merchants'].children[0].textContent, /왼쪽/);
});

test('권한 없음과 정상 관리 화면에서 로그아웃 후 다른 Google 계정 로그인을 안내한다', async () => {
  for (const authorized of [false, true]) {
    const nodes = Object.fromEntries(['admin-status', 'admin-login', 'admin-content',
      'admin-merchants', 'admin-create', 'admin-logout'].map(id => [id, { ...element(), hidden: true }]));
    const doc = { getElementById(id) { return nodes[id]; }, createElement: element };
    const calls = [];
    await bindAdmin(async (path, options) => {
      calls.push({ path, options });
      if (path === '/api/web/logout') return { ok: true, status: 204 };
      if (path.endsWith('/me')) return authorized
        ? { ok: true, json: async () => ({ admin: true }) } : { ok: false, status: 403 };
      return { ok: true, json: async () => ({ merchants: [] }) };
    }, doc);
    assert.equal(nodes['admin-logout'].hidden, false);
    await nodes['admin-logout'].click();
    assert.equal(calls.at(-1).path, '/api/web/logout');
    assert.equal(calls.at(-1).options.method, 'POST');
    assert.equal(calls.at(-1).options.credentials, 'same-origin');
    assert.equal(nodes['admin-content'].hidden, true);
    assert.equal(nodes['admin-logout'].hidden, true);
    assert.equal(nodes['admin-login'].hidden, false);
    assert.match(nodes['admin-status'].textContent, /다른 Google 계정/);
  }
});

test('로그아웃 실패를 성공으로 표시하지 않고 계정 전환 재시도를 허용한다', async () => {
  const nodes = Object.fromEntries(['admin-status', 'admin-login', 'admin-content',
    'admin-merchants', 'admin-create', 'admin-logout'].map(id => [id, { ...element(), hidden: true }]));
  const doc = { getElementById(id) { return nodes[id]; }, createElement: element };
  await bindAdmin(async path => path === '/api/web/logout'
    ? { ok: false, status: 503 } : { ok: false, status: 403 }, doc);
  await nodes['admin-logout'].click();
  assert.equal(nodes['admin-logout'].hidden, false);
  assert.equal(nodes['admin-logout'].disabled, false);
  assert.equal(nodes['admin-login'].hidden, true);
  assert.match(nodes['admin-status'].textContent, /다시 시도/);
});

test('로그아웃 응답 대기 중 다시 읽은 관리자 목록도 성공 뒤 지운다', async () => {
  const nodes = Object.fromEntries(['admin-status', 'admin-login', 'admin-content',
    'admin-merchants', 'admin-create', 'admin-logout'].map(id => [id, { ...element(), hidden: true }]));
  const doc = { getElementById(id) { return nodes[id]; }, createElement: element };
  let finishLogout;
  const logoutResponse = new Promise(resolve => { finishLogout = resolve; });
  const fetcher = async path => {
    if (path === '/api/web/logout') return logoutResponse;
    return { ok: true, json: async () => path.endsWith('/me') ? { admin: true } : {
      merchants: [{ id: 'real-logout-race', name: '이전 계정 점포', story: '', roadAddress: '서울',
        minimumSpendWon: 0, status: 'PAUSED', demo: false, version: 1 }],
    } };
  };
  await bindAdmin(fetcher, doc);
  const logout = nodes['admin-logout'].click();
  await loadAdmin(fetcher, doc);
  assert.equal(nodes['admin-merchants'].children.length, 2);
  finishLogout({ ok: true });
  await logout;
  assert.equal(nodes['admin-content'].hidden, true);
  assert.equal(nodes['admin-merchants'].children.length, 0);
  assert.equal(nodes['admin-login'].hidden, false);
});

test('미수령 QR 때문에 숨김이 거부되면 수령 또는 만료 후 재시도를 안내한다', async () => {
  const nodes = Object.fromEntries(['admin-status', 'admin-login', 'admin-content',
    'admin-merchants', 'admin-create', 'admin-logout'].map(id => [id, { ...element(), hidden: true }]));
  const doc = { getElementById(id) { return nodes[id]; }, createElement: element };
  const fetcher = async (path, options) => {
    if (path.endsWith('/me')) return { ok: true, json: async () => ({ admin: true }) };
    if (options.method === 'POST') return { ok: false, status: 409,
      json: async () => ({ code: 'ADMIN_PENDING_CLAIMS' }) };
    return { ok: true, json: async () => ({ merchants: [{ id: 'real-claim', name: '실제 상점',
      story: '', roadAddress: '서울', minimumSpendWon: 0, status: 'ACTIVE', demo: false, version: 1 }] }) };
  };
  await loadAdmin(fetcher, doc);
  const hide = nodes['admin-merchants'].children[0].children.at(-1);
  await hide.click();
  assert.match(nodes['admin-status'].textContent, /미수령 QR/);
  assert.match(nodes['admin-status'].textContent, /수령.*만료/);
  assert.equal(hide.disabled, false);
  assert.equal(nodes['admin-content'].hidden, false);
});

test('관리 화면은 탭을 떠날 때 이전 계정의 상점 내용을 지운다', async () => {
  const nodes = Object.fromEntries(['admin-status', 'admin-login', 'admin-content',
    'admin-merchants', 'admin-create', 'admin-logout'].map(id => [id, { ...element(), hidden: true }]));
  const listeners = new Map();
  const doc = {
    getElementById(id) { return nodes[id]; }, createElement: element,
    defaultView: { addEventListener(type, callback) { listeners.set(type, callback); } },
  };
  await bindAdmin(async path => ({ ok: true, json: async () => path.endsWith('/me')
    ? { admin: true } : { merchants: [{ id: 'real-2', name: '이전 계정 상점', story: '',
      roadAddress: '서울', minimumSpendWon: 0, status: 'PAUSED', demo: false, version: 1 }] } }), doc);
  assert.equal(nodes['admin-merchants'].children.length, 2);
  listeners.get('pagehide')();
  assert.equal(nodes['admin-merchants'].children.length, 0);
  assert.equal(nodes['admin-content'].hidden, true);
});

test('관리 권한 조회가 늦게 끝나도 닫힌 탭에 상점 내용을 다시 표시하지 않는다', async () => {
  const nodes = Object.fromEntries(['admin-status', 'admin-login', 'admin-content',
    'admin-merchants', 'admin-create', 'admin-logout'].map(id => [id, { ...element(), hidden: true }]));
  const listeners = new Map();
  const doc = {
    getElementById(id) { return nodes[id]; }, createElement: element,
    defaultView: { addEventListener(type, callback) { listeners.set(type, callback); } },
  };
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const loaded = bindAdmin(async path => {
    if (path.endsWith('/me')) await pending;
    return { ok: true, json: async () => path.endsWith('/me') ? { admin: true } : {
      merchants: [{ id: 'late', name: '늦은 상점', story: '', roadAddress: '서울',
        minimumSpendWon: 0, status: 'PAUSED', demo: false, version: 1 }],
    } };
  }, doc);
  listeners.get('pagehide')();
  release();
  await loaded;
  assert.equal(nodes['admin-merchants'].children.length, 0);
  assert.equal(nodes['admin-content'].hidden, true);
});

test('직원 목록 실패가 늦게 도착해도 닫힌 관리자 탭을 다시 채우지 않는다', async () => {
  const nodes = Object.fromEntries(['admin-status', 'admin-login', 'admin-content',
    'admin-merchants', 'admin-create', 'admin-logout'].map(id => [id, { ...element(), hidden: true }]));
  const listeners = new Map();
  const doc = {
    getElementById(id) { return nodes[id]; }, createElement: element,
    defaultView: { addEventListener(type, callback) { listeners.set(type, callback); } },
  };
  let rejectStaff;
  let staffStarted;
  const started = new Promise(resolve => { staffStarted = resolve; });
  const staffResponse = new Promise((_resolve, reject) => { rejectStaff = reject; });
  const loaded = bindAdmin(async path => {
    if (path.endsWith('/me')) return { ok: true, json: async () => ({ admin: true }) };
    if (path.endsWith('/staff')) {
      staffStarted();
      return staffResponse;
    }
    return { ok: true, json: async () => ({ merchants: [{ id: 'real-closed', name: '닫힌 점포',
      story: '', roadAddress: '서울', minimumSpendWon: 0, status: 'ACTIVE', demo: false, version: 1 }] }) };
  }, doc);
  await started;
  listeners.get('pagehide')();
  rejectStaff(new Error('late staff failure'));
  await loaded;
  assert.equal(nodes['admin-merchants'].children.length, 0);
  assert.equal(nodes['admin-content'].hidden, true);
});

function merchantDocument() {
  const nodes = Object.fromEntries(['merchant-status', 'merchant-login', 'merchant-logout',
    'merchant-content', 'merchant-memberships', 'merchant-code', 'merchant-registration']
    .map(id => [id, { ...element(), hidden: true }]));
  const select = { ...element(), value: 'real-merchant' };
  const button = element();
  nodes['merchant-registration'].querySelector = name => name === 'select' ? select : button;
  const listeners = new Map();
  const doc = {
    getElementById(id) { return nodes[id]; },
    querySelector() { return select; },
    createElement() { return element(); },
    defaultView: { addEventListener(type, callback) { listeners.set(type, callback); } },
  };
  return { nodes, select, button, listeners, doc };
}

test('늦은 등록 코드 성공·실패는 페이지를 떠난 뒤 새 계정 화면에 표시하지 않는다', async () => {
  for (const fails of [false, true]) {
    const { nodes, listeners, doc } = merchantDocument();
    let finish;
    const pending = new Promise((resolve, reject) => { finish = fails ? reject : resolve; });
    const fetcher = async path => {
      if (path.endsWith('/registration-requests')) return pending;
      return { ok: true, json: async () => ({ merchants: path.endsWith('/me') ? []
        : [{ id: 'real-merchant', name: '실제 상점' }] }) };
    };
    await bindMerchant(fetcher, doc);
    const submit = nodes['merchant-registration'].submit();
    listeners.get('pagehide')();
    const previousStatus = nodes['merchant-status'].textContent;
    finish(fails ? new Error('late failure') : { ok: true,
      json: async () => ({ code: 'OLD_ACCOUNT_CODE', expiresAt: new Date().toISOString() }) });
    await submit;
    assert.equal(nodes['merchant-code'].textContent, '');
    assert.equal(nodes['merchant-status'].textContent, previousStatus);
    assert.equal(nodes['merchant-content'].hidden, true);
  }
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
