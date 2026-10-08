import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
// Issue #401 회귀를 기존 CI 검사에서도 실행한다.
import './production-recovery.test.mjs';

import * as productionWeb from '../../apps/production-web/assets/production.mjs';
import { bindAdmin, campaignDraftPayload, couponVoidMessage, formatKst, loadAdmin, parseMenuLines } from '../../apps/production-web/assets/admin.mjs';
import {
  barWidthPercent, bindMerchant, campaignPhaseLabel, couponUndoMessage, dayLabel, loadMerchant, overviewComparisonText,
  readinessStateLabel, readinessRequestText, operatorContact, visitCancelMessage,
} from '../../apps/production-web/assets/merchant.mjs';
import { createProductionServer, resolveProductionBindHost } from '../../apps/production-web/server.mjs';

const { loadMerchants } = productionWeb;

// 도감은 동의를 확인한 뒤에만 읽는다(Issue #253). 아래 기존 시험은 이미 동의한 계정을 전제로 하므로 동의 조회에 "동의함"으로 답하는 fetcher로 감싼다.
// 동의 화면 자체의 시험은 이 파일 끝의 "웹 첫 로그인 동의" 시험이 감싸지 않은 productionWeb.loadCollection으로 한다.
const consentAccepted = { required: false, termsVersion: 'terms-2026-10-06', privacyVersion: 'privacy-2026-10-07' };
const withConsent = (fetcher) => (url, options) => (url === '/api/web/consent'
  ? Promise.resolve({ ok: true, status: 200, json: async () => consentAccepted })
  : fetcher(url, options));
const loadCollection = (fetcher, doc, options) => productionWeb.loadCollection(withConsent(fetcher), doc, options);
const bindCollectionControls = (fetcher, doc) => productionWeb.bindCollectionControls(withConsent(fetcher), doc);

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
  const value = {
    textContent: '',
    children: [],
    className: '',
    attributes: {},
    dataset: {},
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    removeAttribute(name) { delete this.attributes[name]; },
    append(...children) { this.children.push(...children); },
    replaceChildren() { this.children = []; },
    addEventListener(type, callback) { listeners.set(type, callback); },
    async click() { return listeners.get('click')?.(); },
    async dispatch(type) { return listeners.get(type)?.(); },
    async submit() { return listeners.get('submit')?.({ preventDefault() {}, currentTarget: this }); },
  };
  value.classList = {
    toggle(className, force) {
      const classes = new Set(String(value.className || '').split(/\s+/).filter(Boolean));
      const on = force === undefined ? !classes.has(className) : Boolean(force);
      if (on) classes.add(className); else classes.delete(className);
      value.className = [...classes].join(' ');
      return on;
    },
  };
  return value;
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
  assert.match(css, /#2456D6/i);
  assert.doesNotMatch(html + script + serverSource, /localStorage|innerHTML|dangerouslySetInnerHTML/);
  assert.doesNotMatch(html + script, /가상 점포|예시 방문|실제 NFT가 아닙니다|DEMO 배지/);
  assert.doesNotMatch(html, /<form\b|href="[^"]*(?:wallet|mint|claim|qr)|data-action="[^"]*(?:wallet|mint|claim|qr)/i);
  assert.match(script, /textContent = merchant\.name/);
  assert.match(script, /merchant\.demo === false/);
});

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

const badgesFixture = (overrides = {}) => ({
  medals: [
    { kind: 'explorer', value: 2, tier: 2, thresholds: [1, 2, 3] },
    { kind: 'regular', value: 1, tier: 0, thresholds: [2, 3, 5] },
    { kind: 'steady', value: 7, tier: 3, thresholds: [2, 4, 7] },
  ],
  earnedTiers: 5,
  rewards: [
    { milestone: 1, requiredTiers: 3, state: 'OPENED',
      offer: { merchantId: 'm1', merchantName: '<b>운영 점포</b>', title: '음료 1잔', detail: '', validDays: 30 },
      coupon: { couponId: 'c1', milestone: 1, merchantId: 'm1', merchantName: '<b>운영 점포</b>', title: '음료 1잔',
        detail: '', status: 'ISSUED', issuedAt: '2026-09-29T00:00:00.000Z', expiresAt: '2026-10-29T00:00:00.000Z', redeemedAt: null } },
    { milestone: 2, requiredTiers: 6, state: 'LOCKED', offer: null, coupon: null },
    { milestone: 3, requiredTiers: 9, state: 'LOCKED', offer: null, coupon: null },
  ],
  ...overrides,
});

const emptyCollection = { visits: [], collectibles: [] };

function collectionAndBadges({ badges, collection = emptyCollection } = {}) {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (url === '/api/web/badges') return badges();
    if (url === '/api/web/collection') return { ok: true, json: async () => collection };
    throw new Error(`unexpected ${url}`);
  };
  return { calls, fetcher };
}

const okJson = (value) => ({ ok: true, json: async () => value });

// 가짜 DOM에서 자손을 클래스로 찾고 글자를 모은다. textContent를 가진 노드만 글자를 낸다.
const classesOf = (node) => String(node?.className ?? '').split(/\s+/).filter(Boolean);
function findAll(root, className) {
  const found = [];
  const walk = (current) => {
    for (const child of current.children ?? []) {
      if (child && typeof child === 'object') {
        if (classesOf(child).includes(className)) found.push(child);
        walk(child);
      }
    }
  };
  walk(root);
  return found;
}
const textOf = (node) => [node.textContent, ...(node.children ?? []).map(textOf)].join('');
const first = (root, className) => findAll(root, className)[0];
const texts = (roots, className) => roots.map((root) => first(root, className)?.textContent);

test('운영 웹 메달은 서버가 계산한 등급·값·다음 등급을 글자로 표시하고 도감과 함께 읽는다', async () => {
  const { nodes, doc } = collectionFixture();
  const { calls, fetcher } = collectionAndBadges({ badges: () => okJson(badgesFixture()) });
  await loadCollection(fetcher, doc);
  const badgeCall = calls.find((call) => call.url === '/api/web/badges');
  assert.equal(badgeCall.options.method, 'GET');
  assert.equal(badgeCall.options.credentials, 'same-origin');
  assert.equal(badgeCall.options.cache, 'no-store');
  assert.equal(calls.filter((call) => call.url === '/api/web/collection').length, 1);
  const cards = nodes['badge-list'].children;
  assert.equal(cards.length, 3);
  assert.deepEqual(texts(cards, 'medal-name'), ['동네 탐험가', '단골손님', '꾸준한 걸음']);
  assert.deepEqual(texts(cards, 'tier-chip'), ['실버', '도전 전', '골드']);
  assert.deepEqual(texts(cards, 'medal-value'), ['서로 다른 가게 2곳', '한 가게 최다 방문 1일', '방문한 날 7일']);
  assert.deepEqual(texts(cards, 'medal-next'), ['골드까지 1곳 더', '브론즈까지 1일 더', '골드 달성! 최고 등급이에요']);
  assert.deepEqual(cards.map((card) => card.className), [
    'medal-card tier-2 earned', 'medal-card tier-0 locked', 'medal-card tier-3 earned',
  ]);
  assert.match(nodes['badge-note'].textContent, /5\/9/);
  assert.equal(nodes['badge-content'].hidden, false);
  assert.equal(nodes['collection-content'].hidden, false);
});

test('운영 웹 여권 요약은 서버의 earnedTiers로 탐험 등급과 배지 n/9를 글자로 보여 준다', async () => {
  const ranks = ['새내기 탐험가', '동네 산책가', '동네 산책가', '골목 탐험가', '골목 탐험가', '골목 탐험가',
    '월계 미식가', '월계 미식가', '월계 미식가', '월계 마스터'];
  for (const [earnedTiers, title] of ranks.entries()) {
    const { nodes, doc } = collectionFixture();
    await loadCollection(collectionAndBadges({ badges: () => okJson(badgesFixture({ earnedTiers })) }).fetcher, doc);
    const passport = nodes['badge-passport'];
    assert.equal(first(passport, 'passport-rank').textContent, title, `earnedTiers ${earnedTiers}`);
    assert.equal(textOf(first(passport, 'passport-count')), `배지 ${earnedTiers} / 9`);
    const pips = findAll(passport, 'pip');
    assert.equal(pips.length, 9);
    assert.equal(pips.filter((pip) => classesOf(pip).includes('filled')).length, earnedTiers);
    assert.match(first(passport, 'passport-pips').getAttribute('aria-label'), new RegExp(`배지 9개 중 ${earnedTiers}개`));
    assert.equal(first(passport, 'passport-stamp').getAttribute('aria-hidden'), 'true');
  }
  const { nodes, doc } = collectionFixture();
  await loadCollection(collectionAndBadges({ badges: () => okJson(badgesFixture()) }).fetcher, doc);
  assert.equal(first(nodes['badge-passport'], 'passport-eyebrow').textContent, '나의 탐험 여권');
  assert.equal(first(nodes['badge-passport'], 'passport-next').textContent, '다음 상자까지 배지 1개');
  assert.equal(first(nodes['badge-passport'], 'passport-cta'), undefined);
  assert.equal(findAll(nodes['badge-passport'], 'gift-icon').length, 3);
});

test('운영 웹 여권 요약은 방문·앱 수집품·실제 NFT 개수를 글자로 세고 열 수 있는 상자는 앱 안내로 알린다', async () => {
  const { nodes, doc } = collectionFixture();
  const collectible = (nftStatus) => ({ displayName: '마스코트', merchantName: '가게', appCollectibleStatus: 'COLLECTED', nftStatus,
    nft: nftStatus === 'FINALIZED' ? { tokenId: '7' } : null });
  const collection = { visits: [{ merchantName: 'A', businessDate: '2026-09-25' }, { merchantName: 'B', businessDate: '2026-09-26' }],
    collectibles: [collectible('NOT_REQUESTED'), collectible('FINALIZED'), collectible('QUEUED')] };
  const rewards = [
    { milestone: 1, requiredTiers: 3, state: 'READY', offer: null, coupon: null },
    { milestone: 2, requiredTiers: 6, state: 'LOCKED', offer: null, coupon: null },
    { milestone: 3, requiredTiers: 9, state: 'LOCKED', offer: null, coupon: null },
  ];
  await loadCollection(collectionAndBadges({ collection,
    badges: () => okJson(badgesFixture({ earnedTiers: 3, rewards })) }).fetcher, doc);
  const pills = findAll(nodes['badge-passport'], 'count-pill');
  assert.deepEqual(pills.map(textOf), ['2방문', '3앱 수집품', '1실제 NFT']);
  assert.equal(textOf(first(nodes['badge-passport'], 'passport-cta')), '첫 번째 상자를 앱에서 열 수 있어요');
  assert.equal(first(nodes['badge-passport'], 'passport-next').textContent, '다음 상자까지 배지 3개');
  assert.equal(nodes['reward-list'].children[0].className, 'reward-row state-ready ready');

  const { nodes: done, doc: doneDoc } = collectionFixture();
  await loadCollection(collectionAndBadges({
    badges: () => okJson(badgesFixture({ earnedTiers: 9, rewards: rewards.map((reward) => ({ ...reward, state: 'OPENED' })) })) }).fetcher, doneDoc);
  assert.equal(first(done['badge-passport'], 'passport-next').textContent, '모든 보상 상자에 닿았어요!');
});

test('운영 웹 미획득 메달은 회색 잠김 카드와 글자 칩으로 표시하고 장식 그림은 읽지 않는다', async () => {
  const { nodes, doc } = collectionFixture();
  const medals = badgesFixture().medals.map((medal) => ({ ...medal, tier: 0, value: 0 }));
  await loadCollection(collectionAndBadges({ badges: () => okJson(badgesFixture({ medals, earnedTiers: 0 })) }).fetcher, doc);
  const cards = nodes['badge-list'].children;
  for (const card of cards) {
    assert.deepEqual(classesOf(card), ['medal-card', 'tier-0', 'locked']);
    assert.equal(first(card, 'tier-chip').textContent, '도전 전');
    assert.equal(card.children[0].getAttribute('aria-hidden'), 'true');
  }
  assert.deepEqual(texts(cards, 'medal-next'), ['브론즈까지 1곳 더', '브론즈까지 2일 더', '브론즈까지 2일 더']);
  assert.equal(first(nodes['badge-passport'], 'passport-rank').textContent, '새내기 탐험가');
  assert.match(css, /\.medal-card\.locked \.medal-face \{[^}]*grayscale\(1\)[^}]*opacity: \.45/);
  assert.match(css, /\.medal-card\.locked \.medal-ring \{[^}]*dashed var\(--mc-locked-edge\)/);
});

test('운영 웹 보상 상자 상태와 쿠폰은 색이 아닌 글자로 표시하고 가상 쿠폰을 만들지 않는다', async () => {
  const { nodes, doc } = collectionFixture();
  const rewards = badgesFixture().rewards;
  const coupon = rewards[0].coupon;
  const states = [
    { ...rewards[0], state: 'LOCKED', coupon: null },
    { milestone: 2, requiredTiers: 6, state: 'READY', offer: { merchantId: 'm2', merchantName: '가게 둘', title: '디저트', detail: '', validDays: 7 }, coupon: null },
    { milestone: 3, requiredTiers: 9, state: 'UNAVAILABLE', offer: null, coupon: null },
  ];
  await loadCollection(collectionAndBadges({ badges: () => okJson(badgesFixture({ rewards: states })) }).fetcher, doc);
  const rows = nodes['reward-list'].children;
  assert.deepEqual(texts(rows, 'reward-name'), ['첫 번째 상자', '두 번째 상자', '황금 상자']);
  assert.deepEqual(texts(rows, 'reward-need'), ['배지 3개', '배지 6개', '배지 9개']);
  assert.deepEqual(texts(rows, 'state-chip'), ['잠김', '앱에서 열 수 있어요', '혜택 준비 중']);
  assert.deepEqual(texts(rows, 'reward-offer'), ['<b>운영 점포</b> · 음료 1잔', '가게 둘 · 디저트', undefined]);
  assert.deepEqual(rows.map((row) => row.className), [
    'reward-row state-locked', 'reward-row state-ready ready', 'reward-row state-unavailable']);
  assert.match(nodes['coupon-list'].children[0].textContent, /아직 받은 쿠폰이 없어요/);
  assert.equal(nodes['coupon-list'].children.length, 1);

  // 관리자가 쿠폰을 무효로 한 상자는 "혜택 준비 중"이 아니라 더 받을 수 없다고 알린다. 다른 상태·모르는 이유·옛 서버(필드 없음)는 그대로다.
  const voidedBox = [
    { milestone: 1, requiredTiers: 3, state: 'UNAVAILABLE', offer: null, coupon: null, unavailableReason: 'COUPON_REVOKED' },
    { milestone: 2, requiredTiers: 6, state: 'UNAVAILABLE', offer: null, coupon: null, unavailableReason: 'SOMETHING_NEW' },
    { milestone: 3, requiredTiers: 9, state: 'LOCKED', offer: null, coupon: null, unavailableReason: 'COUPON_REVOKED' },
  ];
  await loadCollection(collectionAndBadges({ badges: () => okJson(badgesFixture({ rewards: voidedBox })) }).fetcher, doc);
  assert.deepEqual(texts(nodes['reward-list'].children, 'state-chip'), ['이 혜택은 더 이상 받을 수 없어요', '혜택 준비 중', '잠김']);
  assert.equal(nodes['reward-list'].children[0].className, 'reward-row state-unavailable');

  const opened = [
    { ...rewards[0] },
    { milestone: 2, requiredTiers: 6, state: 'OPENED', offer: null, coupon: { ...coupon, couponId: 'c2', milestone: 2, title: '디저트', status: 'REDEEMED', redeemedAt: '2026-09-30T00:00:00.000Z' } },
    { milestone: 3, requiredTiers: 9, state: 'OPENED', offer: null, coupon: { ...coupon, couponId: 'c3', milestone: 3, title: '만료 쿠폰', status: 'EXPIRED' } },
  ];
  await loadCollection(collectionAndBadges({ badges: () => okJson(badgesFixture({ rewards: opened })) }).fetcher, doc);
  assert.deepEqual(texts(nodes['reward-list'].children, 'state-chip'), ['받음', '받음', '받음']);
  assert.equal(findAll(nodes['reward-list'], 'reward-offer').length, 0);
  const tickets = nodes['coupon-list'].children;
  assert.equal(tickets.length, 3);
  assert.deepEqual(tickets.map((ticket) => ticket.className), [
    'ticket ticket-issued', 'ticket ticket-redeemed', 'ticket ticket-expired']);
  assert.deepEqual(texts(tickets, 'ticket-title'), ['음료 1잔', '디저트', '만료 쿠폰']);
  assert.deepEqual(texts(tickets, 'ticket-eyebrow'), ['첫 번째 상자 쿠폰', '두 번째 상자 쿠폰', '황금 상자 쿠폰']);
  assert.deepEqual(texts(tickets, 'ticket-merchant'), ['<b>운영 점포</b>', '<b>운영 점포</b>', '<b>운영 점포</b>']);
  assert.deepEqual(texts(tickets, 'ticket-chip'), ['사용 가능', '사용 완료', '만료']);
  assert.deepEqual(texts(tickets, 'ticket-expiry'), ['~10월 29일까지', '~10월 29일까지', '~10월 29일까지']);
  // 사용 완료 도장은 글자 칩과 겹치는 장식이라 읽지 않고, 다른 상태에는 없다.
  assert.deepEqual(tickets.map((ticket) => findAll(ticket, 'ticket-stamp').length), [0, 1, 0]);
  assert.equal(first(tickets[1], 'ticket-stamp').textContent, '사용 완료');
  assert.equal(first(tickets[1], 'ticket-stamp').getAttribute('aria-hidden'), 'true');

  // 긴 안내는 사용 가능한 쿠폰에만 보이고, 사용·만료 티켓에서는 도장 아래로 숨지 않도록 뺀다.
  const detailed = opened.map((reward) => ({ ...reward, coupon: { ...reward.coupon, detail: '매장 안내 <i>문구</i>' } }));
  await loadCollection(collectionAndBadges({ badges: () => okJson(badgesFixture({ rewards: detailed })) }).fetcher, doc);
  const detailedTickets = nodes['coupon-list'].children;
  assert.deepEqual(detailedTickets.map((ticket) => findAll(ticket, 'ticket-detail').length), [1, 0, 0]);
  assert.equal(first(detailedTickets[0], 'ticket-detail').textContent, '매장 안내 <i>문구</i>');
});

test('운영 웹 메달 조회 실패는 메달 영역만 숨기고 재시도 없이 도감을 그대로 표시한다', async () => {
  const visit = { merchantName: '실제 방문 점포', businessDate: '2026-09-25' };
  const failures = [
    () => ({ ok: false, status: 500 }),
    () => { throw new Error('offline'); },
    () => okJson({ medals: [], earnedTiers: 0, rewards: [] }),
    () => okJson(badgesFixture({ earnedTiers: 12 })),
    () => okJson(badgesFixture({ medals: [{ kind: 'unknown', value: 1, tier: 1, thresholds: [1, 2, 3] }, ...badgesFixture().medals.slice(1)] })),
    () => okJson(badgesFixture({ rewards: badgesFixture().rewards.map((reward) => ({ ...reward, state: 'MYSTERY' })) })),
    () => okJson(badgesFixture({ rewards: badgesFixture().rewards.map(({ offer, ...reward }) => reward) })),
  ];
  for (const badges of failures) {
    const { nodes, doc } = collectionFixture();
    const { calls, fetcher } = collectionAndBadges({ badges, collection: { visits: [visit], collectibles: [] } });
    await loadCollection(fetcher, doc);
    assert.equal(nodes['visit-list'].children.length, 1);
    assert.equal(nodes['collection-content'].hidden, false);
    assert.equal(nodes['collection-logout'].hidden, false);
    assert.equal(nodes['collection-retry'].hidden, true);
    assert.equal(nodes['badge-content'].hidden, true);
    assert.equal(nodes['badge-passport'].children.length, 0);
    assert.equal(nodes['badge-list'].children.length, 0);
    assert.equal(nodes['reward-list'].children.length, 0);
    assert.equal(nodes['coupon-list'].children.length, 0);
    assert.match(nodes['badge-note'].textContent, /불러오지 못했어요/);
    assert.equal(calls.filter((call) => call.url === '/api/web/badges').length, 1);
  }
});

const oneVisit = { visits: [{ merchantName: '실제 방문 점포', businessDate: '2026-09-25' }], collectibles: [] };
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('운영 웹은 방문·수집품을 먼저 그리고 메달은 도착하면 그때 그린다', async () => {
  const { nodes, doc } = collectionFixture();
  let releaseBadges;
  const gate = new Promise((resolve) => { releaseBadges = resolve; });
  const fetcher = async (url) => {
    if (url === '/api/web/badges') { await gate; return okJson(badgesFixture()); }
    return { ok: true, json: async () => oneVisit };
  };
  const loading = loadCollection(fetcher, doc);
  await tick();
  assert.equal(nodes['visit-list'].children.length, 1);
  assert.equal(nodes['collection-content'].hidden, false);
  assert.equal(nodes['collection-logout'].hidden, false);
  assert.match(nodes['collection-status'].textContent, /방문 1건/);
  assert.equal(nodes['badge-content'].hidden, true);
  assert.match(nodes['badge-note'].textContent, /메달을 확인하는 중/);
  releaseBadges();
  await loading;
  assert.equal(nodes['badge-content'].hidden, false);
  assert.equal(nodes['badge-list'].children.length, 3);
  assert.equal(first(nodes['badge-passport'], 'passport-rank').textContent, '골목 탐험가');
  assert.match(nodes['badge-note'].textContent, /5\/9/);
});

test('운영 웹 메달 요청은 제한 시간이 지나면 끊고 도감은 그대로 두며 늦은 응답은 그리지 않는다', async () => {
  const { nodes, doc } = collectionFixture();
  let signal;
  let lateBadges;
  const fetcher = async (url, options) => {
    if (url === '/api/web/badges') {
      signal = options.signal;
      return new Promise((resolve) => { lateBadges = () => resolve(okJson(badgesFixture())); });
    }
    return { ok: true, json: async () => oneVisit };
  };
  await loadCollection(fetcher, doc, { badgesTimeoutMs: 20 });
  assert.ok(signal instanceof AbortSignal);
  assert.equal(signal.aborted, true);
  assert.equal(nodes['visit-list'].children.length, 1);
  assert.equal(nodes['collection-content'].hidden, false);
  assert.equal(nodes['collection-retry'].hidden, true);
  assert.equal(nodes['badge-content'].hidden, true);
  assert.match(nodes['badge-note'].textContent, /메달을 불러오지 못했어요/);
  lateBadges();
  await tick();
  assert.equal(nodes['badge-list'].children.length, 0);
  assert.equal(nodes['badge-content'].hidden, true);
  assert.match(nodes['badge-note'].textContent, /메달을 불러오지 못했어요/);
});

test('운영 웹은 메달 응답을 기다리는 사이 다시 조회하거나 로그아웃하면 이전 요청의 메달을 버린다', async () => {
  const { nodes, doc } = collectionFixture();
  let releaseBadges;
  const gate = new Promise((resolve) => { releaseBadges = resolve; });
  const first = loadCollection(async (url) => {
    if (url === '/api/web/badges') { await gate; return okJson(badgesFixture()); }
    return { ok: true, json: async () => oneVisit };
  }, doc);
  await tick();
  assert.equal(nodes['visit-list'].children.length, 1);
  await loadCollection(async () => ({ ok: false, status: 401 }), doc);
  releaseBadges();
  await first;
  for (const id of ['visit-list', 'badge-passport', 'badge-list', 'reward-list', 'coupon-list']) assert.equal(nodes[id].children.length, 0, id);
  assert.equal(nodes['badge-content'].hidden, true);
  assert.equal(nodes['badge-note'].textContent, '');
  assert.equal(nodes['collection-login'].hidden, false);
});

test('운영 웹 쿠폰 만료일은 브라우저 시간대가 아니라 한국 날짜로 표시한다', async () => {
  const { nodes, doc } = collectionFixture();
  const rewards = badgesFixture().rewards;
  const at = (expiresAt) => ({ ...rewards[0].coupon, expiresAt });
  const opened = [
    { ...rewards[0], coupon: at('2026-10-29T14:59:59.999Z') },
    { milestone: 2, requiredTiers: 6, state: 'OPENED', offer: null, coupon: { ...at('2026-10-29T15:00:00.000Z'), couponId: 'c2', milestone: 2 } },
    { milestone: 3, requiredTiers: 9, state: 'OPENED', offer: null, coupon: { ...at('2026-12-31T15:00:00.000Z'), couponId: 'c3', milestone: 3 } },
  ];
  await loadCollection(collectionAndBadges({ badges: () => okJson(badgesFixture({ rewards: opened })) }).fetcher, doc);
  assert.deepEqual(texts(nodes['coupon-list'].children, 'ticket-expiry'), ['~10월 29일까지', '~10월 30일까지', '~1월 1일까지']);
  assert.match(script, /timeZone: 'Asia\/Seoul'/);
});

test('운영 웹은 메달이 성공해도 도감 실패나 로그아웃 때 이전 메달·쿠폰을 모두 지운다', async () => {
  const { nodes, doc } = collectionFixture();
  await loadCollection(collectionAndBadges({ badges: () => okJson(badgesFixture()) }).fetcher, doc);
  assert.equal(nodes['coupon-list'].children.length, 1);
  assert.ok(nodes['badge-passport'].children.length > 0);
  await loadCollection(async (url) => (url === '/api/web/badges' ? okJson(badgesFixture()) : { ok: false, status: 401 }), doc);
  for (const id of ['badge-passport', 'badge-list', 'reward-list', 'coupon-list']) assert.equal(nodes[id].children.length, 0, id);
  assert.equal(nodes['badge-content'].hidden, true);
  assert.equal(nodes['badge-note'].textContent, '');
  assert.equal(nodes['collection-login'].hidden, false);
});

test('운영 웹은 브라우저에서 계산한 배지와 하드코딩된 가상 혜택을 두지 않는다', () => {
  assert.doesNotMatch(script, /neighborhoodBadges|첫 발걸음|두 번째 골목|월계 탐험가|체험 음료|가상 점포/);
  assert.match(script, /'\/api\/web\/badges'/);
  assert.match(html, /id="badge-content"[^>]*hidden/);
  assert.match(html, /id="badge-note" role="status" aria-live="polite"/);
  assert.match(html, /<ol id="reward-list"/);
  assert.match(html, /id="coupon-list"/);
  assert.match(html, /상자는 앱에서 열어요/);
  assert.doesNotMatch(html, /<button[^>]*(?:reward|coupon|open)/i);
});

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
    assert.ok(['/api/web/collection', '/api/web/badges'].includes(url));
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
  assert.equal(status.textContent, '현재 공개된 음식점이 없습니다. 아직 입점 준비 중이에요.');
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

test('실제 정보 편집 자산은 점주·관리자 경로에서 모듈과 테마 CSS로 제공된다', async () => {
  for (const prefix of ['/merchant/assets/', '/admin/assets/']) {
    for (const [file, mime] of [['real-world-merchant.mjs', /javascript/], ['real-world-merchant.css', /text\/css/]]) {
      const response = await fetch(`${base}${prefix}${file}`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), mime);
      assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
    }
  }
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

test('운영 현황은 실제 집계와 빈 상태를 텍스트로 표시한다', async () => {
  const nodes = Object.fromEntries(['admin-status', 'admin-login', 'admin-content',
    'admin-merchants', 'admin-operations', 'admin-create', 'admin-logout']
    .map(id => [id, { ...element(), hidden: true }]));
  const doc = { getElementById(id) { return nodes[id]; }, createElement: element };
  const merchant = { id: 'real-1', name: '<script>실제 상점</script>', story: '', roadAddress: '서울',
    minimumSpendWon: 0, status: 'ACTIVE', demo: false, version: 1 };
  await loadAdmin(async path => ({ ok: true, json: async () => path.endsWith('/me')
    ? { admin: true } : path.endsWith('/operations-status')
      ? { merchants: [{ id: merchant.id, name: merchant.name, status: merchant.status,
        claims: { active: 1, expired: 2, claimed: 3 }, visits: 4, rewards: 1,
        mintJobs: [{ status: 'RETRYABLE', count: 1 }],
        mintFailures: [{ code: 'RPC_TIMEOUT', count: 1 }] }] }
      : { merchants: [merchant] } }), doc);
  assert.match(nodes['admin-operations'].children[0].textContent, /QR 활성 1건 · 만료 2건 · 수령 3건 · 방문 4건 · 보상 1건/);
  assert.match(nodes['admin-operations'].children[1].textContent, /RETRYABLE 1건/);
  assert.match(nodes['admin-operations'].children[2].textContent, /RPC_TIMEOUT 1건/);
  assert.match(nodes['admin-operations'].children[0].textContent, /<script>실제 상점<\/script>/);
  await loadAdmin(async path => ({ ok: true, json: async () => path.endsWith('/me')
    ? { admin: true } : { merchants: [] } }), doc);
  assert.equal(nodes['admin-operations'].children.length, 0);
  assert.match(nodes['admin-operations'].textContent, /집계할 실제 점포가 없습니다/);
});

test('운영 현황 조회 중 관리자 권한이 사라지면 점포 목록도 지운다', async () => {
  for (const denialStatus of [401, 403]) {
    const nodes = Object.fromEntries(['admin-status', 'admin-login', 'admin-content',
      'admin-merchants', 'admin-operations', 'admin-create', 'admin-logout']
      .map(id => [id, { ...element(), hidden: true }]));
    const doc = { getElementById(id) { return nodes[id]; }, createElement: element };
    await loadAdmin(async path => path.endsWith('/operations-status')
      ? { ok: false, status: denialStatus, json: async () => ({ code: 'ADMIN_FORBIDDEN' }) }
      : { ok: true, json: async () => path.endsWith('/me') ? { admin: true } : { merchants: [
        { id: 'real-1', name: '실제 점포', story: '', roadAddress: '서울', minimumSpendWon: 0,
          status: 'ACTIVE', demo: false, version: 1 },
      ] } }, doc);
    assert.equal(nodes['admin-content'].hidden, true);
    assert.equal(nodes['admin-merchants'].children.length, 0);
    assert.match(nodes['admin-status'].textContent, denialStatus === 401 ? /로그인해 주세요/ : /권한이 없습니다/);
  }
});

test('관리자 메뉴 입력은 실제 가격 행만 만들고 잘못된 형식은 거부한다', () => {
  assert.deepEqual(parseMenuLines('김밥 | 4500\n라면 | 6000\n'), [
    { name: '김밥', priceWon: 4500 }, { name: '라면', priceWon: 6000 },
  ]);
  assert.deepEqual(parseMenuLines(''), []);
  assert.throws(() => parseMenuLines('김밥 | 4,500'), /메뉴/);
  assert.throws(() => parseMenuLines('김밥 | -1'), /메뉴/);
});

test('캠페인 초안 입력은 기간·정원·목표 1·3·5를 검증한다', () => {
  const values = new Map([
    ['merchantId', 'real-1'], ['title', '첫 탐험'], ['startsAt', '2026-10-01T09:00'],
    ['endsAt', '2026-11-01T09:00'], ['enrollmentCapacity', '15'],
    ['goal1', '첫 방문'], ['goal3', '세 번째 방문'], ['goal5', '다섯 번째 방문'],
  ]);
  const parsed = campaignDraftPayload(values);
  assert.equal(parsed.enrollmentCapacity, 15);
  assert.deepEqual(parsed.rewardGoals.map(goal => goal.targetVisitCount), [1, 3, 5]);
  // #412: 목적을 고르지 않으면 요청에 purpose 키가 없다(자세한 목적 입력은 campaign-purpose-admin.test.mjs).
  assert.equal('purpose' in parsed, false);
  assert.equal(parsed.startsAt, new Date('2026-10-01T09:00').toISOString());
  values.set('endsAt', '2026-09-01T09:00');
  assert.throws(() => campaignDraftPayload(values), /종료 시각/);
  values.set('endsAt', '2026-11-01T09:00');
  values.set('goal3', '');
  assert.throws(() => campaignDraftPayload(values), /세 목표/);
});

test('운영 캠페인 초안은 실제 점포만 선택하고 비공개 목록만 표시한다', async () => {
  const nodes = Object.fromEntries(['admin-status', 'admin-login', 'admin-content',
    'admin-merchants', 'admin-operations', 'admin-create', 'admin-logout',
    'admin-campaign-draft', 'admin-campaign-drafts']
    .map(id => [id, { ...element(), hidden: true }]));
  const select = element();
  nodes['admin-campaign-draft'].querySelector = () => select;
  const doc = { getElementById(id) { return nodes[id]; }, createElement: element };
  const merchant = { id: 'real-1', name: '실제 점포', story: '', roadAddress: '서울',
    minimumSpendWon: 0, status: 'PAUSED', demo: false, version: 1 };
  await loadAdmin(async path => ({ ok: true, json: async () => path.endsWith('/me') ? { admin: true }
    : path.endsWith('/operations-status') ? { merchants: [] }
      : path.endsWith('/campaign-drafts') ? { drafts: [{ merchantName: merchant.name,
        title: '첫 탐험', enrollmentCapacity: 15 }] } : { merchants: [merchant] } }), doc);
  assert.equal(nodes['admin-campaign-draft'].hidden, false);
  assert.equal(select.children.length, 1);
  assert.equal(select.children[0].value, 'real-1');
  assert.match(nodes['admin-campaign-drafts'].children[0].textContent, /비공개 초안 · 정원 15명/);
  await loadAdmin(async path => ({ ok: true, json: async () => path.endsWith('/me') ? { admin: true }
    : path.endsWith('/campaign-drafts') ? { drafts: [] } : { merchants: [] } }), doc);
  assert.equal(nodes['admin-campaign-draft'].hidden, true);
  assert.match(nodes['admin-campaign-drafts'].textContent, /저장된 비공개 초안이 없습니다/);
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
    'merchant-content', 'merchant-owner-nav', 'merchant-memberships', 'merchant-code', 'merchant-registration',
    'merchant-claim-form', 'merchant-claim-merchant', 'merchant-claim-token',
    'merchant-claim-reference', 'merchant-claim-confirm', 'merchant-claim-resolve',
    'merchant-claim-submit', 'merchant-claim-result', 'merchant-claim-scan',
    'merchant-claim-scan-cancel', 'merchant-claim-video', 'merchant-claim-issued-qr',
    'merchant-claim-reissue', 'merchant-claim-reissue-confirm', 'merchant-claim-reissue-submit',
    'merchant-coupon', 'merchant-coupon-lookup', 'merchant-coupon-list', 'merchant-coupon-status']
    .map(id => [id, { ...element(), hidden: true }]));
  const select = { ...element(), value: 'real-merchant' };
  const button = element();
  nodes['merchant-registration'].querySelector = name => name === 'select' ? select : button;
  nodes['merchant-creator'] = { ...element(), hidden: true };
  nodes['merchant-claim-section'] = { ...element(), hidden: false };
  nodes['merchant-overview'] = { ...element(), hidden: true };
  nodes['merchant-feedback'] = { ...element(), hidden: true };
  nodes['merchant-reversal'] = { ...element(), hidden: true };
  const merchantViewSpecs = [
    ['merchant-overview', 'results'],
    ['merchant-feedback', 'results'],
    ['merchant-creator', 'create'],
    ['merchant-claim-section', 'claim'],
    ['merchant-reversal', 'results'],
  ];
  const merchantViewButtons = ['create', 'claim', 'results'].map(target => {
    const viewButton = element();
    viewButton.dataset.merchantViewTarget = target;
    return viewButton;
  });
  const merchantViewSections = () => merchantViewSpecs.map(([id, view]) => {
    const section = nodes[id];
    section.dataset = { ...(section.dataset || {}), merchantView: view };
    if (!section.classList) section.classList = element().classList;
    return section;
  });
  const listeners = new Map();
  const documentListeners = new Map();
  const documentRegistrations = [];
  const doc = {
    addEventListener(type, callback) { documentRegistrations.push(type); documentListeners.set(type, callback); },
    getElementById(id) { return nodes[id]; },
    querySelector() { return select; },
    querySelectorAll(selector) {
      if (selector === '[data-merchant-view]') return merchantViewSections();
      if (selector === '[data-merchant-view-target]') return merchantViewButtons;
      return [];
    },
    createElement() { return element(); },
    defaultView: { addEventListener(type, callback) { listeners.set(type, callback); } },
  };
  doc.body = doc;
  const click = (target, options = {}) => {
    const event = { target, button: 0, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, ...options };
    documentListeners.get('click')?.(event);
    return event;
  };
  return { nodes, select, button, listeners, documentRegistrations, doc, click };
}

test('점포 개요 앵커와 건너뛰기는 이력 변경 없이 대상을 스크롤하고 초점을 옮긴다', async () => {
  const { nodes, documentRegistrations, doc, click } = merchantDocument();
  const historyCalls = [];
  doc.defaultView.history = Object.fromEntries(['pushState', 'replaceState', 'back', 'forward', 'go']
    .map(method => [method, (...args) => historyCalls.push({ method, args })]));
  let hashWrites = 0;
  doc.defaultView.location = { get hash() { return ''; }, set hash(value) { hashWrites++; } };
  await bindMerchant(async () => ({ ok: true, json: async () => ({ merchants: [] }) }), doc);
  assert.equal(documentRegistrations.filter(type => type === 'click').length, 1);
  for (const id of ['merchant-visit-title', 'merchant-redemption-title', 'merchant-registration-title', 'main']) {
    const target = element(); target.tabIndex = -1;
    if (id !== 'main') target.setAttribute('tabindex', '-1');
    target.hasAttribute = name => target.getAttribute(name) !== null;
    target.removeAttribute = name => { delete target.attributes[name]; };
    const calls = [];
    target.scrollIntoView = options => calls.push({ method: 'scroll', options });
    target.focus = options => calls.push({ method: 'focus', options });
    nodes[id] = target;
    const anchor = element(); anchor.setAttribute('href', `#${id}`);
    const child = { closest(selector) { assert.equal(selector, 'a[href^="#"]'); return anchor; } };
    const event = click(child);
    assert.equal(event.defaultPrevented, true);
    assert.deepEqual(calls, [
      { method: 'scroll', options: { block: 'start' } },
      { method: 'focus', options: { preventScroll: true } },
    ]);
    assert.equal(target.getAttribute('tabindex'), '-1');
    await target.dispatch('blur');
    assert.equal(target.getAttribute('tabindex'), id === 'main' ? null : '-1');
    for (const options of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { button: 2 }]) {
      assert.equal(click(child, options).defaultPrevented, false);
    }
    assert.equal(calls.length, 2, '보조 키 클릭은 스크롤과 초점을 옮기지 않는다');
    if (id === 'main') {
      assert.equal(click(child, { detail: 0 }).defaultPrevented, true);
      assert.deepEqual(calls.slice(2), [
        { method: 'scroll', options: { block: 'start' } },
        { method: 'focus', options: { preventScroll: true } },
      ]);
    }
  }
  assert.deepEqual(historyCalls, []);
  assert.equal(hashWrites, 0);
  for (const href of ['#', '#missing']) {
    const anchor = element(); anchor.setAttribute('href', href);
    const event = click({ closest() { return anchor; } });
    assert.equal(event.defaultPrevented, href !== '#');
  }
  assert.equal(click({ closest() { return null; } }).defaultPrevented, false);
});

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

test('점포 웹은 캠페인 시간대 밖에서 만든 방문 코드에만 안내를 붙이고 방문 인정은 그대로라고 말한다(#412)', async () => {
  const issueWith = async extra => {
    const { nodes, doc } = merchantDocument();
    const fetcher = async path => {
      if (path === '/api/web/merchant/me') return { ok: true, json: async () => ({ merchants: [{ id: 'real-merchant', name: '실제 점포', role: 'STAFF' }] }) };
      if (path === '/api/web/merchant/registration-merchants') return { ok: true, json: async () => ({ merchants: [] }) };
      if (path.endsWith('/customer-identities/resolve')) return { ok: true, json: async () => ({ expiresAt: '2026-09-28T12:00:00.000Z' }) };
      return { ok: true, status: 201, json: async () => ({ token: 'window-claim-token', claimSlotId: 'slot-1', tokenVersion: 1,
        expiresAt: '2026-09-28T12:15:00.000Z', qrSvgDataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', ...extra }) };
    };
    await bindMerchant(fetcher, doc);
    nodes['merchant-claim-merchant'].value = 'real-merchant';
    nodes['merchant-claim-token'].value = 'customer-qr';
    nodes['merchant-claim-reference'].value = 'sale-1';
    await nodes['merchant-claim-resolve'].click();
    nodes['merchant-claim-confirm'].checked = true;
    await nodes['merchant-claim-form'].submit();
    return nodes['merchant-claim-result'].textContent;
  };
  const note = '방문 확인 시점 기준으로 점주가 정한 캠페인 시간대 밖이에요. 방문과 수집품은 그대로 인정돼요.';
  const outside = await issueWith({ windowStatus: 'OUTSIDE_WINDOW' });
  assert.match(outside, /방문 코드: window-claim-token/);
  assert.ok(outside.endsWith(` · ${note}`), outside);
  for (const extra of [{ windowStatus: 'IN_WINDOW' }, { windowStatus: 'NONE' }, {}, { windowStatus: 'LATER_VALUE' }]) {
    const text = await issueWith(extra);
    assert.match(text, /방문 코드: window-claim-token/);
    assert.doesNotMatch(text, /캠페인 시간대/, JSON.stringify(extra));
  }
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

const lookupPath = '/api/web/merchant/merchants/real-merchant/coupons/lookup';
const redeemPath = (couponId) => `/api/web/merchant/merchants/real-merchant/coupons/${encodeURIComponent(couponId)}/redeem`;
const staffCoupons = () => [
  { couponId: 'coupon/1', title: '<b>체험 음료</b>', detail: '한 잔', expiresAt: '2026-10-28T00:00:00.000Z' },
  { couponId: 'coupon-2', title: '체험 디저트', detail: '', expiresAt: '2026-10-30T00:00:00.000Z' },
];
const apiError = (status, code) => ({ ok: false, status, json: async () => ({ code }) });

async function couponMerchant({ lookup = () => okJson({ identityExpiresAt: '2026-09-28T12:00:00.000Z', coupons: staffCoupons() }),
  redeem = () => okJson({ couponId: 'coupon/1', status: 'REDEEMED', redeemedAt: '2026-09-28T11:00:00.000Z', replayed: false }),
  confirmed = true } = {}) {
  const { nodes, doc, listeners } = merchantDocument();
  const calls = [];
  doc.defaultView.confirm = (message) => { calls.push({ confirm: message }); return confirmed; };
  const fetcher = async (path, options) => {
    if (path === '/api/web/merchant/me') return okJson({ merchants: [{ id: 'real-merchant', name: '실제 점포', role: 'STAFF' }] });
    if (path === '/api/web/merchant/registration-merchants') return okJson({ merchants: [] });
    if (path === '/api/web/logout') return { ok: true, status: 204 };
    if (path.endsWith('/customer-identities/resolve')) return okJson({ expiresAt: '2026-09-28T12:00:00.000Z' });
    calls.push({ path, options });
    if (path === lookupPath) return lookup();
    if (path.endsWith('/redeem')) return redeem();
    if (path.endsWith('/claim-slots')) return okJson({ token: 'claim-token', claimSlotId: 'slot-1', tokenVersion: 1,
      expiresAt: '2026-09-28T12:10:00.000Z' });
    throw new Error(`unexpected ${path}`);
  };
  await bindMerchant(fetcher, doc);
  nodes['merchant-claim-merchant'].value = 'real-merchant';
  nodes['merchant-claim-token'].value = 'customer-qr';
  return { nodes, doc, listeners, calls, fetcher, resolve: () => nodes['merchant-claim-resolve'].click() };
}

const couponButton = (nodes, index) => nodes['merchant-coupon-list'].children[index].children[1];

test('점포 웹 쿠폰 영역은 고객 QR 확인 뒤에만 열리고 확인 요청은 같은 출처 JSON POST다', async () => {
  const { nodes, calls, resolve } = await couponMerchant();
  assert.equal(nodes['merchant-coupon'].hidden, true);
  await nodes['merchant-coupon-lookup'].click();
  assert.deepEqual(calls, []);
  await resolve();
  assert.equal(nodes['merchant-coupon'].hidden, false);
  assert.equal(nodes['merchant-coupon-list'].children.length, 0);

  await nodes['merchant-coupon-lookup'].click();
  const [call] = calls;
  assert.equal(call.path, lookupPath);
  assert.equal(call.options.method, 'POST');
  assert.equal(call.options.credentials, 'same-origin');
  assert.equal(call.options.cache, 'no-store');
  assert.equal(call.options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(call.options.body), { customerIdentityToken: 'customer-qr' });
  const rows = nodes['merchant-coupon-list'].children;
  assert.equal(rows.length, 2);
  assert.match(rows[0].children[0].textContent, /^<b>체험 음료<\/b> · 한 잔 · ~10월 28일까지$/);
  assert.doesNotMatch(rows[1].children[0].textContent, /· ·/);
  assert.equal(couponButton(nodes, 0).textContent, '<b>체험 음료</b> 사용 처리');
  assert.equal(couponButton(nodes, 0).type, 'button');
  assert.match(nodes['merchant-coupon-status'].textContent, /2장/);
  assert.equal(nodes['merchant-coupon-lookup'].disabled, false);
});

test('점포 웹은 확인창에서 동의한 쿠폰만 사용 처리하고 성공한 쿠폰은 목록에서 뺀다', async () => {
  const declined = await couponMerchant({ confirmed: false });
  await declined.resolve();
  await declined.nodes['merchant-coupon-lookup'].click();
  await couponButton(declined.nodes, 0).click();
  assert.equal(declined.calls.some((call) => call.path?.endsWith('/redeem')), false);
  assert.match(declined.calls.find((call) => call.confirm).confirm, /고객이 이 혜택을 지금 받나요\? 되돌릴 수 없어요/);
  assert.equal(declined.nodes['merchant-coupon-list'].children.length, 2);

  const { nodes, calls, resolve } = await couponMerchant();
  await resolve();
  await nodes['merchant-coupon-lookup'].click();
  await couponButton(nodes, 0).click();
  const redeem = calls.find((call) => call.path?.endsWith('/redeem'));
  assert.equal(redeem.path, redeemPath('coupon/1'));
  assert.equal(redeem.path, '/api/web/merchant/merchants/real-merchant/coupons/coupon%2F1/redeem');
  assert.equal(redeem.options.method, 'POST');
  assert.equal(redeem.options.credentials, 'same-origin');
  assert.deepEqual(JSON.parse(redeem.options.body), { customerIdentityToken: 'customer-qr' });
  assert.equal(nodes['merchant-coupon-list'].children.length, 1);
  assert.equal(couponButton(nodes, 0).textContent, '체험 디저트 사용 처리');
  assert.equal(nodes['merchant-coupon-status'].textContent, '쿠폰 사용을 처리했어요.');
  assert.equal(nodes['merchant-coupon-lookup'].disabled, false);
});

test('점포 웹 쿠폰은 이미 사용한 재요청과 빈 목록을 구분해 안내한다', async () => {
  const replay = await couponMerchant({ redeem: () => okJson({ couponId: 'coupon/1', status: 'REDEEMED',
    redeemedAt: '2026-09-28T11:00:00.000Z', replayed: true }) });
  await replay.resolve();
  await replay.nodes['merchant-coupon-lookup'].click();
  await couponButton(replay.nodes, 0).click();
  assert.equal(replay.nodes['merchant-coupon-status'].textContent, '이미 사용 처리된 쿠폰이에요.');
  assert.equal(replay.nodes['merchant-coupon-list'].children.length, 1);

  const empty = await couponMerchant({ lookup: () => okJson({ identityExpiresAt: '2026-09-28T12:00:00.000Z', coupons: [] }) });
  await empty.resolve();
  await empty.nodes['merchant-coupon-lookup'].click();
  assert.equal(empty.nodes['merchant-coupon-status'].textContent, '이 점포에서 쓸 수 있는 쿠폰이 없어요');
  assert.equal(empty.nodes['merchant-coupon-list'].children.length, 0);
});

test('점포 웹 쿠폰 만료일은 브라우저 시간대가 아니라 한국 날짜로 표시한다', async () => {
  const { nodes, resolve } = await couponMerchant({ lookup: () => okJson({ identityExpiresAt: '2026-09-28T12:00:00.000Z', coupons: [
    { couponId: 'a', title: '음료', detail: '', expiresAt: '2026-10-29T14:59:59.999Z' },
    { couponId: 'b', title: '디저트', detail: '', expiresAt: '2026-10-29T15:00:00.000Z' },
  ] }) });
  await resolve();
  await nodes['merchant-coupon-lookup'].click();
  const texts = nodes['merchant-coupon-list'].children.map((item) => item.children[0].textContent);
  assert.deepEqual(texts, ['음료 · ~10월 29일까지', '디저트 · ~10월 30일까지']);
  assert.match(readFileSync(join(web, 'assets/merchant.mjs'), 'utf8'), /timeZone: 'Asia\/Seoul'/);
});

test('점포 웹 쿠폰 오류는 친절한 안내로 바꾸고 만료 쿠폰만 목록에서 뺀다', async () => {
  const cases = [
    ['COUPON_NOT_FOUND', 404, /쓸 수 없는 쿠폰이에요/, 2],
    ['COUPON_EXPIRED', 409, /유효기간이 지난 쿠폰이에요/, 1],
    ['COUPON_SELF_REDEEM', 403, /본인 쿠폰은 직접 사용 처리할 수 없어요\. 다른 직원에게 요청해 주세요/, 2],
    ['ACCOUNT_DELETED', 410, /고객 계정이 삭제돼 쿠폰을 사용할 수 없어요/, 2],
    ['MERCHANT_ACCESS_DENIED', 403, /권한이 없어요/, 2],
    ['SOMETHING_ELSE', 500, /쿠폰을 처리하지 못했어요/, 2],
  ];
  for (const [code, status, message, remaining] of cases) {
    const { nodes, resolve } = await couponMerchant({ redeem: () => apiError(status, code) });
    await resolve();
    await nodes['merchant-coupon-lookup'].click();
    await couponButton(nodes, 0).click();
    assert.match(nodes['merchant-coupon-status'].textContent, message, code);
    assert.equal(nodes['merchant-coupon-list'].children.length, remaining, code);
    assert.equal(nodes['merchant-coupon-lookup'].disabled, false, code);
    assert.equal(couponButton(nodes, 0).disabled, false, code);
  }
  const lookupDenied = await couponMerchant({ lookup: () => apiError(403, 'MERCHANT_ACCESS_DENIED') });
  await lookupDenied.resolve();
  await lookupDenied.nodes['merchant-coupon-lookup'].click();
  assert.match(lookupDenied.nodes['merchant-coupon-status'].textContent, /권한이 없어요/);
  assert.equal(lookupDenied.nodes['merchant-coupon-list'].children.length, 0);
});

test('점포 웹 쿠폰은 만료·사용 불가 고객 QR을 닫고 새 QR 요청을 안내하며 잘못된 응답은 표시하지 않는다', async () => {
  for (const [code, message] of [
    ['CUSTOMER_IDENTITY_EXPIRED', /고객 QR이 만료되었습니다/],
    ['CUSTOMER_IDENTITY_UNAVAILABLE', /사용할 수 없습니다/],
  ]) {
    const { nodes, resolve } = await couponMerchant({ lookup: () => apiError(410, code) });
    await resolve();
    await nodes['merchant-coupon-lookup'].click();
    assert.match(nodes['merchant-claim-result'].textContent, message, code);
    assert.match(nodes['merchant-claim-result'].textContent, /새 QR/, code);
    assert.equal(nodes['merchant-coupon'].hidden, true, code);
    assert.equal(nodes['merchant-coupon-list'].children.length, 0, code);
  }
  for (const body of [{}, { coupons: 'none' }, { coupons: [{ couponId: 'x', title: '', detail: '', expiresAt: '2026-10-28T00:00:00.000Z' }] },
    { coupons: [{ couponId: 'x', title: '음료', detail: '', expiresAt: 'soon' }] }, { coupons: [null] }]) {
    const { nodes, resolve } = await couponMerchant({ lookup: () => okJson(body) });
    await resolve();
    await nodes['merchant-coupon-lookup'].click();
    assert.equal(nodes['merchant-coupon-list'].children.length, 0);
    assert.match(nodes['merchant-coupon-status'].textContent, /쿠폰을 처리하지 못했어요/);
  }
});

test('점포 웹 쿠폰 영역은 QR 변경·방문 코드 발급·로그아웃·이탈 때 이전 고객 쿠폰을 지운다', async () => {
  const opened = async () => {
    const fixture = await couponMerchant();
    await fixture.resolve();
    await fixture.nodes['merchant-coupon-lookup'].click();
    assert.equal(fixture.nodes['merchant-coupon-list'].children.length, 2);
    return fixture;
  };
  const cleared = (nodes) => {
    assert.equal(nodes['merchant-coupon'].hidden, true);
    assert.equal(nodes['merchant-coupon-list'].children.length, 0);
    assert.equal(nodes['merchant-coupon-status'].textContent, '');
  };

  let fixture = await opened();
  fixture.nodes['merchant-claim-token'].value = 'other-qr';
  await fixture.nodes['merchant-claim-token'].dispatch('input');
  cleared(fixture.nodes);

  fixture = await opened();
  await fixture.nodes['merchant-claim-merchant'].dispatch('change');
  cleared(fixture.nodes);

  fixture = await opened();
  await fixture.nodes['merchant-logout'].click();
  cleared(fixture.nodes);

  fixture = await opened();
  fixture.listeners.get('pagehide')();
  cleared(fixture.nodes);

  fixture = await opened();
  await fixture.nodes['merchant-claim-resolve'].click();
  assert.equal(fixture.nodes['merchant-coupon-list'].children.length, 0);
  assert.equal(fixture.nodes['merchant-coupon'].hidden, false);

  fixture = await opened();
  fixture.nodes['merchant-claim-reference'].value = 'sale-1';
  fixture.nodes['merchant-claim-confirm'].checked = true;
  await fixture.nodes['merchant-claim-form'].submit();
  cleared(fixture.nodes);
  assert.equal(fixture.calls.filter((call) => call.path?.endsWith('/claim-slots')).length, 1);
});

test('점포 웹은 늦게 도착한 쿠폰 응답을 페이지 이탈 뒤 새 화면에 표시하지 않는다', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const { nodes, listeners, resolve } = await couponMerchant({ lookup: () => pending });
  await resolve();
  const lookingUp = nodes['merchant-coupon-lookup'].click();
  assert.equal(nodes['merchant-coupon-lookup'].disabled, true);
  listeners.get('pagehide')();
  release(okJson({ identityExpiresAt: '2026-09-28T12:00:00.000Z', coupons: staffCoupons() }));
  await lookingUp;
  assert.equal(nodes['merchant-coupon-list'].children.length, 0);
  assert.equal(nodes['merchant-coupon-status'].textContent, '');
  assert.equal(nodes['merchant-coupon-lookup'].disabled, false);
});

test('점포 웹 쿠폰 처리는 진행 중 중복 요청을 보내지 않는다', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const { nodes, calls, resolve } = await couponMerchant({ redeem: () => pending });
  await resolve();
  await nodes['merchant-coupon-lookup'].click();
  const first = couponButton(nodes, 0);
  const redeeming = first.click();
  assert.equal(first.disabled, true);
  assert.equal(couponButton(nodes, 1).disabled, true);
  assert.equal(nodes['merchant-coupon-lookup'].disabled, true);
  await couponButton(nodes, 1).click();
  await nodes['merchant-coupon-lookup'].click();
  release(okJson({ couponId: 'coupon/1', status: 'REDEEMED', redeemedAt: '2026-09-28T11:00:00.000Z', replayed: false }));
  await redeeming;
  assert.equal(calls.filter((call) => call.path?.endsWith('/redeem')).length, 1);
  assert.equal(calls.filter((call) => call.path === lookupPath).length, 1);
});

test('점포 웹 쿠폰 화면은 접근 가능한 마크업과 텍스트 노드 렌더링만 사용한다', () => {
  const merchantHtml = readFileSync(join(web, 'merchant.html'), 'utf8');
  const merchantScript = readFileSync(join(web, 'assets/merchant.mjs'), 'utf8');
  assert.match(merchantHtml, /<section id="merchant-coupon" aria-labelledby="merchant-coupon-title" hidden>/);
  assert.match(merchantHtml, /<button id="merchant-coupon-lookup"[^>]*type="button">이 고객 쿠폰 확인<\/button>/);
  assert.match(merchantHtml, /<ul id="merchant-coupon-list"/);
  assert.match(merchantHtml, /id="merchant-coupon-status" class="status" role="status" aria-live="polite"/);
  assert.doesNotMatch(merchantHtml + merchantScript, /innerHTML|outerHTML|insertAdjacentHTML|localStorage/);
  assert.match(merchantScript, /textContent = `\$\{coupon\.title\}/);
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

const pageSources = {
  app: html,
  merchant: readFileSync(join(web, 'merchant.html'), 'utf8'),
  admin: readFileSync(join(web, 'admin.html'), 'utf8'),
};
const cspOf = (source) => /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(source)?.[1];

test('웹 색·글자 토큰은 앱과 같은 --mc-* 블록으로 시작하고 옛 변수와 Georgia를 쓰지 않는다 (Issue #218)', () => {
  assert.ok(css.replaceAll('\r\n', '\n').trimStart().startsWith(':root {\n  color-scheme: light dark;'));
  for (const token of ['--mc-bg: #FAFAF5', '--mc-primary: #076F64', '--mc-sky-1: #BFE3FF', '--mc-bronze-edge: #8A5226',
    '--mc-gold-container: #FBEFC4', '--mc-stamp-ink: #A3401F', '--mc-radius-card: 20px', '--mc-radius-control: 14px',
    '--mc-page: min(72rem, calc(100vw - 40px))']) assert.ok(css.includes(token), token);
  const dark = /@media \(prefers-color-scheme: dark\) \{\s*:root \{([^}]+)\}/.exec(css)?.[1] ?? '';
  for (const token of ['--mc-bg: #112724', '--mc-primary: #83DCCA', '--mc-sky-1: #1D3A63', '--mc-stamp-ink: #FFB09A',
    '--mc-locked-fill: #262C37']) assert.ok(dark.includes(token), token);
  assert.doesNotMatch(css, /--(?:ink|muted|paper|night|moon|stream|line|focus|ribbon-ink)\b/);
  assert.doesNotMatch(css, /Georgia|(?<!sans-)serif/);
  assert.match(css, /h1 \{ font-size: clamp\(1\.9rem, 4\.2vw, 3\.2rem\)/);
  assert.match(css, /button, \.collection-action \{[^}]*min-height: 48px[^}]*border-radius: var\(--mc-radius-control\)[^}]*font-weight: 800/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  // 외부 이미지·글꼴 없이 같은 출처의 마스코트 한 장만 CSS에서 쓴다.
  assert.deepEqual([...new Set([...css.matchAll(/url\(([^)]+)\)/g)].map((match) => match[1].replaceAll('"', '')))], ['mascot-stamp.png']);
  assert.doesNotMatch(css, /https?:\/\//);
});

test('세 화면 머리글은 마스코트 스탬프와 월계 마스코트를 쓰고 점주·관리자 칩을 붙인다', () => {
  for (const [name, source] of Object.entries(pageSources)) {
    assert.match(source, /<img class="brand-mark" src="[^"]*mascot-stamp\.png" alt="" width="36" height="36">/, name);
    assert.match(source, /<p class="brand">[^]*월계 마스코트/, name);
    assert.doesNotMatch(source, /月|>\s*MassCOM\s*</, name);
  }
  assert.match(pageSources.merchant, /<span class="chip role-chip">점주<\/span>/);
  assert.match(pageSources.admin, /<span class="chip role-chip">관리자<\/span>/);
  assert.doesNotMatch(pageSources.app, /role-chip/);
});

test('수집품 제작·도감은 인라인 미디어만 추가하고 스크립트·연결 출처는 제한한다', () => {
  const base = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; ";
  const tail = "base-uri 'none'; form-action 'none'";
  assert.equal(cspOf(pageSources.app), `${base}img-src 'self' data:; media-src data: blob:; ${tail}`);
  assert.equal(cspOf(pageSources.admin), `${base}img-src 'self'; ${tail}`);
  assert.equal(cspOf(pageSources.merchant), `${base}img-src 'self' data:; media-src data: blob:; ${tail}`);
});

test('마스코트 스탬프는 네 자산 경로에서 PNG로 제공하고 60KB를 넘지 않는다', async () => {
  const disk = readFileSync(join(web, 'assets/mascot-stamp.png'));
  assert.ok(disk.length <= 60 * 1024, `${disk.length} bytes`);
  assert.deepEqual([...disk.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  for (const path of ['/assets/mascot-stamp.png', '/app/assets/mascot-stamp.png',
    '/merchant/assets/mascot-stamp.png', '/admin/assets/mascot-stamp.png']) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('content-type'), 'image/png', path);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff', path);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), disk, path);
  }
  const hidden = await fetch(`${base}/admin/assets/mascot-stamp.png`);
  assert.equal(hidden.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal((await fetch(`${base}/assets/mascot-stamp.svg`)).status, 404);
  assert.equal((await fetch(`${base}/assets/../server.mjs`)).status, 404);
});

test('점포 화면 쿠폰 목록은 티켓 모양 CSS를 쓰고 사용 처리 버튼은 글자 노드로만 만든다', () => {
  assert.match(css, /\.coupon-list > li[^{]*\{[^}]*mask:/);
  assert.match(css, /\.ticket-redeemed \.ticket-chip/);
  assert.match(css, /main\.page-narrow \{ width: min\(52rem, var\(--mc-page\)\); \}/);
  assert.match(pageSources.merchant, /<main id="main" class="page-narrow">/);
  assert.match(pageSources.admin, /<main id="main" class="page-medium">/);
  assert.match(readFileSync(join(web, 'assets/merchant.mjs'), 'utf8'), /text\.className = 'coupon-text'/);
  assert.match(pageSources.merchant, /<label>이용 식별 번호 <input id="merchant-claim-reference"/);
  assert.match(pageSources.merchant, /<label><input id="merchant-claim-confirm" type="checkbox"> 실제 이용을 확인했고/);
});



// --- 계정 삭제 요청(#194): 관리자 화면 ---

const deletionNodeIds = ['admin-status', 'admin-login', 'admin-content', 'admin-merchants', 'admin-operations',
  'admin-create', 'admin-logout', 'admin-deletions'];
const pendingIntake = {
  id: '11111111-1111-4111-8111-111111111111', status: 'REQUESTED', source: 'WEB',
  requestedAt: '2026-10-01T00:00:00.000Z', cancelUntil: '2026-10-02T00:00:00.000Z', dueAt: '2026-10-08T00:00:00.000Z',
  canProcess: true, overdue: false, accountLabel: 'acct_1a2b…9f0e', hasReceipt: true, processedAt: null, processedBy: null,
  rejectReason: null, deletion: null,
};

function deletionAdminFixture(intakes, handlers = {}) {
  const nodes = Object.fromEntries(deletionNodeIds.map(id => [id, { ...element(), hidden: true }]));
  const doc = { getElementById(id) { return nodes[id]; }, createElement: element };
  const calls = [];
  const fetcher = async (path, options = {}) => {
    calls.push({ path, method: options.method ?? 'GET', body: options.body });
    const handled = handlers[`${options.method ?? 'GET'} ${path}`];
    if (handled) return handled(options);
    return { ok: true, json: async () => path.endsWith('/me') ? { admin: true }
      : path.endsWith('/operations-status') ? { merchants: [] }
        : path.endsWith('/account-deletion-intakes') ? { intakes }
          : path.endsWith('/reconcile') ? { checked: 0, completed: 0, waiting: 0 } : { merchants: [] } };
  };
  return { nodes, doc, calls, fetcher };
}

test('관리 화면은 삭제 요청 구역을 마련하고 화면에 이메일이나 전체 계정 ID를 두지 않는다', () => {
  const page = readFileSync(new URL('../../apps/production-web/admin.html', import.meta.url), 'utf8');
  assert.match(page, /id="deletion-heading">계정 삭제 요청</);
  assert.match(page, /id="admin-deletions" role="status" aria-live="polite"/);
  assert.match(page, /24시간 취소 기간/);
  assert.match(page, /본인 요청은 처리할 수 없습니다/);
  assert.equal(formatKst('2026-10-01T16:30:00.000Z'), '2026-10-02 01:30 KST');
  assert.equal(formatKst('not a date'), '-');
});

test('삭제 요청 목록은 재정산을 먼저 부르고 마스킹한 표지·기한·처리 가능 여부를 텍스트로만 표시한다', async () => {
  const hostile = { ...pendingIntake, id: '22222222-2222-4222-8222-222222222222', canProcess: false,
    accountLabel: '<img src=x onerror=alert(1)>', overdue: true, source: 'SHOWCASE_APP' };
  const { nodes, doc, calls, fetcher } = deletionAdminFixture([pendingIntake, hostile]);
  await loadAdmin(fetcher, doc);
  const paths = calls.map(call => `${call.method} ${call.path}`);
  assert.ok(paths.indexOf('POST /api/web/admin/account-deletions/reconcile') >= 0);
  assert.ok(paths.indexOf('POST /api/web/admin/account-deletions/reconcile') < paths.indexOf('GET /api/web/admin/account-deletion-intakes'));
  assert.equal(calls.find(call => call.path.endsWith('/reconcile')).body, '{}');
  assert.equal(nodes['admin-deletions'].children.length, 2);
  const [ready, cooling] = nodes['admin-deletions'].children;
  assert.match(ready.children[0].textContent, /웹 접수 · 대기 · 계정 acct_1a2b…9f0e/);
  assert.match(ready.children[1].textContent, /접수 2026-10-01 09:00 KST · 취소 마감 2026-10-02 09:00 KST · 처리 기한 2026-10-08 09:00 KST/);
  assert.equal(ready.children[2].textContent, '삭제 처리');
  assert.equal(ready.children[2].disabled, false);
  assert.equal(cooling.children[0].textContent, '시연 앱 접수 · 대기 · 계정 <img src=x onerror=alert(1)>');
  assert.match(cooling.children[1].textContent, /기한 초과/);
  assert.equal(cooling.children[2].disabled, true);
  assert.match(cooling.children[2].textContent, /취소 기간 중/);
  const shown = JSON.stringify(nodes['admin-deletions'].children.map(child => child.children.map(node => node.textContent)));
  assert.doesNotMatch(shown, /@|"accountId"/);
});

test('삭제 처리는 두 번째 확인 클릭에서만 실행되고 결과 목록을 다시 불러온다', async () => {
  const done = { ...pendingIntake, status: 'PROCESSED', canProcess: false, accountLabel: null,
    processedAt: '2026-10-02T01:00:00.000Z', processedBy: 'admin-web', deletion: { status: 'WAITING_FOR_MINT_FINALITY', completedAt: null } };
  let processed = false;
  const { nodes, doc, calls, fetcher } = deletionAdminFixture([pendingIntake], {
    [`POST /api/web/admin/account-deletion-intakes/${pendingIntake.id}/process`]: () => {
      processed = true;
      return { ok: true, json: async () => ({ intake: done }) };
    },
  });
  const listed = fetcher;
  const dynamic = async (path, options) => {
    if (processed && path.endsWith('/account-deletion-intakes')) {
      calls.push({ path, method: 'GET' });
      return { ok: true, json: async () => ({ intakes: [done] }) };
    }
    return listed(path, options);
  };
  await loadAdmin(dynamic, doc);
  const button = nodes['admin-deletions'].children[0].children[2];
  await button.click();
  assert.equal(processed, false, '첫 클릭은 확인만 요구한다');
  assert.match(button.textContent, /정말 삭제 처리/);
  assert.match(nodes['admin-status'].textContent, /한 번 더 누르면/);
  await button.click();
  assert.equal(processed, true);
  assert.equal(calls.filter(call => call.method === 'POST' && call.path.endsWith('/process')).length, 1);
  assert.equal(calls.find(call => call.path.endsWith('/process')).body, '{}');
  assert.equal(nodes['admin-deletions'].children.length, 1);
  const finished = nodes['admin-deletions'].children[0];
  assert.match(finished.children[0].textContent, /처리 완료 · 계정 삭제됨/);
  assert.equal(finished.children.length, 3, '끝난 요청에는 처리·거절 버튼이 없다');
  assert.match(finished.children[2].textContent, /처리자 admin-web · 제출된 거래 결과 확인 중/);
  assert.match(nodes['admin-status'].textContent, /삭제 요청을 처리했습니다/);
});

test('삭제 처리 확인은 5초가 지나거나 초점이 떠나면 풀리고 두 번째 클릭은 요청을 한 번만 보낸다', async () => {
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const timers = new Map();
  let nextTimer = 1;
  globalThis.setTimeout = (callback, ms) => { const id = nextTimer++; timers.set(id, { callback, ms }); return id; };
  globalThis.clearTimeout = (id) => { timers.delete(id); };
  try {
    const { nodes, doc, calls, fetcher } = deletionAdminFixture([pendingIntake]);
    await loadAdmin(fetcher, doc);
    const button = nodes['admin-deletions'].children[0].children[2];
    const process = () => calls.filter(call => call.path.endsWith('/process')).length;
    // 시간이 지나면 풀린다.
    await button.click();
    assert.match(button.textContent, /정말 삭제 처리/);
    assert.equal(timers.size, 1);
    assert.equal([...timers.values()][0].ms, 5000);
    [...timers.values()][0].callback();
    assert.equal(button.textContent, '삭제 처리');
    assert.equal(button.attributes['aria-label'], 'acct_1a2b…9f0e 삭제 처리');
    assert.match(nodes['admin-status'].textContent, /확인이 풀렸습니다/);
    await button.click();
    assert.equal(process(), 0, '풀린 뒤 첫 클릭은 다시 확인만 요구한다');
    assert.match(button.textContent, /정말 삭제 처리/);
    // 초점이 떠나도 풀린다.
    await button.dispatch('blur');
    assert.equal(button.textContent, '삭제 처리');
    assert.equal(timers.size, 0, '풀리면 남은 시간도 지운다');
    assert.equal(process(), 0);
    // 확인 중 두 번째 클릭은 시간 제한을 지우고 요청을 보낸다.
    await button.click();
    assert.equal(timers.size, 1);
    await button.click();
    assert.equal(timers.size, 0);
    assert.equal(process(), 1);
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  }
});

test('삭제 요청 줄의 버튼과 입력은 마스킹한 계정 표지를 접근 가능한 이름에 담고 확인 상태도 이름에 반영한다', async () => {
  const cooling = { ...pendingIntake, id: '33333333-3333-4333-8333-333333333333', canProcess: false, accountLabel: 'acct_9z8y…7x6w' };
  const { nodes, doc, fetcher } = deletionAdminFixture([pendingIntake, cooling]);
  await loadAdmin(fetcher, doc);
  const [ready, waiting] = nodes['admin-deletions'].children;
  const [process, , reason, reject] = ready.children.slice(2);
  assert.equal(process.attributes['aria-label'], 'acct_1a2b…9f0e 삭제 처리');
  assert.equal(reason.attributes['aria-label'], 'acct_1a2b…9f0e 거절 사유');
  assert.equal(reject.attributes['aria-label'], 'acct_1a2b…9f0e 거절');
  await process.click();
  assert.equal(process.attributes['aria-label'], 'acct_1a2b…9f0e 정말 삭제 처리 (되돌릴 수 없음)');
  const [waitingProcess, , waitingReason, waitingReject] = waiting.children.slice(2);
  assert.equal(waitingProcess.attributes['aria-label'], 'acct_9z8y…7x6w 취소 기간 중 · 처리 불가');
  assert.equal(waitingReason.attributes['aria-label'], 'acct_9z8y…7x6w 거절 사유');
  assert.equal(waitingReject.attributes['aria-label'], 'acct_9z8y…7x6w 거절');
  const names = JSON.stringify(nodes['admin-deletions'].children.map(row => row.children.map(node => node.attributes)));
  assert.doesNotMatch(names, /@|"accountId"|acct_[0-9a-f]{8,}/);
});

test('접수번호가 없는 옛 접수는 운영자 목록에서 그렇게 표시하고 새 접수는 표시하지 않는다', async () => {
  const legacy = { ...pendingIntake, id: '44444444-4444-4444-8444-444444444444', hasReceipt: false };
  const withoutField = { ...pendingIntake, id: '55555555-5555-4555-8555-555555555555' };
  delete withoutField.hasReceipt;
  const { nodes, doc, fetcher } = deletionAdminFixture([pendingIntake, legacy, withoutField]);
  await loadAdmin(fetcher, doc);
  const [fresh, old, unknown] = nodes['admin-deletions'].children;
  assert.doesNotMatch(fresh.children[0].textContent, /옛 접수/);
  assert.match(old.children[0].textContent, /계정 acct_1a2b…9f0e · 옛 접수: 본인이 다시 접수해야 처리할 수 있어요/);
  assert.doesNotMatch(unknown.children[0].textContent, /옛 접수/, '필드가 없는 응답을 옛 접수로 단정하지 않는다');
});

test('옛 접수 줄은 처리 버튼을 막고 이유를 말하며, 끝난 옛 접수에는 그 표시를 붙이지 않는다', async () => {
  const legacy = { ...pendingIntake, id: '66666666-6666-4666-8666-666666666666', hasReceipt: false, canProcess: false };
  const finished = { ...pendingIntake, id: '77777777-7777-4777-8777-777777777777', hasReceipt: false, status: 'REJECTED',
    canProcess: false, accountLabel: null, processedAt: '2026-10-02T01:00:00.000Z', processedBy: 'admin-web', rejectReason: '다시 접수해 주세요' };
  const { nodes, doc, fetcher } = deletionAdminFixture([legacy, finished]);
  await loadAdmin(fetcher, doc);
  const [pending, ended] = nodes['admin-deletions'].children;
  const [process, , reason, reject] = pending.children.slice(2);
  assert.equal(process.disabled, true);
  assert.equal(process.textContent, '처리 불가 · 다시 접수 필요');
  assert.equal(process.attributes['aria-label'], 'acct_1a2b…9f0e 처리 불가 · 다시 접수 필요');
  assert.equal(reject.disabled ?? false, false, '옛 접수도 거절할 수 있다');
  assert.equal(reason.maxLength, 200);
  assert.doesNotMatch(ended.children[0].textContent, /옛 접수/);
});

test('거절 사유 입력 위에 요청자가 사유를 그대로 본다는 안내를 두고 입력과 연결한다', async () => {
  const { nodes, doc, fetcher } = deletionAdminFixture([pendingIntake]);
  await loadAdmin(fetcher, doc);
  const [, hint, reason] = nodes['admin-deletions'].children[0].children.slice(2);
  assert.equal(hint.textContent, '요청자가 접수번호로 이 사유를 그대로 봅니다. 개인정보를 쓰지 마세요.');
  assert.equal(reason.attributes['aria-describedby'], hint.attributes.id ?? hint.id);
  assert.match(hint.id ?? hint.attributes.id, /^deletion-reason-hint-/);
});

test('삭제 처리와 거절의 서버 거절 사유는 운영자가 이해할 문장으로 알린다', async () => {
  const cases = [
    ['DELETION_COOLING_OFF', /취소 기간/], ['DELETION_SELF_PROCESSING_REFUSED', /본인 요청은 처리할 수 없습니다/],
    ['DELETION_INTAKE_NOT_PENDING', /이미 처리/], ['DELETION_REJECT_REASON_INVALID', /1자 이상 200자/],
    ['DELETION_LEGACY_NEEDS_REFILE', /옛 접수: 본인이 다시 접수해야 처리할 수 있어요/],
    ['DELETION_BUSY', /다른 처리와 겹쳤습니다/],
  ];
  for (const [code, expected] of cases) {
    const failing = () => ({ ok: false, status: 409, json: async () => ({ code }) });
    const { nodes, doc, fetcher } = deletionAdminFixture([pendingIntake], {
      [`POST /api/web/admin/account-deletion-intakes/${pendingIntake.id}/process`]: failing,
      [`POST /api/web/admin/account-deletion-intakes/${pendingIntake.id}/reject`]: failing,
    });
    await loadAdmin(fetcher, doc);
    const [process, , reason, reject] = nodes['admin-deletions'].children[0].children.slice(2);
    await process.click();
    await process.click();
    assert.match(nodes['admin-status'].textContent, expected, code);
    assert.equal(process.disabled, false, code);
    assert.equal(process.textContent, '삭제 처리');
    reason.value = '사유';
    await reject.click();
    assert.match(nodes['admin-status'].textContent, expected, code);
    assert.equal(reject.disabled, false, code);
  }
});

test('삭제 거절은 입력한 사유를 그대로 보내고 성공하면 목록을 다시 불러온다', async () => {
  const rejected = { ...pendingIntake, status: 'REJECTED', canProcess: false, accountLabel: null,
    processedAt: '2026-10-02T01:00:00.000Z', processedBy: 'admin-web', rejectReason: '<b>본인 확인 불가</b>' };
  let done = false;
  const { nodes, doc, calls, fetcher } = deletionAdminFixture([pendingIntake], {
    [`POST /api/web/admin/account-deletion-intakes/${pendingIntake.id}/reject`]: () => {
      done = true;
      return { ok: true, json: async () => ({ intake: rejected }) };
    },
  });
  const dynamic = async (path, options) => done && path.endsWith('/account-deletion-intakes')
    ? { ok: true, json: async () => ({ intakes: [rejected] }) } : fetcher(path, options);
  await loadAdmin(dynamic, doc);
  const [, , reason, reject] = nodes['admin-deletions'].children[0].children.slice(2);
  assert.equal(reason.attributes['aria-label'], 'acct_1a2b…9f0e 거절 사유');
  assert.equal(reject.attributes['aria-label'], 'acct_1a2b…9f0e 거절');
  assert.equal(reason.maxLength, 200);
  reason.value = '<b>본인 확인 불가</b>';
  await reject.click();
  assert.deepEqual(JSON.parse(calls.find(call => call.path.endsWith('/reject')).body), { reason: '<b>본인 확인 불가</b>' });
  assert.match(nodes['admin-status'].textContent, /삭제 요청을 거절했습니다/);
  assert.match(nodes['admin-deletions'].children[0].children[2].textContent, /거절 사유 <b>본인 확인 불가<\/b>/);
});

test('삭제 요청 목록의 401·403은 관리 화면을 닫고 그 밖의 실패는 다른 구역을 막지 않는다', async () => {
  for (const denied of [401, 403]) {
    const { nodes, doc, fetcher } = deletionAdminFixture([], {
      'GET /api/web/admin/account-deletion-intakes': () => ({ ok: false, status: denied }),
    });
    await loadAdmin(fetcher, doc);
    assert.equal(nodes['admin-content'].hidden, true, String(denied));
    assert.equal(nodes['admin-deletions'].children.length, 0);
  }
  const { nodes, doc, fetcher } = deletionAdminFixture([], {
    'GET /api/web/admin/account-deletion-intakes': () => ({ ok: false, status: 500 }),
    'POST /api/web/admin/account-deletions/reconcile': () => ({ ok: false, status: 500 }),
  });
  await loadAdmin(fetcher, doc);
  assert.equal(nodes['admin-content'].hidden, false);
  assert.match(nodes['admin-deletions'].textContent, /불러오지 못했습니다/);
  const empty = deletionAdminFixture([]);
  await loadAdmin(empty.fetcher, empty.doc);
  assert.match(empty.nodes['admin-deletions'].textContent, /접수된 삭제 요청이 없습니다/);
});

// ---- Issue #243: 방문 취소·쿠폰 사용 되돌리기·관리자 쿠폰 무효화 ----
const merchantBase = '/api/web/merchant/merchants/real-merchant';
const visitsPath = `${merchantBase}/recent-visits`;
const redemptionsPath = `${merchantBase}/recent-coupon-redemptions`;
const cancelPath = (id) => `${merchantBase}/visits/${encodeURIComponent(id)}/cancel`;
const undoPath = (id) => `${merchantBase}/coupons/${encodeURIComponent(id)}/undo-redeem`;

const recentVisits = () => ({ businessDate: '2026-09-30', visits: [
  { visitEventId: 'visit-1', occurredAt: '2026-09-30T03:05:00.000Z', customerLabel: '손님 K7QM', status: 'VALID',
    progressCounted: true, cancellationReason: null, canCancel: true },
  { visitEventId: 'visit/2', occurredAt: '2026-09-30T02:00:00.000Z', customerLabel: '<b>손님</b>', status: 'VALID',
    progressCounted: false, cancellationReason: null, canCancel: true },
  { visitEventId: 'visit-3', occurredAt: '2026-09-30T01:00:00.000Z', customerLabel: '손님 AB2C', status: 'CANCELED',
    progressCounted: true, cancellationReason: 'DUPLICATE', canCancel: false },
] });
const recentRedemptions = () => ({ coupons: [
  { couponId: 'coupon-1', title: '음료 1잔', redeemedAt: '2026-09-30T03:00:00.000Z', customerLabel: '손님 K7QM',
    redeemedByMe: true, undoUntil: '2026-09-30T03:10:00.000Z', canUndo: true },
  // 되돌리기 기한이 이미 지난 쿠폰. 기한이 남았는데 canUndo=false면 '본인 쿠폰' 안내가 나오므로 확실히 지난 날짜를 쓴다.
  { couponId: 'coupon-2', title: '디저트', redeemedAt: '2020-01-01T01:00:00.000Z', customerLabel: '손님 AB2C',
    redeemedByMe: false, undoUntil: '2020-01-01T01:10:00.000Z', canUndo: false },
] });
const cancelled = (over = {}) => ({ visitEventId: 'visit-1', status: 'CANCELED', reason: 'DUPLICATE', note: null,
  canceledAt: '2026-09-30T03:06:00.000Z', revokedRewardCount: 0, voidedCouponCount: 0, replayed: false, ...over });

async function reversalMerchant({ visits = () => okJson(recentVisits()), redemptions = () => okJson(recentRedemptions()),
  cancel = () => okJson(cancelled()), undo = () => okJson({ couponId: 'coupon-1', status: 'ISSUED', replayed: false }),
  confirmed = true, merchants = [{ id: 'real-merchant', name: '실제 점포', role: 'STAFF' }], deferBind = false } = {}) {
  const fixture = merchantDocument();
  const { nodes, doc } = fixture;
  for (const id of ['merchant-reversal', 'merchant-reversal-merchant', 'merchant-reversal-refresh', 'merchant-visit-list',
    'merchant-visit-status', 'merchant-redemption-list', 'merchant-redemption-status']) nodes[id] = { ...element(), hidden: true };
  nodes['merchant-reversal-merchant'].value = 'real-merchant';
  const calls = [];
  let loggedOut = false;
  doc.defaultView.confirm = (message) => { calls.push({ confirm: message }); return confirmed; };
  const fetcher = async (path, options) => {
    if (path === '/api/web/merchant/me') return loggedOut ? apiError(401, 'WEB_AUTH_REQUIRED') : okJson({ merchants });
    if (path === '/api/web/merchant/registration-merchants') return okJson({ merchants: [] });
    if (path === '/api/web/logout') { loggedOut = true; return { ok: true, status: 204 }; }
    calls.push({ path, options });
    // 점포마다 같은 모양의 경로라 접미사로 가른다. 응답 만들기에는 요청한 경로를 넘겨 점포별로 다르게 답할 수 있다.
    if (path.endsWith('/recent-visits')) return visits(path);
    if (path.endsWith('/recent-coupon-redemptions')) return redemptions(path);
    if (path.endsWith('/cancel')) return cancel();
    if (path.endsWith('/undo-redeem')) return undo();
    throw new Error(`unexpected ${path}`);
  };
  // bindMerchant는 점포 권한을 확인하고 구역을 연 뒤 최근 방문·쿠폰 사용을 바로 읽고 나서 끝난다.
  const bound = bindMerchant(fetcher, doc);
  const requests = () => calls.filter((call) => call.path);
  const rows = (id) => nodes[id].children;
  const api = { ...fixture, calls, fetcher, requests, refresh: () => nodes['merchant-reversal-refresh'].click(),
    visitRows: () => rows('merchant-visit-list'), redemptionRows: () => rows('merchant-redemption-list'), bound };
  if (!deferBind) await bound;
  return api;
}

const visitForm = (row) => row.children[1];
const visitSubmit = (row) => visitForm(row).children[2];
const visitReason = (row) => visitForm(row).children[0].children[0];
const visitNote = (row) => visitForm(row).children[1].children[0];
const undoButton = (row) => row.children[2];

test('점포 웹 되돌리기 영역은 소속 점포가 있을 때만 열리고 구역이 열리면 목록을 바로 불러온다', async () => {
  const { nodes, requests, refresh, visitRows, redemptionRows } = await reversalMerchant();
  assert.equal(nodes['merchant-reversal'].hidden, false);
  assert.equal(nodes['merchant-reversal-merchant'].children.length, 1);
  assert.equal(nodes['merchant-reversal-merchant'].children[0].value, 'real-merchant');
  // 구역이 열리면 누르지 않아도 두 목록을 한 번씩 읽는다(요청 수 고정: 열 때 방문·쿠폰 사용 각 1회).
  assert.deepEqual(requests().map((call) => [call.path, call.options.method]), [[visitsPath, 'GET'], [redemptionsPath, 'GET']]);
  assert.equal(requests()[0].options.credentials, 'same-origin');
  assert.equal(requests()[0].options.cache, 'no-store');
  assert.equal(visitRows().length, 3);
  assert.equal(redemptionRows().length, 2);
  assert.match(nodes['merchant-visit-status'].textContent, /3건/);
  // "목록 새로 고침"은 같은 두 요청을 다시 보낸다.
  await refresh();
  assert.deepEqual(requests().map((call) => call.path), [visitsPath, redemptionsPath, visitsPath, redemptionsPath]);

  const [counted, uncounted, canceled] = visitRows();
  assert.equal(first(counted, 'reversal-text').textContent, '12:05 · 손님 K7QM · 진행 반영');
  assert.match(first(uncounted, 'reversal-text').textContent, /^11:00 · <b>손님<\/b> · 기록만/);
  assert.equal(first(canceled, 'reversal-text').textContent, '10:00 · 손님 AB2C · 취소됨 · 같은 방문을 두 번 확인했어요');
  assert.equal(canceled.children.length, 1);
  assert.equal(visitForm(counted).children.length, 3);
  assert.deepEqual(visitReason(counted).children.map((option) => option.value), ['WRONG_CUSTOMER', 'DUPLICATE', 'NOT_A_REAL_VISIT', 'OTHER']);
  assert.equal(visitNote(counted).maxLength, 100);
  assert.equal(visitSubmit(counted).textContent, '방문 취소');
  assert.equal(visitSubmit(counted).className, 'danger');
  assert.equal(visitSubmit(counted).getAttribute('aria-label'), '12:05 손님 K7QM 방문 취소');
  assert.doesNotMatch(textOf(nodes['merchant-visit-list']), /accountId|customerAccountId|@/);

  const [undoable, expired] = redemptionRows();
  assert.equal(first(undoable, 'reversal-text').textContent, '음료 1잔 · 손님 K7QM · 12:00 사용 (내가 처리)');
  assert.equal(first(undoable, 'reversal-meta').textContent, '12:10까지 되돌릴 수 있어요.');
  assert.equal(undoButton(undoable).textContent, '사용 되돌리기');
  assert.equal(first(expired, 'reversal-meta').textContent, '되돌리기 시간이 지났어요.');
  assert.equal(expired.children.length, 2);

  // 소속 점포가 없으면 구역은 닫힌 채이고 아무것도 읽지 않는다.
  const none = await reversalMerchant({ merchants: [] });
  assert.equal(none.nodes['merchant-reversal'].hidden, true);
  assert.deepEqual(none.requests(), []);
});

test('점포 웹은 확인창에서 동의한 방문만 사유와 함께 취소하고 목록을 다시 불러온다', async () => {
  const declined = await reversalMerchant({ confirmed: false });
  await visitForm(declined.visitRows()[0]).submit();
  assert.equal(declined.requests().some((call) => call.path.endsWith('/cancel')), false);
  assert.match(declined.calls.find((call) => call.confirm).confirm, /12:05 손님 K7QM 방문을 취소할까요/);
  // 확인창에서 그만두면 짧은 안내를 남기고 아무것도 바꾸지 않는다.
  assert.match(declined.nodes['merchant-visit-status'].textContent, /^취소했어요\. 방문 기록은 그대로예요\./);
  assert.equal(declined.requests().length, 2);

  const { nodes, calls, requests, visitRows } = await reversalMerchant({
    cancel: () => okJson(cancelled({ revokedRewardCount: 1, voidedCouponCount: 2 })),
  });
  const row = visitRows()[1];
  visitReason(row).value = 'NOT_A_REAL_VISIT';
  visitNote(row).value = '  옆 테이블 손님  ';
  // 화면의 안내는 서버가 못 걸러내는 이름도 적지 말라고 알린다(개인정보 처리방침과 같은 내용).
  assert.match(visitForm(row).children[1].textContent, /연락처·이메일·주소·이름은 적지 마세요/);
  await visitForm(row).submit();
  const cancel = requests().find((call) => call.path.endsWith('/cancel'));
  assert.equal(cancel.path, cancelPath('visit/2'));
  assert.equal(cancel.options.method, 'POST');
  assert.equal(cancel.options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(cancel.options.body), { reason: 'NOT_A_REAL_VISIT', note: '옆 테이블 손님' });
  assert.match(nodes['merchant-visit-status'].textContent, /방문을 취소했어요\. \(보상 권리 1개 취소, 미사용 쿠폰 2장 무효\)/);
  // 취소 뒤 두 목록을 다시 읽는다.
  assert.equal(requests().filter((call) => call.path === visitsPath).length, 2);
  assert.equal(requests().filter((call) => call.path === redemptionsPath).length, 2);

  // 메모를 비우면 보내지 않고, 이미 취소된 방문은 그렇게 알려 준다.
  const replay = await reversalMerchant({ cancel: () => okJson(cancelled({ replayed: true })) });
  await visitForm(replay.visitRows()[0]).submit();
  const body = JSON.parse(replay.requests().find((call) => call.path.endsWith('/cancel')).options.body);
  assert.deepEqual(body, { reason: 'WRONG_CUSTOMER' });
  assert.match(replay.nodes['merchant-visit-status'].textContent, /이미 취소된 방문이에요/);
  assert.equal(calls.length > 0, true);
});

test('점포 웹 방문 취소 실패는 코드별 안내를 보이고 창이 닫힌 경우 목록을 새로 고친다', async () => {
  const cases = [
    ['VISIT_CANCEL_WINDOW_CLOSED', 409, /방문한 날이 지나 취소할 수 없어요/, true],
    ['VISIT_REWARD_ALREADY_MINTED', 409, /NFT를 이미 발행했거나 발행 중이라 취소할 수 없어요/, false],
    ['VISIT_REWARD_MINT_IN_PROGRESS', 409, /잠시 뒤 다시 시도해 주세요/, false],
    ['VISIT_NOT_FOUND', 404, /찾을 수 없는 방문/, true],
    ['MERCHANT_ACCESS_DENIED', 403, /권한이 없어요/, false],
    ['INVALID_REVERSAL_NOTE', 400, /100자 이하로 쓰고 연락처·이메일·주소는 적지 마세요/, false],
    ['SOMETHING_ELSE', 500, /방문을 취소하지 못했어요/, false],
  ];
  for (const [code, status, pattern, refreshes] of cases) {
    const fixture = await reversalMerchant({ cancel: () => apiError(status, code) });
    await visitForm(fixture.visitRows()[0]).submit();
    assert.match(fixture.nodes['merchant-visit-status'].textContent, pattern, code);
    assert.equal(fixture.requests().filter((call) => call.path === visitsPath).length, refreshes ? 2 : 1, code);
    assert.equal(visitSubmit(fixture.visitRows()[0]).disabled, false, code);
  }
  assert.match(visitCancelMessage({ status: 401 }), /다시 로그인해 주세요/);
  assert.doesNotMatch(visitCancelMessage({ status: 401 }), /습니다/);
  assert.match(visitCancelMessage({ code: 'ACCOUNT_DELETED' }), /삭제/);
  assert.match(visitCancelMessage({ code: 'INVALID_REVERSAL_REASON' }), /사유를 골라/);
});

test('점포 웹 방문 취소 버튼은 처리 중에 다시 눌러도 한 번만 보낸다', async () => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const fixture = await reversalMerchant({ cancel: () => pending });
  const row = fixture.visitRows()[0];
  const first = visitForm(row).submit();
  await visitForm(fixture.visitRows()[1]).submit();
  assert.equal(fixture.requests().filter((call) => call.path.endsWith('/cancel')).length, 1);
  assert.equal(visitSubmit(row).disabled, true);
  finish(okJson(cancelled()));
  await first;
  assert.equal(fixture.requests().filter((call) => call.path.endsWith('/cancel')).length, 1);
});

test('점포 웹은 기한이 남은 본인 쿠폰에 되돌리기 대신 본인 쿠폰 안내를 보인다', async () => {
  const fixture = await reversalMerchant({ redemptions: () => okJson({ coupons: [
    { couponId: 'coupon-3', title: '음료 1잔', redeemedAt: '2099-01-01T00:00:00.000Z', customerLabel: '손님 ME11',
      redeemedByMe: false, undoUntil: '2099-01-01T00:10:00.000Z', canUndo: false },
  ] }) });
  const [own] = fixture.redemptionRows();
  assert.equal(own.children.some((child) => child.textContent === '사용 되돌리기'), false);
  assert.equal(own.children.find((child) => child.className === 'reversal-meta').textContent, '본인 쿠폰은 되돌릴 수 없어요.');
});

test('점포 웹은 10분 안의 쿠폰 사용만 되돌리게 하고 결과와 실패를 안내한다', async () => {
  const fixture = await reversalMerchant();
  const [undoable, expired] = fixture.redemptionRows();
  assert.equal(expired.children.some((child) => child.textContent === '사용 되돌리기'), false);
  await undoButton(undoable).click();
  const call = fixture.requests().find((request) => request.path.endsWith('/undo-redeem'));
  assert.equal(call.path, undoPath('coupon-1'));
  assert.equal(call.options.method, 'POST');
  assert.deepEqual(JSON.parse(call.options.body), {});
  assert.match(fixture.calls.find((entry) => entry.confirm).confirm, /음료 1잔 · 손님 K7QM\n쿠폰 사용을 되돌릴까요/);
  assert.match(fixture.nodes['merchant-redemption-status'].textContent, /쿠폰 사용을 되돌렸어요/);
  assert.equal(fixture.requests().filter((request) => request.path === redemptionsPath).length, 2);

  // 확인창에서 그만두면 짧은 안내만 남기고 요청도 다시 읽기도 하지 않는다.
  const declined = await reversalMerchant({ confirmed: false });
  await undoButton(declined.redemptionRows()[0]).click();
  assert.equal(declined.requests().some((request) => request.path.endsWith('/undo-redeem')), false);
  assert.match(declined.nodes['merchant-redemption-status'].textContent, /^취소했어요\. 쿠폰은 사용 완료 그대로예요\./);
  assert.equal(declined.requests().length, 2);

  const replay = await reversalMerchant({ undo: () => okJson({ couponId: 'coupon-1', status: 'ISSUED', replayed: true }) });
  await undoButton(replay.redemptionRows()[0]).click();
  assert.match(replay.nodes['merchant-redemption-status'].textContent, /이미 되돌린 쿠폰이에요/);

  for (const [code, status, pattern, refreshes] of [
    ['COUPON_UNDO_WINDOW_CLOSED', 409, /10분이 지나 되돌릴 수 없어요/, true],
    ['COUPON_NOT_REDEEMED', 409, /사용 처리된 쿠폰이 아니라서/, true],
    ['COUPON_NOT_FOUND', 404, /찾을 수 없는 쿠폰이에요\. 목록을 새로 불러왔어요/, true],
    ['COUPON_REQUIREMENT_LOST', 409, /배지 조건이 사라져서 되돌릴 수 없어요/, true],
    ['COUPON_SELF_UNDO', 403, /본인 쿠폰은 직접 되돌릴 수 없어요\. 다른 직원에게 요청/, false],
    ['MERCHANT_ACCESS_DENIED', 403, /권한이 없어요/, false],
    ['INTERNAL_ERROR', 500, /되돌리지 못했어요/, false],
  ]) {
    const failing = await reversalMerchant({ undo: () => apiError(status, code) });
    await undoButton(failing.redemptionRows()[0]).click();
    assert.match(failing.nodes['merchant-redemption-status'].textContent, pattern, code);
    assert.equal(failing.requests().filter((request) => request.path === redemptionsPath).length, refreshes ? 2 : 1, code);
  }
  assert.match(couponUndoMessage({ status: 401 }), /다시 로그인해 주세요/);
  assert.doesNotMatch(couponUndoMessage({ status: 401 }), /습니다/);
  assert.match(couponUndoMessage({ code: 'ACCOUNT_DELETED' }), /삭제/);
});

test('점포 웹 되돌리기 목록은 잘못된 응답을 표시하지 않고 이탈·로그아웃·점포 변경 때 지운다', async () => {
  const bad = await reversalMerchant({
    visits: () => okJson({ visits: [{ visitEventId: 'v', occurredAt: 'nope' }] }),
    redemptions: () => apiError(403, 'MERCHANT_ACCESS_DENIED'),
  });
  assert.equal(bad.visitRows().length, 0);
  assert.equal(bad.redemptionRows().length, 0);
  assert.match(bad.nodes['merchant-visit-status'].textContent, /불러오지 못했어요/);
  assert.match(bad.nodes['merchant-redemption-status'].textContent, /볼 권한이 없어요/);

  const fixture = await reversalMerchant();
  assert.equal(fixture.visitRows().length, 3);
  fixture.listeners.get('pagehide')();
  assert.equal(fixture.visitRows().length, 0);
  assert.equal(fixture.redemptionRows().length, 0);
  assert.equal(fixture.nodes['merchant-visit-status'].textContent, '');

  await fixture.refresh();
  assert.equal(fixture.visitRows().length, 3);
  // 로그아웃하면 목록을 지우고, 로그아웃된 채로 다시 확인한 점포 화면은 목록을 읽지 않는다.
  const beforeLogout = fixture.requests().length;
  await fixture.nodes['merchant-logout'].click();
  assert.equal(fixture.visitRows().length, 0);
  assert.equal(fixture.redemptionRows().length, 0);
  assert.equal(fixture.requests().length, beforeLogout);

  // 점포를 바꾸면 이전 점포 목록은 지워지고 새 점포 목록을 바로 읽으며, 늦게 도착한 이전 응답은 그리지 않는다.
  let finish;
  const late = new Promise((resolve) => { finish = resolve; });
  const otherVisits = `/api/web/merchant/merchants/other-merchant/recent-visits`;
  const swapped = await reversalMerchant({
    deferBind: true,
    visits: (path) => (path === otherVisits ? okJson({ businessDate: '2026-09-30', visits: [] }) : late),
  });
  await new Promise((resolve) => setImmediate(resolve));
  swapped.nodes['merchant-reversal-merchant'].value = 'other-merchant';
  await swapped.nodes['merchant-reversal-merchant'].dispatch('change');
  assert.equal(swapped.requests().some((call) => call.path === otherVisits), true);
  finish(okJson(recentVisits()));
  await swapped.bound;
  assert.equal(swapped.visitRows().length, 0);
  assert.match(swapped.nodes['merchant-visit-status'].textContent, /확인한 방문이 없어요/);
});

test('점포 웹 되돌리기 화면은 HTML 문자열을 만들지 않고 문구와 접근성 연결을 갖춘다', () => {
  const merchantHtml = readFileSync(join(web, 'merchant.html'), 'utf8');
  const merchantScript = readFileSync(join(web, 'assets/merchant.mjs'), 'utf8');
  assert.match(merchantHtml, /id="merchant-reversal"[^>]*aria-labelledby="merchant-reversal-title"[^>]*hidden/);
  assert.match(merchantHtml, /최근 방문 확인/);
  assert.match(merchantHtml, /최근 쿠폰 사용/);
  assert.match(merchantHtml, /id="merchant-visit-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(merchantHtml, /id="merchant-redemption-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(merchantHtml, /id="merchant-visit-list"[^>]*aria-labelledby="merchant-visit-title"/);
  assert.doesNotMatch(merchantScript, /innerHTML|outerHTML|insertAdjacentHTML/);
  assert.match(css, /\.reversal-list > li \{/);
});

const adminCouponList = () => ({ coupons: [
  { couponId: 'coupon/1', milestone: 1, title: '음료 1잔', status: 'ISSUED', expired: false,
    issuedAt: '2026-09-29T03:00:00.000Z', expiresAt: '2026-10-29T14:59:59.999Z', redeemedAt: null, voidReason: null,
    customerLabel: '손님 K7QM' },
  { couponId: 'coupon-2', milestone: 2, title: '<b>디저트</b>', status: 'REDEEMED', expired: false,
    issuedAt: '2026-09-28T03:00:00.000Z', expiresAt: '2026-10-28T14:59:59.999Z', redeemedAt: '2026-09-29T05:00:00.000Z',
    voidReason: null, customerLabel: '손님 AB2C' },
  { couponId: 'coupon-3', milestone: 1, title: '음료 1잔', status: 'VOIDED', expired: false,
    issuedAt: '2026-09-27T03:00:00.000Z', expiresAt: '2026-10-27T14:59:59.999Z', redeemedAt: null,
    voidReason: 'VISIT_CANCELED', customerLabel: '손님 ZZ22' },
] });

async function adminCoupons({ list = () => okJson(adminCouponList()),
  voidCoupon = () => okJson({ coupon: { couponId: 'coupon/1', status: 'VOIDED', voidReason: 'OTHER',
    voidedAt: '2026-09-30T00:00:00.000Z' }, replayed: false }), confirmed = true } = {}) {
  const nodes = Object.fromEntries(['admin-status', 'admin-login', 'admin-content', 'admin-merchants', 'admin-create',
    'admin-logout'].map((id) => [id, { ...element(), hidden: true }]));
  const calls = [];
  const doc = { getElementById(id) { return nodes[id]; }, createElement: element,
    defaultView: { confirm: (message) => { calls.push({ confirm: message }); return confirmed; } } };
  const fetcher = async (path, options) => {
    if (path.endsWith('/me')) return okJson({ admin: true });
    if (path === '/api/web/admin/merchants') return okJson({ merchants: [{ id: 'real-1', name: '실제 점포', story: '', roadAddress: '서울',
      minimumSpendWon: 0, status: 'ACTIVE', demo: false, version: 1 }] });
    if (path.endsWith('/staff')) return okJson({ staff: [] });
    calls.push({ path, options });
    if (path === '/api/web/admin/merchants/real-1/coupons') return list();
    if (path.endsWith('/void')) return voidCoupon();
    throw new Error(`unexpected ${path}`);
  };
  await loadAdmin(fetcher, doc);
  const panel = nodes['admin-merchants'].children[1].children[3];
  return { nodes, calls, panel, load: () => panel.children[2].click(), rows: () => panel.children[4].children,
    status: () => panel.children[3].textContent, requests: () => calls.filter((call) => call.path) };
}

test('관리자 웹은 쿠폰 목록을 가림 표시로 보이고 미사용 쿠폰만 무효화 양식을 준다', async () => {
  const fixture = await adminCoupons();
  assert.equal(fixture.panel.className, 'admin-coupons');
  assert.equal(fixture.panel.children[0].textContent, '쿠폰 관리');
  assert.equal(fixture.panel.children[3].getAttribute('role'), 'status');
  // 접근성: 점포가 여럿이어도 화면 낭독기가 어느 점포의 버튼인지 알 수 있게 이름에 점포 이름이 들어간다.
  assert.equal(fixture.panel.getAttribute('aria-label'), '실제 점포 쿠폰 관리');
  assert.equal(fixture.panel.children[2].getAttribute('aria-label'), '실제 점포 쿠폰 목록 불러오기');
  assert.deepEqual(fixture.requests(), []);
  await fixture.load();
  assert.equal(fixture.rows()[0].children[1].children[2].getAttribute('aria-label'), '실제 점포 음료 1잔 손님 K7QM 쿠폰 무효화');
  assert.deepEqual(fixture.requests().map((call) => call.path), ['/api/web/admin/merchants/real-1/coupons']);
  assert.equal(fixture.requests()[0].options.method, 'GET');
  assert.match(fixture.status(), /3장/);
  const [issued, redeemed, voided] = fixture.rows();
  assert.match(first(issued, 'reversal-text').textContent, /^1번째 상자 · 음료 1잔 · 손님 K7QM · 사용 가능 · 발급 9월 29일$/);
  assert.equal(first(redeemed, 'reversal-text').textContent.startsWith('2번째 상자 · <b>디저트</b> · 손님 AB2C · 사용 완료'), true);
  assert.match(first(voided, 'reversal-text').textContent, /무효 · 방문 취소로 조건이 깨져 무효/);
  assert.equal(issued.children.length, 2);
  assert.equal(redeemed.children.length, 1);
  assert.equal(voided.children.length, 1);
  const form = issued.children[1];
  assert.deepEqual(form.children[0].children[0].children.map((option) => option.value),
    ['ISSUED_IN_ERROR', 'ABUSE_SUSPECTED', 'MERCHANT_REQUEST', 'OTHER']);
  assert.equal(form.children[1].children[0].maxLength, 100);
  assert.equal(form.children[2].textContent, '쿠폰 무효화');
  assert.equal(form.children[2].className, 'danger');
  assert.doesNotMatch(textOf(fixture.panel), /accountId|customerAccountId/);
});

test('관리자 웹은 확인창에서 동의한 쿠폰만 사유와 함께 무효로 하고 실패를 안내한다', async () => {
  const declined = await adminCoupons({ confirmed: false });
  await declined.load();
  await declined.rows()[0].children[1].submit();
  assert.equal(declined.requests().some((call) => call.path.endsWith('/void')), false);
  assert.match(declined.calls.find((call) => call.confirm).confirm, /음료 1잔 · 손님 K7QM\n이 쿠폰을 무효로 할까요/);

  const fixture = await adminCoupons();
  await fixture.load();
  const form = fixture.rows()[0].children[1];
  form.children[0].children[0].value = 'ABUSE_SUSPECTED';
  form.children[1].children[0].value = '  중복 발급 의심 ';
  assert.match(form.children[1].textContent, /연락처·이메일·주소·이름은 적지 마세요/);
  await form.submit();
  const call = fixture.requests().find((request) => request.path.endsWith('/void'));
  assert.equal(call.path, '/api/web/admin/coupons/coupon%2F1/void');
  assert.equal(call.options.method, 'POST');
  assert.deepEqual(JSON.parse(call.options.body), { reason: 'ABUSE_SUSPECTED', note: '중복 발급 의심' });
  assert.match(fixture.status(), /쿠폰을 무효로 했어요/);
  assert.equal(fixture.requests().filter((request) => request.path.endsWith('/coupons')).length, 2);

  for (const [code, status, pattern, refreshes] of [
    ['ADMIN_COUPON_NOT_VOIDABLE', 409, /이미 사용한 쿠폰은 무효로 할 수 없어요/, true],
    ['ADMIN_COUPON_NOT_FOUND', 404, /쿠폰을 찾을 수 없어요/, true],
    ['ADMIN_INVALID_INPUT', 400, /100자 이하로 연락처·이메일·주소 없이/, false],
    ['ADMIN_FORBIDDEN', 403, /관리자 권한을 확인하지 못했어요/, false],
    ['INTERNAL_ERROR', 500, /무효로 하지 못했어요/, false],
  ]) {
    const failing = await adminCoupons({ voidCoupon: () => apiError(status, code) });
    await failing.load();
    const failForm = failing.rows()[0].children[1];
    await failForm.submit();
    assert.match(failing.status(), pattern, code);
    assert.equal(failForm.children[2].disabled, false, code);
    // 이미 사용됐거나 없는 쿠폰이면 목록이 낡은 것이라 새로 읽고 안내는 그대로 남긴다.
    assert.equal(failing.requests().filter((request) => request.path.endsWith('/coupons')).length, refreshes ? 2 : 1, code);
  }
  assert.match(couponVoidMessage({ status: 401 }), /다시 로그인/);
  const broken = await adminCoupons({ list: () => okJson({ coupons: [{ couponId: 'x' }] }) });
  await broken.load();
  assert.equal(broken.rows().length, 0);
  assert.match(broken.status(), /불러오지 못했어요/);
});

test('관리자 웹은 시연 점포처럼 서버가 대상이 아니라고 답하면 일반 실패 문구 대신 그렇게 알린다', async () => {
  // 서버는 시연 점포(와 없는 점포)의 쿠폰 목록을 ADMIN_MERCHANT_NOT_FOUND로 거절한다.
  const missing = await adminCoupons({ list: () => apiError(404, 'ADMIN_MERCHANT_NOT_FOUND') });
  await missing.load();
  assert.equal(missing.status(), '점포를 찾을 수 없어요. 시연 점포는 대상이 아니에요.');
  assert.equal(missing.rows().length, 0);
  const generic = await adminCoupons({ list: () => apiError(500, 'INTERNAL_ERROR') });
  await generic.load();
  assert.match(generic.status(), /쿠폰 목록을 불러오지 못했어요/);
});

// ---- Issue #330: 점주 웹 가게 현황(요약 카드 + 오픈 준비 체크리스트) ----
const overviewPath = `${merchantBase}/overview`;
const readinessSteps = () => [
  { key: 'basic', label: '가게 기본 정보', state: 'DONE', hint: '' },
  { key: 'menu', label: '메뉴', state: 'DONE', hint: '메뉴 2개가 등록돼 있어요.' },
  { key: 'members', label: '점주·직원', state: 'DONE', hint: '점주 1명 · 직원 2명' },
  { key: 'reward', label: '방문 보상', state: 'NEEDS_SETUP', hint: '<b>수집품</b>을 연결해 주세요. 쿠폰 혜택은 운영팀이 플랫폼 단위로 설정해요.' },
  { key: 'campaign', label: '캠페인', state: 'SCHEDULED', hint: '캠페인 시작일이 아직 되지 않아 고객 목록에는 표시되지 않습니다.' },
  { key: 'visible', label: '고객 앱 공개', state: 'WAITING_APPROVAL', hint: '운영팀 공개 처리 대기 중이에요.' },
];
const overviewData = (over = {}) => ({
  generatedAt: '2026-10-07T03:00:00.000Z', businessDate: '2026-10-07', weekStartsOn: '2026-10-05',
  visits: { today: 2, thisWeek: 4, lastWeek: 4, total: 9,
    last7Days: ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07']
      .map((date, index) => ({ date, count: [0, 0, 0, 2, 1, 1, 2][index] })) },
  comparison: { lastWeekSameSpan: 2, delta: 2 },
  couponsRedeemedThisWeek: 2, repeatVisitors: 3,
  campaign: { title: '가을 방문', status: 'ACTIVE', isPublic: true, phase: 'LIVE',
    startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-12-31T00:00:00.000Z' },
  readiness: { steps: readinessSteps(), remaining: 3, message: '고객 앱 공개까지 3단계 남았습니다.' },
  ...over,
});

async function overviewMerchant({ overview = () => okJson(overviewData()), feedback = () => okJson({ tags: [], suggestions: [], notes: [] }),
  withFeedback = false, withReversal = true, deferBind = false,
  merchants = [{ id: 'real-merchant', name: '실제 점포', role: 'OWNER' }] } = {}) {
  const fixture = merchantDocument();
  const { nodes, doc } = fixture;
  const ids = ['merchant-overview', 'merchant-overview-picker', 'merchant-overview-merchant', 'merchant-overview-refresh',
    'merchant-overview-status', 'merchant-overview-cards', 'merchant-readiness-message', 'merchant-readiness-list'];
  if (withFeedback) ids.push('merchant-feedback', 'merchant-feedback-status', 'merchant-feedback-tags',
    'merchant-feedback-suggestions', 'merchant-feedback-notes');
  if (withReversal) ids.push('merchant-reversal', 'merchant-reversal-merchant', 'merchant-reversal-refresh', 'merchant-visit-list',
    'merchant-visit-status', 'merchant-redemption-list', 'merchant-redemption-status');
  for (const id of ids) nodes[id] = { ...element(), hidden: true };
  nodes['merchant-overview-merchant'].value = 'real-merchant';
  if (withReversal) nodes['merchant-reversal-merchant'].value = 'real-merchant';
  // 막대 너비는 CSSOM으로만 정한다: style 속성이 아니라 style.setProperty 호출을 기록한다.
  doc.createElement = () => ({ ...element(), style: { props: {}, setProperty(name, value) { this.props[name] = value; } } });
  const calls = [];
  const fetcher = async (path, options) => {
    if (path === '/api/web/merchant/me') return okJson({ merchants });
    if (path === '/api/web/merchant/registration-merchants') return okJson({ merchants: [] });
    calls.push({ path, options });
    if (path.endsWith('/overview')) return overview(path);
    if (path.endsWith('/visitor-feedback')) return feedback(path);
    if (path.endsWith('/recent-visits')) return okJson(recentVisits());
    if (path.endsWith('/recent-coupon-redemptions')) return okJson(recentRedemptions());
    throw new Error(`unexpected ${path}`);
  };
  const bound = bindMerchant(fetcher, doc);
  const overviewCalls = () => calls.filter((call) => call.path.endsWith('/overview'));
  const feedbackCalls = () => calls.filter((call) => call.path.endsWith('/visitor-feedback'));
  const cards = () => nodes['merchant-overview-cards'].children;
  const cardOf = (label) => cards().find((card) => first(card, 'overview-card-label')?.textContent === label);
  const api = { ...fixture, calls, overviewCalls, feedbackCalls, cards, cardOf, bound,
    status: () => nodes['merchant-overview-status'].textContent,
    steps: () => nodes['merchant-readiness-list'].children,
    message: () => nodes['merchant-readiness-message'].textContent };
  if (!deferBind) await bound;
  return api;
}

test('가게 현황 글자 도우미는 비교 부호·캠페인·체크리스트 상태·요일·막대 너비를 한국어로 정한다', () => {
  assert.equal(overviewComparisonText({ lastWeekSameSpan: 2, delta: 3 }), '지난주 대비 +3건');
  assert.equal(overviewComparisonText({ lastWeekSameSpan: 9, delta: -7 }), '지난주 대비 −7건');
  assert.equal(overviewComparisonText({ lastWeekSameSpan: 4, delta: 0 }), '지난주 대비 변화 없음');
  assert.equal(overviewComparisonText(null), null);
  assert.deepEqual(['DONE', 'NEEDS_SETUP', 'CHECK', 'WAITING_APPROVAL', 'SCHEDULED'].map(readinessStateLabel),
    ['완료', '설정 필요', '확인 필요', '승인 대기', '공개 예정']);
  assert.deepEqual(['LIVE', 'SCHEDULED', 'NOT_PUBLIC', 'EXPIRED', 'DRAFT', 'PAUSED', 'ENDED'].map(campaignPhaseLabel),
    ['진행 중', '시작 전', '고객에게 비공개', '기간 종료', '초안', '일시정지', '종료']);
  assert.equal(dayLabel('2026-10-07'), '10/7(수)');
  assert.equal(dayLabel('2026-10-04'), '10/4(일)');
  assert.equal(dayLabel('2026-10-05'), '10/5(월)');
  assert.equal(dayLabel('2026-12-31'), '12/31(목)');
  assert.equal(barWidthPercent(0, 0), 0);
  assert.equal(barWidthPercent(0, 5), 0);
  assert.equal(barWidthPercent(5, 5), 100);
  assert.equal(barWidthPercent(1, 3), 33);
  assert.equal(barWidthPercent(1, 200), 1); // 0이 아니면 막대가 보이도록 최소 1%
});

test('가게 현황은 구역이 열리면 첫 점포의 현황을 한 번 읽고 요약 카드를 글자로 그린다', async () => {
  const fixture = await overviewMerchant();
  const { nodes } = fixture;
  assert.equal(nodes['merchant-overview'].hidden, false);
  assert.equal(nodes['merchant-overview-merchant'].children.length, 1);
  assert.deepEqual(fixture.overviewCalls().map((call) => [call.path, call.options.method]), [[overviewPath, 'GET']]);
  assert.equal(fixture.overviewCalls()[0].options.credentials, 'same-origin');
  assert.equal(fixture.overviewCalls()[0].options.cache, 'no-store');
  assert.deepEqual(fixture.cards().map((card) => first(card, 'overview-card-label').textContent),
    ['오늘 방문', '이번 주 방문', '최근 7일', '누적 방문', '이번 주 쿠폰 사용', '재방문 고객(2일 이상)', '캠페인 상태', '고객 앱 공개', '이번 주 처음 확인된 방문 / 다시 확인된 방문', '이번 주 받은 수집품(등급별)', '쿠폰 발급·사용(이번 주)', '가게 상세 조회(이번 주)']);
  const value = (label) => first(fixture.cardOf(label), 'overview-card-value').textContent;
  assert.equal(value('오늘 방문'), '2건');
  assert.equal(value('이번 주 방문'), '4건');
  assert.equal(value('누적 방문'), '9건');
  assert.equal(value('이번 주 쿠폰 사용'), '2장');
  assert.equal(value('재방문 고객(2일 이상)'), '3명');
  assert.equal(value('캠페인 상태'), '진행 중');
  assert.equal(value('고객 앱 공개'), '운영팀 승인 대기');
  assert.match(textOf(fixture.cardOf('재방문 고객(2일 이상)')), /서로 다른 날 2번 이상/);
  assert.match(fixture.status(), /10월 7일\(수\) 기준/);
  // 점포가 하나뿐이면 점포 고르기는 숨긴다.
  assert.equal(nodes['merchant-overview-picker'].hidden, true);
});

test('가게 현황 최근 7일은 읽을 수 있는 글자 목록이고 막대 너비는 style 속성 없이 CSSOM으로만 정한다', async () => {
  const fixture = await overviewMerchant();
  const week = fixture.cardOf('최근 7일');
  const days = findAll(week, 'overview-days')[0].children;
  assert.equal(days.length, 7);
  assert.deepEqual(days.map((day) => `${first(day, 'overview-day').textContent} ${first(day, 'overview-day-count').textContent}`), [
    '10/1(목) 0건', '10/2(금) 0건', '10/3(토) 0건', '10/4(일) 2건', '10/5(월) 1건', '10/6(화) 1건', '10/7(수) 2건',
  ]);
  const fills = days.map((day) => first(day, 'overview-bar-fill'));
  assert.deepEqual(fills.map((fill) => fill.style.props.width), ['0%', '0%', '0%', '100%', '50%', '50%', '100%']);
  for (const fill of fills) assert.equal(fill.attributes.style, undefined);
  for (const day of days) assert.equal(first(day, 'overview-bar').getAttribute('aria-hidden'), 'true');
  // 어떤 노드에도 style 속성을 쓰지 않는다(CSP style-src 'self').
  const walk = (node) => [node, ...(node.children ?? []).flatMap(walk)];
  assert.equal(walk(fixture.nodes['merchant-overview-cards']).some((node) => node.attributes?.style !== undefined), false);
});

test('가게 현황 카드 링크는 방문 카드는 오늘 방문 기록, 쿠폰 카드는 최근 쿠폰 사용으로 가고 캠페인 카드는 운영팀 안내만 둔다', async () => {
  const fixture = await overviewMerchant();
  const link = (label) => first(fixture.cardOf(label), 'overview-card-link');
  for (const label of ['오늘 방문', '이번 주 방문', '최근 7일', '누적 방문']) {
    assert.equal(link(label).getAttribute('href'), '#merchant-visit-title', label);
  }
  assert.equal(link('이번 주 쿠폰 사용').getAttribute('href'), '#merchant-redemption-title');
  assert.equal(link('재방문 고객(2일 이상)'), undefined);
  assert.equal(link('고객 앱 공개'), undefined);
  const campaign = fixture.cardOf('캠페인 상태');
  assert.equal(link('캠페인 상태'), undefined);
  assert.match(textOf(campaign), /가을 방문 · 9월 1일부터 12월 31일까지/);
  assert.match(textOf(campaign), /캠페인 변경은 운영팀에 요청해 주세요/);
  // 접근 가능한 이름: 보이는 글자가 화면에서 하나뿐인 링크는 aria-label이 없고, 같은 글자의 링크는 `글자 (카드 이름)`이다.
  // 어느 쪽이든 보이는 글자가 이름 안에 그대로 있고 단어가 겹치지 않으며, 서로 다른 링크의 이름은 모두 다르다.
  const names = {};
  for (const label of ['오늘 방문', '이번 주 방문', '최근 7일', '누적 방문', '이번 주 쿠폰 사용']) {
    const anchor = link(label);
    names[label] = anchor.getAttribute('aria-label') ?? anchor.textContent;
    assert.ok(names[label].startsWith(anchor.textContent), label);
  }
  assert.equal(link('오늘 방문').getAttribute('aria-label'), null);
  assert.equal(link('이번 주 쿠폰 사용').getAttribute('aria-label'), null);
  assert.equal(names['오늘 방문'], '오늘 방문 기록 보기');
  assert.equal(names['이번 주 쿠폰 사용'], '쿠폰 사용 내역 보기');
  assert.equal(names['이번 주 방문'], '방문 기록 보기 (이번 주 방문)');
  assert.equal(names['최근 7일'], '방문 기록 보기 (최근 7일)');
  assert.equal(names['누적 방문'], '방문 기록 보기 (누적 방문)');
  assert.equal(new Set(Object.values(names)).size, 5);
  for (const name of Object.values(names)) assert.doesNotMatch(name, /(\S+) \1/);
  // 7일 막대 목록은 화면 낭독기가 무엇의 목록인지 알도록 이름을 가진다.
  assert.equal(findAll(fixture.cardOf('최근 7일'), 'overview-days')[0].getAttribute('aria-label'), '최근 7일 방문 수');
});

test('가게 현황은 지난주 대비를 비교가 있을 때만 이번 주 방문 카드에 보인다', async () => {
  const noteOf = (fixture) => findAll(fixture.cardOf('이번 주 방문'), 'overview-card-note').map((node) => node.textContent);
  const shown = await overviewMerchant();
  assert.deepEqual(noteOf(shown), ['지난주 대비 +2건', '지난주 같은 시각까지와 비교해요.']);
  const hidden = await overviewMerchant({ overview: () => okJson(overviewData({ comparison: null })) });
  assert.deepEqual(noteOf(hidden), []);
  assert.doesNotMatch(textOf(hidden.cardOf('이번 주 방문')), /지난주/);
  assert.equal(first(hidden.cardOf('이번 주 방문'), 'overview-card-value').textContent, '4건');
  const down = await overviewMerchant({ overview: () => okJson(overviewData({ comparison: { lastWeekSameSpan: 9, delta: -5 } })) });
  assert.equal(noteOf(down)[0], '지난주 대비 −5건');
  const same = await overviewMerchant({ overview: () => okJson(overviewData({ comparison: { lastWeekSameSpan: 4, delta: 0 } })) });
  assert.equal(noteOf(same)[0], '지난주 대비 변화 없음');
});

test('가게 현황 체크리스트는 여섯 단계를 순서 목록으로 상태 글자·안내·남은 단계 문구와 함께 그린다', async () => {
  const fixture = await overviewMerchant();
  assert.equal(fixture.message(), '고객 앱 공개까지 3단계 남았습니다.');
  const steps = fixture.steps();
  assert.equal(steps.length, 6);
  assert.deepEqual(steps.map((step) => first(step, 'readiness-label').textContent),
    ['가게 기본 정보', '메뉴', '점주·직원', '방문 보상', '캠페인', '고객 앱 공개']);
  assert.deepEqual(steps.map((step) => first(step, 'readiness-badge').textContent),
    ['완료', '완료', '완료', '설정 필요', '공개 예정', '승인 대기']);
  // 색만으로 구분하지 않도록 상태 글자 외에 상태별 클래스도 따로 둔다.
  assert.deepEqual(steps.map((step) => classesOf(first(step, 'readiness-badge')).find((name) => name !== 'readiness-badge')),
    ['readiness-done', 'readiness-done', 'readiness-done', 'readiness-needs-setup', 'readiness-scheduled', 'readiness-waiting-approval']);
  assert.equal(first(steps[0], 'readiness-hint'), undefined); // 안내가 빈 단계는 안내 칸을 만들지 않는다
  assert.equal(first(steps[2], 'readiness-hint').textContent, '점주 1명 · 직원 2명');
  // 서버 문구는 글자로만 넣는다: 태그처럼 보여도 그대로 글자다.
  assert.match(first(steps[3], 'readiness-hint').textContent, /^<b>수집품<\/b>을 연결해 주세요\. 쿠폰 혜택은 운영팀이 플랫폼 단위로 설정해요\.$/);
  assert.equal(first(steps[4], 'readiness-hint').textContent, '캠페인 시작일이 아직 되지 않아 고객 목록에는 표시되지 않습니다.');
  assert.equal(first(steps[5], 'readiness-hint').textContent, '운영팀 공개 처리 대기 중이에요.');
  // 쿠폰 오퍼는 단계가 아니다.
  assert.equal(steps.some((step) => /쿠폰/.test(first(step, 'readiness-label').textContent)), false);

  const visible = await overviewMerchant({ overview: () => okJson(overviewData({ readiness: {
    steps: readinessSteps().map((step) => ({ ...step, state: 'DONE', hint: '' })), remaining: 0, message: '고객 앱에 보이고 있어요.' } })) });
  assert.equal(visible.message(), '고객 앱에 보이고 있어요.');
  assert.equal(first(visible.cardOf('고객 앱 공개'), 'overview-card-value').textContent, '고객 앱에 보여요');
  assert.match(textOf(visible.cardOf('고객 앱 공개')), /고객 앱에 보이고 있어요\./);
  assert.ok(visible.steps().every((step) => first(step, 'readiness-badge').textContent === '완료'));
});

test('가게 현황은 캠페인이 없으면 안내를 보이고 캠페인 단계가 확인 필요여도 그대로 그린다', async () => {
  const none = await overviewMerchant({ overview: () => okJson(overviewData({ campaign: null })) });
  assert.equal(first(none.cardOf('캠페인 상태'), 'overview-card-value').textContent, '캠페인 없음');
  assert.match(textOf(none.cardOf('캠페인 상태')), /캠페인 변경은 운영팀에 요청해 주세요/);
  const checking = await overviewMerchant({ overview: () => okJson(overviewData({
    campaign: { title: '여름', status: 'PAUSED', isPublic: false, phase: 'PAUSED',
      startsAt: '2026-06-01T00:00:00.000Z', endsAt: '2026-07-01T00:00:00.000Z' },
    readiness: { steps: readinessSteps().map((step) => (step.key === 'campaign'
      ? { ...step, state: 'CHECK', hint: '캠페인이 일시정지 상태예요. 운영팀에 재개를 요청해 주세요.' } : step)),
    remaining: 3, message: '고객 앱 공개까지 3단계 남았습니다.' } })) });
  assert.equal(first(checking.cardOf('캠페인 상태'), 'overview-card-value').textContent, '일시정지');
  assert.equal(first(checking.steps()[4], 'readiness-badge').textContent, '확인 필요');
});

test('가게 현황은 점포를 바꾸면 이전 현황을 지우고 새 점포 현황을 읽으며 늦은 응답은 그리지 않는다', async () => {
  const otherPath = '/api/web/merchant/merchants/other-merchant/overview';
  let finish;
  const late = new Promise((resolve) => { finish = resolve; });
  const merchants = [{ id: 'real-merchant', name: '실제 점포', role: 'OWNER' }, { id: 'other-merchant', name: '다른 점포', role: 'STAFF' }];
  const fixture = await overviewMerchant({ merchants, deferBind: true,
    overview: (path) => (path === otherPath ? okJson(overviewData({ visits: { today: 7, thisWeek: 7, lastWeek: 0, total: 7,
      last7Days: overviewData().visits.last7Days } })) : late) });
  await new Promise((resolve) => setImmediate(resolve));
  const { nodes } = fixture;
  // 점포가 둘 이상이면 점포 고르기가 보이고, 점포 고르기를 바꾸면 방문 목록 쪽 점포도 같이 바뀐다.
  assert.equal(nodes['merchant-overview-picker'].hidden, false);
  assert.equal(nodes['merchant-overview-merchant'].children.length, 2);
  nodes['merchant-overview-merchant'].value = 'other-merchant';
  await nodes['merchant-overview-merchant'].dispatch('change');
  assert.equal(nodes['merchant-reversal-merchant'].value, 'other-merchant');
  assert.equal(fixture.overviewCalls().some((call) => call.path === otherPath), true);
  assert.equal(fixture.calls.some((call) => call.path === '/api/web/merchant/merchants/other-merchant/recent-visits'), true);
  assert.equal(first(fixture.cardOf('오늘 방문'), 'overview-card-value').textContent, '7건');
  finish(okJson(overviewData()));
  await fixture.bound;
  assert.equal(first(fixture.cardOf('오늘 방문'), 'overview-card-value').textContent, '7건');

  // 방문 목록 쪽 점포 고르기를 바꾸면 현황도 그 점포로 따라간다.
  const before = fixture.overviewCalls().length;
  nodes['merchant-reversal-merchant'].value = 'real-merchant';
  await nodes['merchant-reversal-merchant'].dispatch('change');
  assert.equal(nodes['merchant-overview-merchant'].value, 'real-merchant');
  assert.equal(fixture.overviewCalls().length, before + 1);
  assert.equal(fixture.overviewCalls().at(-1).path, overviewPath);
});

test('가게 현황 새로 고침은 같은 점포를 다시 읽고 실패하면 이전 카드를 지우고 이유를 알린다', async () => {
  let mode = 'ok';
  const fixture = await overviewMerchant({ overview: () => {
    if (mode === 'forbidden') return apiError(403, 'MERCHANT_ACCESS_DENIED');
    if (mode === 'down') return { ok: false, status: 500, json: async () => ({}) };
    if (mode === 'invalid') return okJson({ visits: 'nope' });
    return okJson(overviewData());
  } });
  await fixture.nodes['merchant-overview-refresh'].click();
  assert.equal(fixture.overviewCalls().length, 2);
  assert.equal(fixture.cards().length, 12);
  for (const [next, pattern] of [['forbidden', /권한이 없어요/], ['down', /불러오지 못했어요/], ['invalid', /불러오지 못했어요/]]) {
    mode = 'ok';
    await fixture.nodes['merchant-overview-refresh'].click();
    assert.equal(fixture.cards().length, 12);
    mode = next;
    await fixture.nodes['merchant-overview-refresh'].click();
    assert.equal(fixture.cards().length, 0, next);
    assert.equal(fixture.steps().length, 0, next);
    assert.equal(fixture.message(), '', next);
    assert.match(fixture.status(), pattern, next);
  }
  mode = 'ok';
  await fixture.nodes['merchant-overview-refresh'].click();
  assert.equal(fixture.cards().length, 12);
  assert.equal(fixture.nodes['merchant-overview-refresh'].disabled, false);
});

test('가게 현황은 소속 점포가 없으면 닫힌 채 읽지 않고, 쪽을 떠나거나 로그아웃하면 지운다', async () => {
  const none = await overviewMerchant({ merchants: [] });
  assert.equal(none.nodes['merchant-overview'].hidden, true);
  assert.deepEqual(none.overviewCalls(), []);

  const fixture = await overviewMerchant();
  assert.equal(fixture.cards().length, 12);
  fixture.listeners.get('pagehide')();
  assert.equal(fixture.cards().length, 0);
  assert.equal(fixture.steps().length, 0);
  assert.equal(fixture.message(), '');
  assert.equal(fixture.status(), '');
  const second = await overviewMerchant();
  await second.nodes['merchant-logout'].click();
  assert.equal(second.cards().length, 0);
  assert.equal(second.steps().length, 0);
});

test('가게 현황은 방문 목록 영역이 없는 화면에서도 혼자 동작한다', async () => {
  const fixture = await overviewMerchant({ withReversal: false });
  assert.equal(fixture.cards().length, 12);
  fixture.nodes['merchant-overview-merchant'].value = 'real-merchant';
  await fixture.nodes['merchant-overview-merchant'].dispatch('change');
  assert.equal(fixture.overviewCalls().length, 2);
});

test('방문 고객 의견은 가게 현황의 점포를 따라가며 개수와 최근 의견을 글자 목록으로 표시한다', async () => {
  const fixture = await overviewMerchant({ withFeedback: true, feedback: () => okJson({
    tags: [{ code: 'SOLO', label: '혼밥하기 좋아요', count: 3 }],
    suggestions: [{ code: 'HOURS_INFO', label: '영업시간 안내가 있으면 좋겠어요', count: 2 }],
    notes: [{ customerLabel: '손님 K7QM', date: '2026-10-03', text: '<b>국물이 진해요</b>' }],
  }) });
  const { nodes } = fixture;
  assert.equal(nodes['merchant-feedback'].hidden, false);
  assert.deepEqual(fixture.feedbackCalls().map(call => [call.path, call.options.credentials]),
    [[`${merchantBase}/visitor-feedback`, 'same-origin']]);
  assert.deepEqual(nodes['merchant-feedback-tags'].children.map(row => row.textContent), ['혼밥하기 좋아요 · 3명']);
  assert.deepEqual(nodes['merchant-feedback-suggestions'].children.map(row => row.textContent), ['영업시간 안내가 있으면 좋겠어요 · 2명']);
  assert.deepEqual(nodes['merchant-feedback-notes'].children.map(row => row.textContent), ['손님 K7QM · 10/3 · <b>국물이 진해요</b>']);
  assert.equal(nodes['merchant-feedback-notes'].children[0].children.length, 0);
});

test('방문 고객 의견은 점포 변경과 로그아웃 때 지우며 늦은 응답을 무시한다', async () => {
  let finish;
  const late = new Promise(resolve => { finish = resolve; });
  const fixture = await overviewMerchant({ withFeedback: true, deferBind: true,
    merchants: [{ id: 'real-merchant', name: '실제 점포', role: 'OWNER' }, { id: 'other-merchant', name: '다른 점포', role: 'STAFF' }],
    feedback: path => path.includes('/other-merchant/')
      ? okJson({ tags: [], suggestions: [], notes: [{ customerLabel: '손님 ABCD', date: '2026-10-04', text: '다른 점포 의견' }] }) : late,
  });
  await new Promise(resolve => setImmediate(resolve));
  fixture.nodes['merchant-overview-merchant'].value = 'other-merchant';
  await fixture.nodes['merchant-overview-merchant'].dispatch('change');
  assert.equal(fixture.feedbackCalls().length, 2);
  assert.equal(fixture.nodes['merchant-feedback-notes'].children[0].textContent, '손님 ABCD · 10/4 · 다른 점포 의견');
  finish(okJson({ tags: [{ code: 'SOLO', label: '혼밥하기 좋아요', count: 8 }], suggestions: [], notes: [] }));
  await fixture.bound;
  assert.equal(fixture.nodes['merchant-feedback-tags'].children.length, 0);
  fixture.listeners.get('pagehide')();
  assert.equal(fixture.nodes['merchant-feedback-notes'].children.length, 0);
  assert.equal(fixture.nodes['merchant-feedback-status'].textContent, '');
});

test('방문 고객 의견은 빈 결과를 안내하고 재조회 전의 의견을 로그아웃 때 지운다', async () => {
  let hasNote = false;
  const fixture = await overviewMerchant({ withFeedback: true, feedback: () => okJson({ tags: [], suggestions: [],
    notes: hasNote ? [{ customerLabel: '손님 K7QM', date: '2026-10-03', text: '첫 의견' }] : [] }) });
  assert.equal(fixture.nodes['merchant-feedback-status'].textContent, '아직 받은 의견이 없어요.');
  hasNote = true;
  fixture.nodes['merchant-overview-merchant'].value = 'real-merchant';
  await fixture.nodes['merchant-overview-merchant'].dispatch('change');
  assert.equal(fixture.nodes['merchant-feedback-notes'].children.length, 1);
  hasNote = false;
  await fixture.nodes['merchant-logout'].click();
  assert.equal(fixture.nodes['merchant-feedback-notes'].children.length, 0);
  assert.equal(fixture.nodes['merchant-feedback-status'].textContent, '');
});

test('점포 웹 가게 현황 화면은 점포 운영 화면 맨 위에 있고 HTML 문자열·인라인 스타일 없이 접근성 연결을 갖춘다', () => {
  const merchantHtml = readFileSync(join(web, 'merchant.html'), 'utf8');
  const merchantScript = readFileSync(join(web, 'assets/merchant.mjs'), 'utf8');
  assert.match(merchantHtml, /<nav id="merchant-owner-nav" class="merchant-view-nav" aria-label="점주 방문 보상 화면" hidden>/);
  assert.match(merchantHtml, /data-merchant-view-target="create"[^>]*>방문 보상 만들기<\/button>/);
  assert.match(merchantHtml, /data-merchant-view-target="claim"[^>]*>방문 확인<\/button>/);
  assert.match(merchantHtml, /data-merchant-view-target="results"[^>]*>운영 결과<\/button>/);
  assert.match(merchantHtml, /<section id="merchant-overview" class="panel[^"]*" data-merchant-view="results" aria-labelledby="merchant-overview-title" hidden>/);
  assert.match(merchantHtml, /<h2 id="merchant-overview-title">가게 현황<\/h2>/);
  assert.match(merchantHtml, /id="merchant-overview-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(merchantHtml, /<h3 id="merchant-readiness-title">오픈 준비 체크리스트<\/h3>/);
  assert.match(merchantHtml, /<ol id="merchant-readiness-list"[^>]*aria-labelledby="merchant-readiness-title"/);
  assert.match(merchantHtml, /<ul id="merchant-overview-cards"/);
  assert.match(merchantHtml, /<h2 id="merchant-operations-title">직원·방문 자료<\/h2>/);
  assert.match(merchantHtml, /방문 보상은 플랫폼의 1·3·5회 기준으로 고정됩니다/);
  assert.doesNotMatch(merchantHtml, /merchant-extension|캠페인 연장|연장 기간|기간 연장 확정/);
  assert.match(merchantHtml, /<section id="merchant-feedback"[^>]*aria-labelledby="merchant-feedback-title" hidden>/);
  assert.match(merchantHtml, /<h2 id="merchant-feedback-title">방문 고객 의견<\/h2>/);
  assert.match(merchantHtml, /<ul id="merchant-feedback-notes"[^>]*aria-labelledby="merchant-feedback-notes-title"/);
  assert.ok(merchantHtml.indexOf('<section id="merchant-feedback"') > merchantHtml.indexOf('<section id="merchant-overview"'));
  assert.ok(merchantHtml.indexOf('<section id="merchant-feedback"') < merchantHtml.indexOf('<section id="merchant-creator"'));
  // #merchant-content 안에서 탭 내비게이션 바로 다음 구역이다(제작기·내 점포·직원 등록보다 앞).
  const content = merchantHtml.indexOf('<section id="merchant-content"');
  const overviewAt = merchantHtml.indexOf('<section id="merchant-overview"');
  assert.ok(content > 0 && overviewAt > content);
  for (const later of ['id="merchant-creator"', 'aria-labelledby="merchant-stores-title"', 'id="merchant-reversal"']) {
    assert.ok(merchantHtml.indexOf(later) > overviewAt, later);
  }
  assert.match(merchantHtml.slice(content, overviewAt), /<nav id="merchant-owner-nav"[\s\S]*data-merchant-view-target="results"[\s\S]*<\/nav>\s*$/);
  // 카드 링크가 가리키는 제목은 키보드 이동이 되도록 tabindex -1을 가진다.
  assert.match(merchantHtml, /<h3 id="merchant-visit-title" tabindex="-1">/);
  assert.match(merchantHtml, /<h3 id="merchant-redemption-title" tabindex="-1">/);
  assert.doesNotMatch(merchantHtml + merchantScript, /innerHTML|outerHTML|insertAdjacentHTML/);
  assert.doesNotMatch(merchantHtml, /\sstyle=/);
  assert.doesNotMatch(merchantScript, /setAttribute\(\s*['"]style['"]/);
  assert.match(merchantScript, /style\.setProperty\('width'/);
  assert.match(css, /\.overview-cards \{/);
  assert.match(css, /\.readiness-list \{/);
  for (const state of ['done', 'needs-setup', 'check', 'waiting-approval', 'scheduled']) {
    assert.match(css, new RegExp(`\\.readiness-${state} \\{`), state);
  }
  assert.match(css, /\.overview-card-link \{[^}]*min-height: 44px/);
  const emptyStatus = css.match(/#merchant-overview-status:empty \{[^}]*\}/)?.[0];
  assert.ok(emptyStatus, 'a visually hidden rule for the empty overview status');
  assert.doesNotMatch(emptyStatus, /display: none/);
  assert.match(emptyStatus, /clip-path: inset\(50%\)/);
});

test('비어 있는 상태 안내 영역은 display none으로 지우지 않고 화면에서만 감춘다', () => {
  assert.doesNotMatch(css, /\.admin-coupons > p:empty \{ display: none/);
  const rule = css.match(/\.admin-coupons > p:empty, #merchant-visit-status:empty, #merchant-redemption-status:empty, \.readiness-copy-status:empty \{[^}]*\}/)?.[0];
  assert.ok(rule, 'a visually hidden rule for the empty status regions');
  assert.doesNotMatch(css, /\.readiness-copy-status:empty\s*\{\s*display:\s*none/);
  assert.doesNotMatch(rule, /display: none/);
  assert.match(rule, /position: absolute/);
  assert.match(rule, /clip-path: inset\(50%\)/);
});

test('운영 웹 도감은 무효 쿠폰을 사용할 수 없는 쿠폰으로 표시하고 도장을 찍지 않는다', async () => {
  const { nodes, doc } = collectionFixture();
  const rewards = badgesFixture().rewards;
  const voided = [{ ...rewards[0], coupon: { ...rewards[0].coupon, status: 'VOIDED', detail: '숨겨야 할 안내' } }, rewards[1], rewards[2]];
  await loadCollection(collectionAndBadges({ badges: () => okJson(badgesFixture({ rewards: voided })) }).fetcher, doc);
  const [ticket] = nodes['coupon-list'].children;
  assert.equal(ticket.className, 'ticket ticket-voided');
  assert.equal(first(ticket, 'ticket-chip').textContent, '사용할 수 없는 쿠폰');
  assert.equal(findAll(ticket, 'ticket-stamp').length, 0);
  assert.equal(findAll(ticket, 'ticket-detail').length, 0);
  // 무효 쿠폰에는 "~까지" 만료 날짜가 오해를 부르므로 보이지 않는다.
  assert.equal(findAll(ticket, 'ticket-expiry').length, 0);
  assert.match(css, /\.ticket-voided \.ticket-chip/);
});

// ---------------------------------------------------------------------------------------------------------------------
// 웹 첫 로그인 동의 (Issue #253, D-059)
// ---------------------------------------------------------------------------------------------------------------------

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
    if (url === '/api/web/badges') return okJson(badgesFixture());
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

test('웹 동의: 서버가 동의 필요라고 하면 도감을 읽기 전에 동의 화면을 보이고 로그아웃 길을 둔다', async () => {
  const { nodes, doc } = consentDocument();
  const { fetcher, calls } = consentServer();
  await productionWeb.loadCollection(fetcher, doc);
  assert.equal(nodes['consent-panel'].hidden, false);
  assert.match(nodes['collection-status'].textContent, /이용을 시작하기 전에/);
  assert.equal(nodes['consent-submit'].disabled, true);
  assert.equal(nodes['collection-logout'].hidden, false);
  assert.equal(nodes['collection-login'].hidden, true);
  assert.equal(nodes['collection-content'].hidden, true);
  // 동의 전에는 방문 기록·수집품·메달을 요청하지 않는다.
  assert.deepEqual(dataCalls(calls), []);
  assert.deepEqual(calls.map((call) => call.url), ['/api/web/consent']);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.credentials, 'same-origin');
});

test('웹 동의: 세 필수 항목을 모두 눌러야 버튼이 켜지고, 기록하면 도감을 읽는다', async () => {
  const { nodes, doc } = consentDocument();
  const { fetcher, calls } = consentServer();
  await productionWeb.bindCollectionControls(fetcher, doc);
  assert.equal(nodes['consent-submit'].disabled, true);

  for (const missing of ['consent-age', 'consent-terms', 'consent-privacy']) {
    for (const name of ['consent-age', 'consent-terms', 'consent-privacy']) nodes[name].checked = name !== missing;
    await nodes[missing].dispatch('change');
    assert.equal(nodes['consent-submit'].disabled, true, `${missing} 없이는 시작할 수 없다`);
  }
  await nodes['consent-submit'].click();
  assert.equal(calls.some((call) => call.method === 'POST'), false, '체크가 모자라면 서버에 보내지 않는다');

  await checkAll(nodes);
  assert.equal(nodes['consent-submit'].disabled, false);
  await nodes['consent-submit'].click();

  const post = calls.find((call) => call.method === 'POST');
  assert.equal(post.url, '/api/web/consent');
  assert.deepEqual(JSON.parse(post.options.body), consentBodySent);
  assert.equal(post.options.credentials, 'same-origin');
  assert.equal(post.options.headers['Content-Type'], 'application/json');
  // 기록되면 화면이 닫히고 그때부터 도감을 읽는다.
  assert.equal(nodes['consent-panel'].hidden, true);
  assert.deepEqual(dataCalls(calls).map((call) => call.url).sort(), ['/api/web/badges', '/api/web/collection']);
  assert.equal(nodes['collection-content'].hidden, false);
});

test('웹 동의: 약관 링크를 새 탭에서 읽고 돌아와도 눌러 둔 체크가 남고, 서버 답이 바뀌면 화면이 닫힌다', async () => {
  const { nodes, doc } = consentDocument();
  const { fetcher, calls, state } = consentServer();
  await productionWeb.bindCollectionControls(fetcher, doc);
  nodes['consent-age'].checked = true;
  nodes['consent-terms'].checked = true;
  await nodes['consent-terms'].dispatch('change');
  assert.equal(nodes['consent-panel'].hidden, false);

  // 탭이 가려졌다 다시 보이면 동의 여부를 다시 읽지만 화면과 체크는 그대로다.
  doc.hidden = true;
  await doc.dispatch('visibilitychange');
  assert.equal(nodes['consent-panel'].hidden, false, '가려진 사이에도 동의 화면은 개인 기록이 없어 남는다');
  doc.hidden = false;
  await doc.dispatch('visibilitychange');
  assert.equal(nodes['consent-panel'].hidden, false);
  assert.equal(nodes['consent-age'].checked, true);
  assert.equal(nodes['consent-terms'].checked, true);
  assert.equal(nodes['consent-privacy'].checked, false);
  assert.equal(nodes['consent-submit'].disabled, true, '셋 중 하나가 빠졌으니 아직 시작할 수 없다');
  assert.deepEqual(dataCalls(calls), []);

  // 다른 탭에서 이미 동의했다면 돌아왔을 때 화면이 닫히고 도감이 열린다.
  state.status = { ok: true, status: 200, body: consentAccepted };
  doc.hidden = true;
  await doc.dispatch('visibilitychange');
  doc.hidden = false;
  await doc.dispatch('visibilitychange');
  assert.equal(nodes['consent-panel'].hidden, true);
  assert.equal(nodes['collection-content'].hidden, false);
});

test('웹 동의: 이미 동의한 계정은 동의 화면 없이 바로 도감을 본다', async () => {
  const { nodes, doc } = consentDocument();
  const { fetcher, calls } = consentServer({ status: { ok: true, status: 200, body: consentAccepted } });
  await productionWeb.loadCollection(fetcher, doc);
  assert.equal(nodes['consent-panel'].hidden, true);
  assert.equal(nodes['collection-content'].hidden, false);
  assert.equal(calls[0].url, '/api/web/consent');
});

test('웹 동의: 로그인하지 않았으면 로그인을 안내하고, 확인하지 못하면 막힌 채로 두지 않고 다시 시도를 보인다', async () => {
  for (const [status, expectLogin] of [
    [{ ok: false, status: 401, body: { code: 'WEB_SESSION_INVALID' } }, true],
    [{ ok: false, status: 500, body: {} }, false],
    [{ ok: false, status: 404, body: {} }, false],
    [{ throws: true }, false],
    [{ ok: true, status: 200, body: { required: 'yes', termsVersion: 'x', privacyVersion: 'y' } }, false],
    [{ ok: true, status: 200, body: { required: true } }, false],
    [{ ok: true, status: 200, body: null }, false],
  ]) {
    const { nodes, doc } = consentDocument();
    const { fetcher, calls } = consentServer({ status });
    await productionWeb.loadCollection(fetcher, doc);
    assert.equal(nodes['collection-login'].hidden, !expectLogin, JSON.stringify(status));
    assert.equal(nodes['collection-retry'].hidden, expectLogin, JSON.stringify(status));
    assert.equal(nodes['consent-panel'].hidden, true);
    assert.equal(nodes['collection-content'].hidden, true);
    assert.deepEqual(dataCalls(calls), [], '동의를 알 수 없으면 도감을 읽지 않는다');
  }
});

test('웹 동의: 서버가 이 화면에 없는 버전을 요구하면 옛 문구에 동의를 받지 않고 새로 열도록 안내한다', async () => {
  for (const body of [
    { ...consentRequired, termsVersion: 'terms-2027-01-01' },
    { ...consentRequired, privacyVersion: 'privacy-2027-01-01' },
  ]) {
    const { nodes, doc } = consentDocument();
    const { fetcher, calls } = consentServer({ status: { ok: true, status: 200, body } });
    await productionWeb.loadCollection(fetcher, doc);
    assert.equal(nodes['consent-panel'].hidden, true);
    assert.match(nodes['collection-status'].textContent, /새로 바뀌었어요/);
    assert.equal(nodes['collection-retry'].hidden, false);
    assert.equal(nodes['collection-logout'].hidden, false);
    assert.deepEqual(dataCalls(calls), []);
  }
});

test('웹 동의: 기록이 거절되거나 실패하면 화면과 체크를 그대로 두고 이유를 알린다', async () => {
  for (const [post, pattern] of [
    [{ ok: false, status: 409, body: { code: 'CONSENT_VERSION_MISMATCH' } }, /새로 바뀌었어요/],
    [{ ok: false, status: 400, body: { code: 'CONSENT_INCOMPLETE' } }, /기록하지 못했어요/],
    [{ ok: false, status: 500, body: {} }, /기록하지 못했어요/],
    [{ ok: true, status: 200, body: { required: true, termsVersion: 'terms-2026-10-06', privacyVersion: 'privacy-2026-10-07' } }, /기록하지 못했어요/],
    [{ ok: true, status: 200, body: null }, /기록하지 못했어요/],
  ]) {
    const { nodes, doc } = consentDocument();
    const { fetcher, calls } = consentServer({ post });
    await productionWeb.bindCollectionControls(fetcher, doc);
    await checkAll(nodes);
    await nodes['consent-submit'].click();
    assert.match(nodes['consent-message'].textContent, pattern, JSON.stringify(post));
    assert.equal(nodes['consent-panel'].hidden, false);
    assert.equal(nodes['consent-submit'].disabled, false, '체크가 남아 있으면 다시 누를 수 있다');
    assert.deepEqual(dataCalls(calls), [], '동의가 기록되지 않으면 도감을 읽지 않는다');
  }
  // 네트워크 오류도 같다.
  const offline = consentDocument();
  const online = consentServer();
  const failing = async (url, options) => {
    if (options?.method === 'POST') throw new Error('offline');
    return online.fetcher(url, options);
  };
  await productionWeb.bindCollectionControls(failing, offline.doc);
  await checkAll(offline.nodes);
  await offline.nodes['consent-submit'].click();
  assert.match(offline.nodes['consent-message'].textContent, /기록하지 못했어요/);
  assert.equal(offline.nodes['consent-panel'].hidden, false);
  assert.equal(offline.nodes['consent-submit'].disabled, false);
  assert.deepEqual(dataCalls(online.calls), []);
});

test('웹 동의: 로그인이 끝난 상태에서 기록하면 다시 로그인을 안내하고, 연달아 눌러도 한 번만 보낸다', async () => {
  const { nodes, doc } = consentDocument();
  const { fetcher, calls, state } = consentServer({ post: { ok: false, status: 401, body: { code: 'WEB_SESSION_INVALID' } } });
  await productionWeb.bindCollectionControls(fetcher, doc);
  await checkAll(nodes);
  state.status = { ok: false, status: 401, body: { code: 'WEB_SESSION_INVALID' } };
  await nodes['consent-submit'].click();
  assert.equal(nodes['collection-login'].hidden, false);
  assert.equal(nodes['consent-panel'].hidden, true);

  const second = consentDocument();
  const held = consentServer();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const slow = async (url, options) => {
    if (options?.method === 'POST') await gate;
    return held.fetcher(url, options);
  };
  await productionWeb.bindCollectionControls(slow, second.doc);
  await checkAll(second.nodes);
  const first = second.nodes['consent-submit'].click();
  const again = second.nodes['consent-submit'].click();
  release();
  await Promise.all([first, again]);
  assert.equal(held.calls.filter((call) => call.method === 'POST').length, 1);
  assert.equal(calls.filter((call) => call.method === 'POST').length, 1);
});

test('웹 동의: 화면은 폼 없이 필수 세 개·안내 네 가지·약관 링크를 접근 가능한 마크업으로 갖는다', () => {
  assert.doesNotMatch(html, /<form\b/);
  const panel = html.slice(html.indexOf('<section id="consent-panel"'), html.indexOf('<div id="collection-content"'));
  assert.match(panel, /aria-labelledby="consent-title"[^>]* hidden>/);
  // 체크박스는 라벨 안에 있어 글자를 눌러도 켜지고, 스크린리더가 이름을 읽는다.
  const labels = [...panel.matchAll(/<label class="consent-check"><input type="checkbox" id="(consent-[a-z]+)"><span>([^<]+)<\/span><\/label>/g)];
  assert.deepEqual(labels.map((m) => [m[1], m[2]]), [
    ['consent-age', '[필수] 만 14세 이상입니다.'],
    ['consent-terms', '[필수] 이용약관에 동의합니다.'],
    ['consent-privacy', '[필수] 개인정보 수집·이용에 동의합니다.'],
  ]);
  assert.equal((panel.match(/<input type="checkbox"/g) ?? []).length, 3);
  assert.doesNotMatch(panel, /\[선택\]|마케팅|광고/);
  assert.match(panel, /선택 동의는 없어요/);
  // 새 탭으로 열리는 링크는 이름에 그 사실을 넣어 스크린리더가 알린다.
  assert.match(panel, /href="\/terms" target="_blank" rel="noopener">이용약관 보기 \(새 탭\)</);
  assert.match(panel, /href="\/privacy" target="_blank" rel="noopener">개인정보 처리방침 보기 \(새 탭\)</);
  // 꺼진 버튼은 왜 꺼졌는지 보이는 안내(consent-hint)를 가리킨다. 머리글과 본문은 프로그램으로 초점을 받을 수 있다.
  assert.match(panel, /<p id="consent-hint" class="consent-hint">세 가지를 모두 선택하면 눌러 시작할 수 있어요\.<\/p>/);
  assert.match(panel, /<button id="consent-submit" class="consent-submit" type="button" disabled aria-describedby="consent-hint consent-message">동의하고 시작<\/button>/);
  assert.match(panel, /<h3 id="consent-title" tabindex="-1">/);
  assert.match(html, /<main id="main" tabindex="-1">/);
  // 안내 줄은 비어 있어도 접근성 트리에 남는다(display:none으로 빼지 않는다).
  assert.doesNotMatch(css, /\.consent-message:empty \{[^}]*display: none/);
  assert.match(panel, /<p id="consent-message" class="consent-message" role="status" aria-live="polite"><\/p>/);
  assert.match(css, /\.consent-check \{[^}]*min-height: 48px/);
  assert.match(css, /\.consent-link \{[^}]*min-height: 48px/);
  // 푸터의 세 링크
  const footer = html.slice(html.indexOf('<footer'));
  for (const target of ['/terms', '/privacy', '/account-deletion']) assert.match(footer, new RegExp(`href="${target}"`), target);
  // CSP는 그대로다: 스크립트·스타일은 같은 출처뿐이고 폼 전송은 없다.
  assert.match(html, /form-action 'none'/);
  assert.doesNotMatch(html, /unsafe-inline|unsafe-eval/);
});

test('웹 동의: 안내 네 가지와 버전이 앱·서버·공개 페이지와 같다', () => {
  const mobileCopy = readFileSync(join(repo, 'apps/mobile/src/privacy/consent-copy.ts'), 'utf8');
  const mobileNotice = [...mobileCopy.matchAll(/title: '([^']+)',\s*body:\s*'([^']+)'/g)].map((m) => [m[1], m[2]]);
  assert.equal(mobileNotice.length, 4);
  const webNotice = [...html.matchAll(/<div><dt>([^<]+)<\/dt><dd>([^<]+)<\/dd><\/div>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(webNotice, mobileNotice, '앱과 웹의 개인정보 수집·이용 안내 문구가 같아야 한다');
  const apiConsent = readFileSync(join(repo, 'apps/api/src/account-consent.ts'), 'utf8');
  const serverTerms = apiConsent.match(/CURRENT_TERMS_VERSION = '([^']+)'/)?.[1];
  const serverPrivacy = apiConsent.match(/CURRENT_PRIVACY_VERSION = '([^']+)'/)?.[1];
  assert.equal(script.match(/CONSENT_TERMS_VERSION = '([^']+)'/)?.[1], serverTerms);
  assert.equal(script.match(/CONSENT_PRIVACY_VERSION = '([^']+)'/)?.[1], serverPrivacy);
  assert.ok(readFileSync(join(repo, 'docs/terms.html'), 'utf8').includes(serverTerms));
});

test('웹 동의: 꺼진 버튼은 보이는 안내를 갖고 세 항목을 모두 누르면 안내가 사라진다', async () => {
  const { nodes, doc } = consentDocument();
  const { fetcher } = consentServer();
  await productionWeb.bindCollectionControls(fetcher, doc);
  assert.equal(nodes['consent-hint'].hidden, false, '처음에는 왜 시작할 수 없는지 보인다');
  nodes['consent-age'].checked = true;
  await nodes['consent-age'].dispatch('change');
  assert.equal(nodes['consent-hint'].hidden, false);
  await checkAll(nodes);
  assert.equal(nodes['consent-submit'].disabled, false);
  assert.equal(nodes['consent-hint'].hidden, true);
  nodes['consent-terms'].checked = false;
  await nodes['consent-terms'].dispatch('change');
  assert.equal(nodes['consent-hint'].hidden, false, '하나를 풀면 다시 보인다');
});

test('웹 동의: 화면이 나타나면 초점이 머리글로, 동의해서 사라지면 본문으로 옮겨진다', async () => {
  const { nodes, doc, focusOrder } = consentDocument();
  const { fetcher } = consentServer();
  await productionWeb.bindCollectionControls(fetcher, doc);
  assert.deepEqual(focusOrder, ['consent-title']);
  // 이미 보이는 화면을 다시 확인해도(탭이 다시 보임) 초점을 또 빼앗지 않는다.
  doc.hidden = true;
  await doc.dispatch('visibilitychange');
  doc.hidden = false;
  await doc.dispatch('visibilitychange');
  assert.deepEqual(focusOrder, ['consent-title']);
  await checkAll(nodes);
  await nodes['consent-submit'].click();
  assert.deepEqual(focusOrder, ['consent-title', 'main']);
  assert.equal(nodes['consent-panel'].hidden, true);
});

test('웹 동의: 다른 탭의 로그인·로그아웃 알림은 눌러 둔 체크를 지우지만 탭이 가려졌다 보이는 것은 지우지 않는다', async () => {
  class FakeChannel {
    constructor(name) { this.name = name; FakeChannel.last = this; }
    postMessage() {}
  }
  const { nodes, doc } = consentDocument();
  doc.defaultView = { BroadcastChannel: FakeChannel, addEventListener() {} };
  const { fetcher } = consentServer();
  await productionWeb.bindCollectionControls(fetcher, doc);
  assert.equal(FakeChannel.last.name, 'masscom-web-session');
  nodes['consent-age'].checked = true;
  nodes['consent-terms'].checked = true;
  await nodes['consent-terms'].dispatch('change');
  doc.hidden = true;
  await doc.dispatch('visibilitychange');
  doc.hidden = false;
  await doc.dispatch('visibilitychange');
  assert.equal(nodes['consent-age'].checked, true, '가려졌다 다시 보인 것만으로는 체크를 지우지 않는다');
  assert.equal(nodes['consent-terms'].checked, true);

  // 다른 탭이 로그인·로그아웃을 알렸다: 계정이 바뀌었을 수 있어 체크는 지워진다(동의 화면은 서버 답에 따라 그대로 남는다).
  await FakeChannel.last.onmessage({ data: 'refresh' });
  assert.equal(nodes['consent-age'].checked, false);
  assert.equal(nodes['consent-terms'].checked, false);
  assert.equal(nodes['consent-submit'].disabled, true);
  assert.equal(nodes['consent-panel'].hidden, false);
  // 다른 알림 이름은 무시한다.
  nodes['consent-age'].checked = true;
  await FakeChannel.last.onmessage({ data: 'other' });
  assert.equal(nodes['consent-age'].checked, true);
});
