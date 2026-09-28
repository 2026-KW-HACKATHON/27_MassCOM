import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';

import { bindCollectionControls, loadCollection, loadMerchants } from '../../apps/production-web/assets/production.mjs';
import { bindAdmin, loadAdmin, parseMenuLines } from '../../apps/production-web/assets/admin.mjs';
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
  assert.match(webDockerfile, /COPY apps\/production-web\/merchant\.html \.\/merchant\.html/);
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

test('실제 메뉴 가격과 점포 제공 영업시간을 표시하고 없는 값은 안내한다', async () => {
  const { list, doc } = documentFixture();
  await loadMerchants(async () => ({ ok: true, json: async () => ({ merchants: [
    { name: '실제 점포', story: '', roadAddress: '서울', demo: false,
      menuItems: [{ name: '<김밥>', priceWon: 4500 }], businessHours: '월–금 10:00–18:00' },
    { name: '미입력 점포', story: '', roadAddress: '서울', demo: false,
      menuItems: [], businessHours: '' },
  ] }) }), doc);
  assert.equal(list.children.length, 2);
  assert.match(list.children[0].children.map(child => child.textContent).join(' '), /<김밥>.*4,500원/);
  assert.match(list.children[0].children.map(child => child.textContent).join(' '), /점포 제공 영업시간.*월–금/);
  assert.match(list.children[1].children.map(child => child.textContent).join(' '), /메뉴 정보가 아직 없습니다/);
  assert.match(list.children[1].children.map(child => child.textContent).join(' '), /영업시간 정보가 아직 없습니다/);
});

test('운영 프록시는 시연 점포를 제외하고 메뉴와 영업시간만 전달한다', async () => {
  const server = createProductionServer(async () => Response.json({ merchants: [
    { name: '실제 점포', story: '', roadAddress: '서울', demo: false,
      menuItems: [{ name: '김밥', priceWon: 4500 }], businessHours: '월–금 10:00–18:00' },
    { name: '시연 점포', story: '', roadAddress: '가상', demo: true,
      menuItems: [{ name: '가상 메뉴', priceWon: 100 }], businessHours: '가상 시간' },
  ] }));
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/merchants`);
    assert.deepEqual(await response.json(), { merchants: [{ name: '실제 점포', story: '', roadAddress: '서울', demo: false,
      menuItems: [{ name: '김밥', priceWon: 4500 }], businessHours: '월–금 10:00–18:00' }] });
  } finally { await new Promise(done => server.close(done)); }
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

test('관리자 메뉴 입력은 실제 가격 행만 만들고 잘못된 형식은 거부한다', () => {
  assert.deepEqual(parseMenuLines('김밥 | 4500\n라면 | 6000\n'), [
    { name: '김밥', priceWon: 4500 }, { name: '라면', priceWon: 6000 },
  ]);
  assert.deepEqual(parseMenuLines(''), []);
  assert.throws(() => parseMenuLines('김밥 | 4,500'), /메뉴/);
  assert.throws(() => parseMenuLines('김밥 | -1'), /메뉴/);
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
    'merchant-content', 'merchant-memberships', 'merchant-code', 'merchant-registration',
    'merchant-claim-form', 'merchant-claim-merchant', 'merchant-claim-token',
    'merchant-claim-reference', 'merchant-claim-confirm', 'merchant-claim-resolve',
    'merchant-claim-submit', 'merchant-claim-result', 'merchant-claim-scan',
    'merchant-claim-scan-cancel', 'merchant-claim-video', 'merchant-claim-issued-qr',
    'merchant-claim-reissue', 'merchant-claim-reissue-confirm', 'merchant-claim-reissue-submit']
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

test('점포 웹은 고객 QR 확인 후 명시적 사용 동의로만 방문 코드를 발급한다', async () => {
  const { nodes, doc, listeners } = merchantDocument();
  const calls = [];
  const fetcher = async (path, options) => {
    calls.push({ path, options });
    if (path === '/api/web/merchant/me') return { ok: true, json: async () => ({ merchants: [
      { id: 'real-merchant', name: '실제 점포', role: 'STAFF' },
    ] }) };
    if (path === '/api/web/merchant/registration-merchants') return { ok: true,
      json: async () => ({ merchants: [] }) };
    if (path.endsWith('/customer-identities/resolve')) return { ok: true,
      json: async () => ({ expiresAt: '2026-09-28T12:00:00.000Z' }) };
    return { ok: true, status: 201, json: async () => ({ token: 'first-claim-token', claimSlotId: 'slot-1',
      qrSvgDataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }) };
  };
  await bindMerchant(fetcher, doc);
  nodes['merchant-claim-merchant'].value = 'real-merchant';
  nodes['merchant-claim-token'].value = 'customer-qr';
  nodes['merchant-claim-reference'].value = 'sale-1';
  await nodes['merchant-claim-form'].submit();
  assert.equal(calls.length, 2);
  await nodes['merchant-claim-resolve'].click();
  assert.equal(calls.at(-1).path, '/api/web/merchant/merchants/real-merchant/customer-identities/resolve');
  assert.equal(nodes['merchant-claim-submit'].disabled, true);
  await nodes['merchant-claim-form'].submit();
  assert.equal(calls.length, 3);
  nodes['merchant-claim-confirm'].checked = true;
  await nodes['merchant-claim-form'].submit();
  assert.equal(calls.at(-1).path, '/api/web/merchant/merchants/real-merchant/claim-slots');
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), {
    customerIdentityToken: 'customer-qr', merchantReference: 'sale-1', useConfirmed: true,
  });
  assert.match(nodes['merchant-claim-result'].textContent, /first-claim-token/);
  assert.equal(nodes['merchant-claim-issued-qr'].hidden, false);
  assert.match(nodes['merchant-claim-issued-qr'].src, /^data:image\/svg\+xml;base64,/);
  listeners.get('pagehide')();
  assert.equal(nodes['merchant-claim-issued-qr'].hidden, true);
  assert.equal(nodes['merchant-claim-issued-qr'].src, '');
});

test('QR 그림 생성 실패는 원래 발급 코드를 남기고 직접 입력을 안내한다', async () => {
  const { nodes, doc } = merchantDocument();
  const fetcher = async path => {
    if (path.endsWith('/me')) return { ok: true, json: async () => ({ merchants: [
      { id: 'real-merchant', name: '실제 점포', role: 'STAFF' },
    ] }) };
    if (path.endsWith('/registration-merchants')) return { ok: true, json: async () => ({ merchants: [] }) };
    if (path.endsWith('/customer-identities/resolve')) return { ok: true,
      json: async () => ({ expiresAt: '2026-09-28T12:00:00.000Z' }) };
    return { ok: true, status: 201,
      json: async () => ({ token: 'ONLY_TOKEN', expiresAt: '2026-09-28T12:10:00.000Z', qrRenderFailed: true }) };
  };
  await bindMerchant(fetcher, doc);
  nodes['merchant-claim-merchant'].value = 'real-merchant';
  nodes['merchant-claim-token'].value = 'customer-qr';
  nodes['merchant-claim-reference'].value = 'sale-1';
  await nodes['merchant-claim-resolve'].click();
  nodes['merchant-claim-confirm'].checked = true;
  await nodes['merchant-claim-form'].submit();
  assert.match(nodes['merchant-claim-result'].textContent, /ONLY_TOKEN/);
  assert.match(nodes['merchant-claim-result'].textContent, /직접 입력/);
  assert.equal(nodes['merchant-claim-issued-qr'].hidden, true);
});

test('QR 카메라 미지원·권한 거부 시 입력을 유지하고 취소하면 카메라 트랙을 끈다', async () => {
  const { nodes, doc, listeners } = merchantDocument();
  const fetcher = async path => ({ ok: true, json: async () => ({ merchants: path.endsWith('/me')
    ? [{ id: 'real-merchant', name: '실제 점포', role: 'STAFF' }] : [] }) });
  await bindMerchant(fetcher, doc);
  nodes['merchant-claim-token'].value = 'manual-scanner-token';
  await nodes['merchant-claim-scan'].click();
  assert.equal(nodes['merchant-claim-token'].value, 'manual-scanner-token');
  assert.match(nodes['merchant-claim-result'].textContent, /직접 입력/);

  const stopped = [];
  doc.defaultView.BarcodeDetector = class {
    static async getSupportedFormats() { return ['qr_code']; }
    async detect() { return []; }
  };
  doc.defaultView.navigator = { mediaDevices: { async getUserMedia() { throw new Error('denied'); } } };
  await nodes['merchant-claim-scan'].click();
  assert.equal(nodes['merchant-claim-token'].value, 'manual-scanner-token');
  assert.match(nodes['merchant-claim-result'].textContent, /직접 입력/);

  doc.defaultView.navigator.mediaDevices.getUserMedia = async () => ({
    getTracks: () => [{ stop: () => stopped.push('stopped') }],
  });
  nodes['merchant-claim-video'].play = async () => {};
  doc.defaultView.requestAnimationFrame = () => 1;
  await nodes['merchant-claim-scan'].click();
  assert.equal(nodes['merchant-claim-video'].hidden, false);
  await nodes['merchant-claim-scan-cancel'].click();
  assert.deepEqual(stopped, ['stopped']);
  assert.equal(nodes['merchant-claim-video'].srcObject, null);
  assert.equal(nodes['merchant-claim-token'].value, 'manual-scanner-token');
  listeners.get('pagehide')();
  assert.equal(stopped.length, 1);
});

test('QR 스캔 성공과 페이지 이탈은 카메라를 닫고 늦은 권한 응답도 정리한다', async () => {
  const { nodes, doc, listeners } = merchantDocument();
  await bindMerchant(async path => ({ ok: true, json: async () => ({ merchants: path.endsWith('/me')
    ? [{ id: 'real-merchant', name: '실제 점포', role: 'STAFF' }] : [] }) }), doc);
  const stopped = [];
  let frame;
  doc.defaultView.requestAnimationFrame = callback => { frame = callback; return 1; };
  doc.defaultView.BarcodeDetector = class {
    static async getSupportedFormats() { return ['qr_code']; }
    async detect() { return [{ format: 'qr_code', rawValue: 'camera-qr-token' }]; }
  };
  nodes['merchant-claim-video'].play = async () => {};
  doc.defaultView.navigator = { mediaDevices: { async getUserMedia() {
    return { getTracks: () => [{ stop: () => stopped.push('success') }] };
  } } };
  await nodes['merchant-claim-scan'].click();
  await frame();
  assert.equal(nodes['merchant-claim-token'].value, 'camera-qr-token');
  assert.deepEqual(stopped, ['success']);
  assert.equal(nodes['merchant-claim-video'].srcObject, null);

  let release;
  doc.defaultView.navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { release = resolve; });
  const starting = nodes['merchant-claim-scan'].click();
  await Promise.resolve();
  await Promise.resolve();
  listeners.get('pagehide')();
  release({ getTracks: () => [{ stop: () => stopped.push('late') }] });
  await starting;
  assert.deepEqual(stopped, ['success', 'late']);
  assert.equal(nodes['merchant-claim-video'].srcObject, null);
  assert.equal(nodes['merchant-claim-token'].value, '');
});

test('점포 화면 재조회 뒤에는 같은 QR을 다시 입력해도 재확인 전 발급할 수 없다', async () => {
  const { nodes, doc } = merchantDocument();
  let issues = 0;
  const fetcher = async path => {
    if (path.endsWith('/me')) return { ok: true, json: async () => ({ merchants: [
      { id: 'real-merchant', name: '실제 점포', role: 'STAFF' },
    ] }) };
    if (path.endsWith('/registration-merchants')) return { ok: true, json: async () => ({ merchants: [] }) };
    if (path.endsWith('/customer-identities/resolve')) return { ok: true,
      json: async () => ({ expiresAt: '2026-09-28T12:00:00.000Z' }) };
    issues += 1;
    return { ok: true, status: 201, json: async () => ({ token: 'claim-token' }) };
  };
  await bindMerchant(fetcher, doc);
  nodes['merchant-claim-merchant'].value = 'real-merchant';
  nodes['merchant-claim-token'].value = 'customer-qr';
  await nodes['merchant-claim-resolve'].click();
  await loadMerchant(fetcher, doc);
  nodes['merchant-claim-merchant'].value = 'real-merchant';
  nodes['merchant-claim-token'].value = 'customer-qr';
  nodes['merchant-claim-reference'].value = 'sale-1';
  nodes['merchant-claim-confirm'].checked = true;
  await nodes['merchant-claim-form'].submit();
  assert.equal(issues, 0);
});

test('발급 응답 실패 뒤 재확인한 재시도는 같은 요청을 보내고 원래 코드를 표시하지 않는다', async () => {
  const { nodes, doc } = merchantDocument();
  const bodies = [];
  const fetcher = async (path, options) => {
    if (path.endsWith('/me')) return { ok: true, json: async () => ({ merchants: [
      { id: 'real-merchant', name: '실제 점포', role: 'STAFF' },
    ] }) };
    if (path.endsWith('/registration-merchants')) return { ok: true, json: async () => ({ merchants: [] }) };
    if (path.endsWith('/customer-identities/resolve')) return { ok: true,
      json: async () => ({ expiresAt: '2026-09-28T12:00:00.000Z' }) };
    bodies.push(options.body);
    if (bodies.length === 1) throw new Error('response lost');
    return { ok: true, status: 200, json: async () => ({ claimSlotId: 'slot-1', replayed: true,
      tokenVersion: 1, expiresAt: '2026-09-28T12:10:00.000Z' }) };
  };
  await bindMerchant(fetcher, doc);
  nodes['merchant-claim-merchant'].value = 'real-merchant';
  nodes['merchant-claim-token'].value = 'customer-qr';
  nodes['merchant-claim-reference'].value = 'sale-1';
  await nodes['merchant-claim-resolve'].click();
  nodes['merchant-claim-confirm'].checked = true;
  await nodes['merchant-claim-form'].submit();
  nodes['merchant-claim-confirm'].checked = true;
  await nodes['merchant-claim-form'].submit();
  assert.equal(bodies.length, 2);
  assert.deepEqual(bodies[1], bodies[0]);
  assert.match(nodes['merchant-claim-result'].textContent, /다시 표시되지 않습니다/);
  assert.doesNotMatch(nodes['merchant-claim-result'].textContent, /방문 코드:/);
  assert.equal(nodes['merchant-claim-reissue'].hidden, false);
});

test('처음 발급 응답을 잃어도 재전송으로 슬롯을 찾아 명시적 확인 뒤 새 QR을 발급한다', async () => {
  const { nodes, doc } = merchantDocument();
  const calls = [];
  let finishReissue;
  const pendingReissue = new Promise(resolve => { finishReissue = resolve; });
  const fetcher = async (path, options) => {
    if (path.endsWith('/me')) return { ok: true, json: async () => ({ merchants: [
      { id: 'real-merchant', name: '실제 점포', role: 'STAFF' },
    ] }) };
    if (path.endsWith('/registration-merchants')) return { ok: true, json: async () => ({ merchants: [] }) };
    if (path.endsWith('/customer-identities/resolve')) return { ok: true,
      json: async () => ({ expiresAt: '2026-09-28T12:00:00.000Z' }) };
    calls.push({ path, options });
    if (path.endsWith('/reissue')) return pendingReissue;
    if (calls.length === 1) throw new Error('first response lost');
    return { ok: true, status: 200, json: async () => ({ claimSlotId: 'slot-1', replayed: true,
      tokenVersion: 1, expiresAt: '2026-09-28T12:10:00.000Z' }) };
  };
  await bindMerchant(fetcher, doc);
  nodes['merchant-claim-merchant'].value = 'real-merchant';
  nodes['merchant-claim-token'].value = 'customer-qr';
  nodes['merchant-claim-reference'].value = 'sale-1';
  await nodes['merchant-claim-resolve'].click();
  nodes['merchant-claim-confirm'].checked = true;
  await nodes['merchant-claim-form'].submit();
  nodes['merchant-claim-confirm'].checked = true;
  await nodes['merchant-claim-form'].submit();
  assert.equal(nodes['merchant-claim-reissue'].hidden, false);
  assert.equal(nodes['merchant-claim-reissue-submit'].disabled, true);
  await nodes['merchant-claim-reissue-submit'].click();
  assert.equal(calls.length, 2);
  nodes['merchant-claim-reissue-confirm'].checked = true;
  const reissuing = nodes['merchant-claim-reissue-submit'].click();
  await nodes['merchant-claim-reissue-submit'].click();
  assert.equal(calls.length, 3);
  assert.match(calls[2].path, /real-merchant\/claim-slots\/slot-1\/reissue$/);
  assert.deepEqual(JSON.parse(calls[2].options.body), { expectedTokenVersion: 1 });
  assert.equal(nodes['merchant-claim-issued-qr'].hidden, true);
  finishReissue({ ok: true, status: 200, json: async () => ({ claimSlotId: 'slot-1',
    token: 'NEW_TOKEN', tokenVersion: 2, expiresAt: '2026-09-28T12:20:00.000Z',
    qrSvgDataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }) });
  await reissuing;
  assert.match(nodes['merchant-claim-result'].textContent, /NEW_TOKEN/);
  assert.equal(nodes['merchant-claim-issued-qr'].hidden, false);
  assert.equal(nodes['merchant-claim-reissue-submit'].disabled, true);
});

test('재발급 응답을 잃으면 이전 QR을 숨기고 결과 불명으로 표시하며 자동 반복하지 않는다', async () => {
  const { nodes, doc } = merchantDocument();
  let reissueCalls = 0;
  const fetcher = async path => {
    if (path.endsWith('/me')) return { ok: true, json: async () => ({ merchants: [
      { id: 'real-merchant', name: '실제 점포', role: 'STAFF' },
    ] }) };
    if (path.endsWith('/registration-merchants')) return { ok: true, json: async () => ({ merchants: [] }) };
    if (path.endsWith('/customer-identities/resolve')) return { ok: true,
      json: async () => ({ expiresAt: '2026-09-28T12:00:00.000Z' }) };
    if (path.endsWith('/reissue')) { reissueCalls += 1; throw new Error('response lost'); }
    return { ok: true, status: 201, json: async () => ({ claimSlotId: 'slot-1', tokenVersion: 1,
      token: 'OLD_TOKEN', expiresAt: '2026-09-28T12:10:00.000Z',
      qrSvgDataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }) };
  };
  await bindMerchant(fetcher, doc);
  nodes['merchant-claim-merchant'].value = 'real-merchant';
  nodes['merchant-claim-token'].value = 'customer-qr';
  nodes['merchant-claim-reference'].value = 'sale-1';
  await nodes['merchant-claim-resolve'].click();
  nodes['merchant-claim-confirm'].checked = true;
  await nodes['merchant-claim-form'].submit();
  assert.equal(nodes['merchant-claim-issued-qr'].hidden, false);
  nodes['merchant-claim-reissue-confirm'].checked = true;
  await nodes['merchant-claim-reissue-submit'].click();
  assert.equal(nodes['merchant-claim-issued-qr'].hidden, true);
  assert.equal(nodes['merchant-claim-issued-qr'].src, '');
  assert.match(nodes['merchant-claim-result'].textContent, /결과를 확인하지 못했습니다/);
  assert.equal(nodes['merchant-claim-reissue'].hidden, true);
  await nodes['merchant-claim-reissue-submit'].click();
  assert.equal(reissueCalls, 1);
});

test('재발급 QR 그림 실패는 새 코드를 직접 입력하도록 안내한다', async () => {
  const { nodes, doc } = merchantDocument();
  const fetcher = async path => {
    if (path.endsWith('/me')) return { ok: true, json: async () => ({ merchants: [
      { id: 'real-merchant', name: '실제 점포', role: 'STAFF' },
    ] }) };
    if (path.endsWith('/registration-merchants')) return { ok: true, json: async () => ({ merchants: [] }) };
    if (path.endsWith('/customer-identities/resolve')) return { ok: true,
      json: async () => ({ expiresAt: '2026-09-28T12:00:00.000Z' }) };
    return { ok: true, status: 200, json: async () => path.endsWith('/reissue')
      ? { claimSlotId: 'slot-1', tokenVersion: 2, token: 'NEW_MANUAL_TOKEN',
        expiresAt: '2026-09-28T12:20:00.000Z', qrRenderFailed: true }
      : { claimSlotId: 'slot-1', tokenVersion: 1, token: 'OLD_TOKEN',
        expiresAt: '2026-09-28T12:10:00.000Z', qrSvgDataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' } };
  };
  await bindMerchant(fetcher, doc);
  nodes['merchant-claim-merchant'].value = 'real-merchant';
  nodes['merchant-claim-token'].value = 'customer-qr';
  nodes['merchant-claim-reference'].value = 'sale-1';
  await nodes['merchant-claim-resolve'].click();
  nodes['merchant-claim-confirm'].checked = true;
  await nodes['merchant-claim-form'].submit();
  nodes['merchant-claim-reissue-confirm'].checked = true;
  await nodes['merchant-claim-reissue-submit'].click();
  assert.match(nodes['merchant-claim-result'].textContent, /NEW_MANUAL_TOKEN.*직접 입력/);
  assert.equal(nodes['merchant-claim-issued-qr'].hidden, true);
});

test('로그아웃 뒤 늦은 재발급 응답은 새 계정 화면에 나타나지 않는다', async () => {
  const { nodes, doc } = merchantDocument();
  let finishReissue;
  const pendingReissue = new Promise(resolve => { finishReissue = resolve; });
  const fetcher = async path => {
    if (path === '/api/web/logout') return { ok: true, status: 204 };
    if (path.endsWith('/me')) return { ok: true, json: async () => ({ merchants: [
      { id: 'real-merchant', name: '실제 점포', role: 'STAFF' },
    ] }) };
    if (path.endsWith('/registration-merchants')) return { ok: true, json: async () => ({ merchants: [] }) };
    if (path.endsWith('/customer-identities/resolve')) return { ok: true,
      json: async () => ({ expiresAt: '2026-09-28T12:00:00.000Z' }) };
    if (path.endsWith('/reissue')) return pendingReissue;
    return { ok: true, status: 201, json: async () => ({ claimSlotId: 'slot-1', tokenVersion: 1,
      token: 'OLD_TOKEN', expiresAt: '2026-09-28T12:10:00.000Z' }) };
  };
  await bindMerchant(fetcher, doc);
  nodes['merchant-claim-merchant'].value = 'real-merchant';
  nodes['merchant-claim-token'].value = 'customer-qr';
  nodes['merchant-claim-reference'].value = 'sale-1';
  await nodes['merchant-claim-resolve'].click();
  nodes['merchant-claim-confirm'].checked = true;
  await nodes['merchant-claim-form'].submit();
  nodes['merchant-claim-reissue-confirm'].checked = true;
  const reissuing = nodes['merchant-claim-reissue-submit'].click();
  await nodes['merchant-logout'].click();
  finishReissue({ ok: true, status: 200, json: async () => ({ claimSlotId: 'slot-1',
    tokenVersion: 2, token: 'LATE_TOKEN', expiresAt: '2026-09-28T12:20:00.000Z' }) });
  await reissuing;
  assert.doesNotMatch(nodes['merchant-claim-result'].textContent, /LATE_TOKEN/);
  assert.equal(nodes['merchant-claim-reissue'].hidden, true);
});

test('방문 코드 발급 중 중복 제출과 QR 재확인은 첫 발급 토큰을 덮어쓰지 않는다', async () => {
  const { nodes, doc } = merchantDocument();
  let release;
  const firstIssue = new Promise(resolve => { release = resolve; });
  let resolveCalls = 0;
  let issueCalls = 0;
  const fetcher = async path => {
    if (path.endsWith('/me')) return { ok: true, json: async () => ({ merchants: [
      { id: 'real-merchant', name: '실제 점포', role: 'STAFF' },
    ] }) };
    if (path.endsWith('/registration-merchants')) return { ok: true, json: async () => ({ merchants: [] }) };
    if (path.endsWith('/customer-identities/resolve')) {
      resolveCalls += 1;
      return { ok: true, json: async () => ({ expiresAt: '2026-09-28T12:00:00.000Z' }) };
    }
    issueCalls += 1;
    return issueCalls === 1 ? firstIssue : { ok: true, status: 200,
      json: async () => ({ claimSlotId: 'slot-1', replayed: true }) };
  };
  await bindMerchant(fetcher, doc);
  nodes['merchant-claim-merchant'].value = 'real-merchant';
  nodes['merchant-claim-token'].value = 'customer-qr';
  nodes['merchant-claim-reference'].value = 'sale-1';
  await nodes['merchant-claim-resolve'].click();
  nodes['merchant-claim-confirm'].checked = true;
  const issuing = nodes['merchant-claim-form'].submit();
  assert.equal(nodes['merchant-claim-reference'].disabled, true);
  assert.equal(nodes['merchant-claim-resolve'].disabled, true);
  nodes['merchant-claim-confirm'].checked = false;
  nodes['merchant-claim-confirm'].checked = true;
  const duplicate = nodes['merchant-claim-form'].submit();
  await nodes['merchant-claim-resolve'].click();
  assert.equal(issueCalls, 1);
  assert.equal(resolveCalls, 1);
  release({ ok: true, status: 201, json: async () => ({ token: 'FIRST_TOKEN',
    expiresAt: '2026-09-28T12:10:00.000Z' }) });
  await Promise.all([issuing, duplicate]);
  assert.match(nodes['merchant-claim-result'].textContent, /FIRST_TOKEN/);
  assert.equal(nodes['merchant-claim-reference'].disabled, false);
});

test('로그아웃 뒤 늦게 도착한 방문 코드 응답은 새 화면에 표시하지 않는다', async () => {
  const { nodes, doc } = merchantDocument();
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const fetcher = async path => {
    if (path === '/api/web/logout') return { ok: true, status: 204 };
    if (path.endsWith('/me')) return { ok: true, json: async () => ({ merchants: [
      { id: 'real-merchant', name: '실제 점포', role: 'STAFF' },
    ] }) };
    if (path.endsWith('/registration-merchants')) return { ok: true, json: async () => ({ merchants: [] }) };
    if (path.endsWith('/customer-identities/resolve')) return { ok: true,
      json: async () => ({ expiresAt: '2026-09-28T12:00:00.000Z' }) };
    return pending;
  };
  await bindMerchant(fetcher, doc);
  nodes['merchant-claim-merchant'].value = 'real-merchant';
  nodes['merchant-claim-token'].value = 'customer-qr';
  nodes['merchant-claim-reference'].value = 'sale-1';
  await nodes['merchant-claim-resolve'].click();
  nodes['merchant-claim-confirm'].checked = true;
  const issuing = nodes['merchant-claim-form'].submit();
  await nodes['merchant-logout'].click();
  finish({ ok: true, status: 201, json: async () => ({ token: 'OLD_ACCOUNT_TOKEN',
    expiresAt: '2026-09-28T12:10:00.000Z' }) });
  await issuing;
  assert.doesNotMatch(nodes['merchant-claim-result'].textContent, /OLD_ACCOUNT_TOKEN/);
  assert.equal(nodes['merchant-claim-token'].value, '');
});

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

test('등록 요청 중 이탈했다 돌아오면 이전 응답과 무관하게 다시 발급할 수 있다', async () => {
  for (const fails of [false, true]) {
    const { nodes, button, listeners, doc } = merchantDocument();
    let finishOld;
    const oldResponse = new Promise((resolve, reject) => { finishOld = fails ? reject : resolve; });
    let requests = 0;
    const fetcher = async path => {
      if (path.endsWith('/registration-requests')) {
        requests += 1;
        return requests === 1 ? oldResponse : { ok: true,
          json: async () => ({ code: 'NEW_CODE', expiresAt: new Date().toISOString() }) };
      }
      return { ok: true, json: async () => ({ merchants: path.endsWith('/me') ? []
        : [{ id: 'real-merchant', name: '실제 상점' }] }) };
    };
    await bindMerchant(fetcher, doc);
    const oldSubmit = nodes['merchant-registration'].submit();
    assert.equal(button.disabled, true);
    listeners.get('pagehide')();
    await loadMerchant(fetcher, doc);
    assert.equal(button.disabled, false);
    finishOld(fails ? new Error('late failure') : { ok: true,
      json: async () => ({ code: 'OLD_ACCOUNT_CODE', expiresAt: new Date().toISOString() }) });
    await oldSubmit;
    assert.equal(nodes['merchant-code'].textContent, '');
    assert.equal(button.disabled, false);
    await nodes['merchant-registration'].submit();
    assert.match(nodes['merchant-code'].textContent, /NEW_CODE/);
    assert.equal(requests, 2);
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
      { name: '실제 점포', story: '가게 소개', roadAddress: '서울', menuItems: [], businessHours: '', demo: false },
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
    { name: '가격 범위 초과', story: '', roadAddress: '서울', demo: false,
      menuItems: [{ name: '메뉴', priceWon: 1_000_000_001 }], businessHours: '' },
    { name: '시간 길이 초과', story: '', roadAddress: '서울', demo: false,
      menuItems: [], businessHours: '가'.repeat(1001) },
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
