import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as productionWeb from '../../apps/production-web/assets/production.mjs';
const { loadMerchants } = productionWeb;
const html = readFileSync(new URL('../../apps/production-web/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../apps/production-web/assets/production.css', import.meta.url), 'utf8');
const consentAccepted = { required: false, termsVersion: 'terms-2026-10-06', privacyVersion: 'privacy-2026-10-07' };
const emptyCollection = { visits: [], collectibles: [] };
const okJson = value => ({ ok: true, json: async () => value });
function element() {
  const listeners = new Map();
  return {
    textContent: '',
    children: [],
    className: '',
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    append(...children) { this.children.push(...children); },
    replaceChildren() { this.children = []; },
    addEventListener(type, callback) { listeners.set(type, callback); },
    async click() { return listeners.get('click')?.(); },
    async dispatch(type) { return listeners.get(type)?.(); },
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

function collectionFixture() {
  const ids = [
    'collection-status', 'collection-login', 'collection-retry', 'collection-logout',
    'collection-content', 'visit-list', 'collectible-list', 'badge-list',
    'badge-note', 'badge-content', 'badge-passport', 'reward-list', 'coupon-list',
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

function consentDocument() {
  const fixture = collectionFixture();
  const box = () => ({ ...element(), checked: false });
  const focusOrder = [];
  const focusable = (id) => ({ ...element(), focus() { focusOrder.push(id); } });
  Object.assign(fixture.nodes, {
    'consent-panel': { ...element(), hidden: true },
    'consent-age': box(), 'consent-terms': box(), 'consent-privacy': box(),
    'consent-submit': { ...element(), disabled: true },
    'consent-message': element(),
    'consent-hint': { ...element(), hidden: false },
    'consent-title': focusable('consent-title'),
    main: focusable('main'),
  });
  fixture.focusOrder = focusOrder;
  return fixture;
}

const consentRequired = { required: true, termsVersion: 'terms-2026-10-06', privacyVersion: 'privacy-2026-10-07' };
const consentBodySent = {
  termsVersion: 'terms-2026-10-06', privacyVersion: 'privacy-2026-10-07',
  ageConfirmed: true, termsAccepted: true, privacyAccepted: true,
};

// 서버 대역: 동의 상태와 기록에 대한 답을 바꿔 가며 어떤 요청이 갔는지 남긴다.
function consentServer({ status = { ok: true, status: 200, body: consentRequired }, post = { ok: true, status: 200, body: consentAccepted } } = {}) {
  const calls = [];
  const state = { status, post };
  const reply = ({ ok, status: code, body }) => ({ ok, status: code, json: async () => body });
  const fetcher = async (url, options = {}) => {
    calls.push({ url, method: options.method, options });
    if (url === '/api/web/consent') {
      if (options.method === 'POST') {
        const answer = reply(state.post);
        if (state.post.ok && state.post.body?.required === false) state.status = { ok: true, status: 200, body: consentAccepted };
        return answer;
      }
      if (state.status.throws) throw new Error('offline');
      return reply(state.status);
    }
    if (url === '/api/web/collection') return { ok: true, json: async () => emptyCollection };
    if (url === '/api/web/badges') return okJson({});
    throw new Error(`unexpected ${url}`);
  };
  return { fetcher, calls, state };
}

const dataCalls = (calls) => calls.filter((call) => call.url !== '/api/web/consent');
const checkAll = async (nodes) => {
  for (const name of ['consent-age', 'consent-terms', 'consent-privacy']) {
    nodes[name].checked = true;
    await nodes[name].dispatch('change');
  }
};

// Issue #401: 핵심 조회는 헤더 또는 본문이 멈춰도 오류·복구 동선으로 돌아온다.
for (const path of ['/api/web/consent', '/api/web/collection']) {
  for (const phase of ['응답', '본문']) {
    test(`웹 도감 제한 시간: ${path} ${phase} 정체 뒤 재시도·로그아웃 가능`, async () => {
      const { nodes, doc } = consentDocument();
      let signal;
      let stalled = true;
      const { fetcher: healthy } = consentServer({ status: { ok: true, status: 200, body: consentAccepted } });
      const fetcher = (url, options) => {
        if (url !== path || !stalled) return healthy(url, options);
        signal = options.signal;
        const pending = new Promise(() => {});
        return phase === '응답' ? pending : Promise.resolve({ ok: true, json: () => pending });
      };
      const finished = await Promise.race([
        productionWeb.loadCollection(fetcher, doc, { requestTimeoutMs: 10 }).then(() => true),
        new Promise(resolve => setTimeout(() => resolve(false), 100)),
      ]);
      assert.equal(finished, true, '멈춘 요청이 제한 시간 안에 종료되어야 한다');
      assert.equal(signal.aborted, true);
      assert.equal(nodes['collection-retry'].hidden, false);
      assert.equal(nodes['collection-logout'].hidden, false);
      assert.equal(nodes['collection-content'].hidden, true);
      stalled = false;
      await productionWeb.loadCollection(fetcher, doc, { requestTimeoutMs: 10 });
      assert.equal(nodes['collection-content'].hidden, false);
    });
  }
}

test('웹 동의 저장 제한 시간은 체크·초안을 유지하고 다시 누를 수 있게 한다', async () => {
  const { nodes, doc } = consentDocument();
  const { fetcher: healthy } = consentServer();
  let stalled = true;
  let signal;
  const fetcher = (url, options) => {
    if (options.method !== 'POST' || !stalled) return healthy(url, options);
    signal = options.signal;
    return Promise.resolve({ ok: true, json: () => new Promise(() => {}) });
  };
  await productionWeb.bindCollectionControls(fetcher, doc, { requestTimeoutMs: 10 });
  await checkAll(nodes);
  const finished = await Promise.race([
    nodes['consent-submit'].click().then(() => true),
    new Promise(resolve => setTimeout(() => resolve(false), 100)),
  ]);
  assert.equal(finished, true);
  assert.equal(signal.aborted, true);
  assert.equal(nodes['consent-submit'].disabled, false);
  assert.equal(nodes['consent-age'].checked, true);
  assert.match(nodes['consent-message'].textContent, /다시 시도/);
  stalled = false;
  await nodes['consent-submit'].click();
  assert.equal(nodes['collection-content'].hidden, false);
});

test('웹 로그아웃 제한 시간 뒤 실패를 알리고 로그아웃을 다시 누를 수 있다', async () => {
  const { nodes, doc } = consentDocument();
  const { fetcher: healthy, state } = consentServer({ status: { ok: true, status: 200, body: consentAccepted } });
  let stalled = true;
  let signal;
  const fetcher = (url, options) => {
    if (url !== '/api/web/logout') return healthy(url, options);
    signal = options.signal;
    if (stalled) return new Promise(() => {});
    state.status = { ok: false, status: 401 };
    return Promise.resolve({ ok: true, status: 204 });
  };
  await productionWeb.bindCollectionControls(fetcher, doc, { requestTimeoutMs: 10 });
  const finished = await Promise.race([
    nodes['collection-logout'].click().then(() => true),
    new Promise(resolve => setTimeout(() => resolve(false), 100)),
  ]);
  assert.equal(finished, true);
  assert.equal(signal.aborted, true);
  assert.equal(nodes['collection-logout'].hidden, false);
  assert.equal(nodes['collection-retry'].hidden, false);
  assert.match(nodes['collection-status'].textContent, /로그아웃을 확인하지 못/);
  stalled = false;
  await nodes['collection-logout'].click();
  assert.equal(nodes['collection-login'].hidden, false);
});

test('공개 점포 0곳에서만 같은 안내 상자의 체험·설치 링크를 표시한다', async () => {
  const fixture = documentFixture();
  const empty = { ...element(), hidden: true };
  const get = fixture.doc.getElementById;
  fixture.doc.getElementById = id => id === 'merchant-empty' ? empty : get(id);
  await loadMerchants(async () => okJson({ merchants: [] }), fixture.doc);
  assert.equal(empty.hidden, false);
  assert.match(fixture.status.textContent, /아직 입점 준비 중/);
  assert.match(html, /id="merchant-empty"[^>]*hidden/);
  const box = html.slice(html.indexOf('id="merchant-empty"'), html.indexOf('id="merchant-list"'));
  assert.match(box, /href="https:\/\/demo-api.masscom.kr\/play\/"[^>]*>시연 웹으로 바로 체험하기/);
  assert.match(box, /href="\/open"[^>]*>Android 설치 안내/);
  await loadMerchants(async () => okJson({ merchants: [{ name: '공개 가게', story: '', roadAddress: '서울', demo: false }] }), fixture.doc);
  assert.equal(empty.hidden, true);
  await loadMerchants(async () => { throw new Error('offline'); }, fixture.doc);
  assert.equal(empty.hidden, true);
});

test('운영 웹 favicon은 이미 제공하는 마스코트 PNG를 사용한다', () => {
  assert.match(html, /<link rel="icon" type="image\/png" href="assets\/mascot-stamp.png">/);
  assert.match(css, /word-break: keep-all/);
  assert.match(css, /\.collection-action[^}]*min-height: 48px/);
});
