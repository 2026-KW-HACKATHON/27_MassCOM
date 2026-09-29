import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';

import { bindCollectionControls, loadCollection, loadMerchants } from '../../apps/production-web/assets/production.mjs';
import { bindAdmin, campaignDraftPayload, formatKst, loadAdmin, parseMenuLines } from '../../apps/production-web/assets/admin.mjs';
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
    'merchant-content', 'merchant-memberships', 'merchant-code', 'merchant-registration',
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
  assert.ok(css.trimStart().startsWith(':root {\n  color-scheme: light dark;'));
  for (const token of ['--mc-bg: #FFFFFF', '--mc-primary: #2456D6', '--mc-sky-1: #BFE3FF', '--mc-bronze-edge: #8A5226',
    '--mc-gold-container: #FBEFC4', '--mc-stamp-ink: #A3401F', '--mc-radius-card: 20px', '--mc-radius-control: 14px',
    '--mc-page: min(72rem, calc(100vw - 40px))']) assert.ok(css.includes(token), token);
  const dark = /@media \(prefers-color-scheme: dark\) \{\s*:root \{([^}]+)\}/.exec(css)?.[1] ?? '';
  for (const token of ['--mc-bg: #14171D', '--mc-primary: #9BB8FF', '--mc-sky-1: #1D3A63', '--mc-stamp-ink: #FFB09A',
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

test('세 화면 CSP는 같은 출처 이미지만 더하고 나머지 지시문은 그대로다', () => {
  const base = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; ";
  const tail = "base-uri 'none'; form-action 'none'";
  assert.equal(cspOf(pageSources.app), `${base}img-src 'self'; ${tail}`);
  assert.equal(cspOf(pageSources.admin), `${base}img-src 'self'; ${tail}`);
  assert.equal(cspOf(pageSources.merchant), `${base}img-src 'self' data:; ${tail}`);
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
  canProcess: true, overdue: false, accountLabel: 'acct_1a2b…9f0e', processedAt: null, processedBy: null,
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

test('삭제 처리와 거절의 서버 거절 사유는 운영자가 이해할 문장으로 알린다', async () => {
  const cases = [
    ['DELETION_COOLING_OFF', /취소 기간/], ['DELETION_SELF_PROCESSING_REFUSED', /본인 요청은 처리할 수 없습니다/],
    ['DELETION_INTAKE_NOT_PENDING', /이미 처리/], ['DELETION_REJECT_REASON_INVALID', /1자 이상 200자/],
  ];
  for (const [code, expected] of cases) {
    const failing = () => ({ ok: false, status: 409, json: async () => ({ code }) });
    const { nodes, doc, fetcher } = deletionAdminFixture([pendingIntake], {
      [`POST /api/web/admin/account-deletion-intakes/${pendingIntake.id}/process`]: failing,
      [`POST /api/web/admin/account-deletion-intakes/${pendingIntake.id}/reject`]: failing,
    });
    await loadAdmin(fetcher, doc);
    const [process, reason, reject] = nodes['admin-deletions'].children[0].children.slice(2);
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
  const [, reason, reject] = nodes['admin-deletions'].children[0].children.slice(2);
  assert.equal(reason.attributes['aria-label'], '거절 사유');
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
