// Issue #246: 관리자 웹의 점포 공개·점주 올리기·보상 혜택·캠페인 공개와 고객 웹의 "발행 준비 중"을 가짜 DOM으로 확인한다.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  documentReferenceProblem, goLiveMessage, loadAdmin, missingForPublish, rewardOfferPayload,
} from '../../apps/production-web/assets/admin.mjs';
import { loadCollection, nftLineLabel } from '../../apps/production-web/assets/production.mjs';

function element() {
  const listeners = new Map();
  return {
    textContent: '', children: [], className: '', attributes: {}, value: '',
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    append(...children) { this.children.push(...children); },
    replaceChildren() { this.children = []; },
    addEventListener(type, callback) { listeners.set(type, callback); },
    async click() { return listeners.get('click')?.(); },
    async submit() { return listeners.get('submit')?.({ preventDefault() {}, currentTarget: this }); },
  };
}

const okJson = (value) => ({ ok: true, json: async () => value });
const refused = (status, code) => ({ ok: false, status, json: async () => ({ code }) });
const readyMerchant = { id: 'real-1', name: '월계 김밥', story: '', roadAddress: '서울 노원구 월계로 1', minimumSpendWon: 0,
  menuItems: [{ name: '김밥', priceWon: 4500 }], businessHours: '매일 10:00–20:00', status: 'PAUSED', demo: false,
  version: 4, consentDocumentRef: null, publishedAt: null };

function adminPage({ merchants = [readyMerchant], routes = {} } = {}) {
  const ids = ['admin-status', 'admin-login', 'admin-content', 'admin-merchants', 'admin-create', 'admin-logout',
    'admin-offer-form', 'admin-offers', 'admin-campaign-draft', 'admin-campaign-drafts', 'admin-campaigns'];
  const nodes = Object.fromEntries(ids.map((id) => [id, { ...element(), hidden: true }]));
  const offerSelect = element();
  const draftSelect = element();
  nodes['admin-offer-form'].querySelector = () => offerSelect;
  nodes['admin-campaign-draft'].querySelector = () => draftSelect;
  const calls = [];
  const doc = { getElementById(id) { return nodes[id]; }, createElement: element };
  const fetcher = async (path, options = {}) => {
    const method = options.method ?? 'GET';
    calls.push({ path, method, body: options.body === undefined ? undefined : JSON.parse(options.body) });
    const route = routes[`${method} ${path}`];
    if (route) return route();
    if (path === '/api/web/admin/me') return okJson({ admin: true });
    if (path === '/api/web/admin/merchants') return okJson({ merchants });
    if (path.endsWith('/staff')) return okJson({ staff: [] });
    if (path === '/api/web/admin/campaign-drafts') return okJson({ drafts: [] });
    if (path === '/api/web/admin/campaigns') return okJson({ campaigns: [] });
    if (path === '/api/web/admin/reward-offers') return okJson({ offers: [] });
    if (method === 'POST') return okJson({});
    throw new Error(`unexpected ${method} ${path}`);
  };
  const writes = () => calls.filter((call) => call.method === 'POST');
  return { nodes, doc, fetcher, calls, writes, offerSelect };
}

test('참조 번호는 짧은 코드만 받고 사업자등록번호·전화번호·이메일 모양은 서버에 보내기 전에 거절한다', () => {
  assert.equal(documentReferenceProblem('CS-2609-01'), null);
  assert.equal(documentReferenceProblem(' OWN.A01_0930 '), null);
  for (const value of ['123-45-67890', '010-1234-5678', 'owner@example.com', 'CS-20260930-01', 'ab', '동의서1', '']) {
    assert.match(documentReferenceProblem(value), /참조 번호를 확인해 주세요.*사업자등록번호·전화번호/, value);
  }
  assert.deepEqual(missingForPublish(readyMerchant), []);
  assert.deepEqual(missingForPublish({ ...readyMerchant, menuItems: [], businessHours: ' ', roadAddress: '' }),
    ['메뉴', '영업시간', '도로명 주소']);
  assert.match(goLiveMessage({ code: 'ADMIN_OWNER_LIMIT' }, '실패'), /점포당 2명/);
  assert.match(goLiveMessage({ code: 'ADMIN_SELF_ROLE_CHANGE' }, '실패'), /본인 계정/);
  assert.match(goLiveMessage({ status: 401 }, '실패'), /다시 로그인/);
  assert.equal(goLiveMessage({ code: 'SOMETHING_NEW' }, '실패'), '실패');
});

test('보상 혜택 입력은 점주 동의 5항목·발급 상한·참조 번호가 모두 있어야 요청 본문을 만든다', () => {
  const values = new Map([
    ['merchantId', 'real-1'], ['milestone', '2'], ['title', ' 김밥 한 줄 무료 '], ['detail', '다른 할인과 함께 쓸 수 없어요.'],
    ['validDays', '30'], ['issuanceCap', '100'], ['consentDocumentRef', 'OF-2609-01'],
    ['consentBenefit', 'on'], ['consentOwnerPaysCost', 'on'], ['consentValidity', 'on'], ['consentIssuanceCap', 'on'],
    ['consentDuplicateUse', 'on'],
  ]);
  assert.deepEqual(rewardOfferPayload(values), {
    merchantId: 'real-1', milestone: 2, title: '김밥 한 줄 무료', detail: '다른 할인과 함께 쓸 수 없어요.', validDays: 30,
    issuanceCap: 100, consentDocumentRef: 'OF-2609-01',
    consent: { benefit: true, ownerPaysCost: true, validity: true, issuanceCap: true, duplicateUse: true },
  });
  for (const field of ['consentBenefit', 'consentOwnerPaysCost', 'consentValidity', 'consentIssuanceCap', 'consentDuplicateUse']) {
    const missing = new Map(values);
    missing.delete(field);
    assert.throws(() => rewardOfferPayload(missing), /점주 동의 5항목/, field);
  }
  for (const cap of ['', '0', '10001', '1.5']) {
    assert.throws(() => rewardOfferPayload(new Map([...values, ['issuanceCap', cap]])), /발급 상한/, cap);
  }
  assert.throws(() => rewardOfferPayload(new Map([...values, ['consentDocumentRef', '123-45-67890']])), /참조 번호/);
  assert.throws(() => rewardOfferPayload(new Map([...values, ['validDays', '366']])), /유효 기간/);
  assert.throws(() => rewardOfferPayload(new Map([...values, ['milestone', '4']])), /상자/);
});

test('비공개 점포는 빠진 항목을 알리고, 참조 번호를 확인한 뒤에만 버전과 함께 공개를 요청한다', async () => {
  const page = adminPage({ merchants: [readyMerchant, { ...readyMerchant, id: 'real-2', name: '메뉴 없는 점포', menuItems: [] },
    { ...readyMerchant, id: 'real-3', name: '공개 점포', status: 'ACTIVE', consentDocumentRef: 'CS-2609-01',
      publishedAt: '2026-09-30T01:00:00.000Z' }] });
  await loadAdmin(page.fetcher, page.doc);
  const cards = page.nodes['admin-merchants'].children;
  const [ready, empty, active] = [cards[0], cards[2], cards[4]].map((form) => form.children[2]);
  assert.equal(ready.className, 'admin-go-live');
  assert.equal(ready.getAttribute('aria-label'), '월계 김밥 공개');
  assert.match(ready.children[1].textContent, /동의서를 확인하고 참조 번호/);
  assert.match(empty.children[1].textContent, /먼저 채워 저장해 주세요: 메뉴/);
  assert.equal(empty.children.at(-1).disabled, true);
  assert.equal(active.children[1].textContent, '공개 중 · 동의서 CS-2609-01 · 공개 2026-09-30 10:00 KST');
  assert.equal(active.children.length, 2);
  // 숨김 단추는 카드 맨 끝 그대로다.
  assert.equal(cards[0].children.at(-1).textContent, '비공개 및 신규 참여 중지');

  const input = ready.children[2].children[0];
  const publish = ready.children.at(-1);
  assert.equal(publish.getAttribute('aria-label'), '월계 김밥 점포 공개');
  assert.equal(input.getAttribute('aria-label'), '점포 동의서 참조 번호 (월계 김밥)');
  input.value = '010-1234-5678';
  await publish.click();
  assert.deepEqual(page.writes(), []);
  assert.match(page.nodes['admin-status'].textContent, /참조 번호를 확인해 주세요/);
  assert.equal(publish.disabled, false);
  input.value = ' CS-2609-01 ';
  await publish.click();
  assert.deepEqual(page.writes(), [{ path: '/api/web/admin/merchants/real-1/publish', method: 'POST',
    body: { expectedVersion: 4, consentDocumentRef: 'CS-2609-01' } }]);
  assert.match(page.nodes['admin-status'].textContent, /점포를 공개했습니다/);
});

test('공개가 서버에서 거절되면 이유를 알리고 다시 누를 수 있다', async () => {
  const page = adminPage({ routes: {
    'POST /api/web/admin/merchants/real-1/publish': () => refused(409, 'ADMIN_MERCHANT_NOT_READY'),
  } });
  await loadAdmin(page.fetcher, page.doc);
  const panel = page.nodes['admin-merchants'].children[0].children[2];
  panel.children[2].children[0].value = 'CS-2609-01';
  await panel.children.at(-1).click();
  assert.match(page.nodes['admin-status'].textContent, /메뉴·영업시간·도로명 주소를 먼저 채워/);
  assert.equal(panel.children.at(-1).disabled, false);
  assert.equal(page.nodes['admin-content'].hidden, false);
});

test('공개 중인 점포의 직원은 확인 기록 참조 번호로 점주가 되고, 점주 목록은 눌러서 읽어 사유와 함께 내린다', async () => {
  const active = { ...readyMerchant, status: 'ACTIVE', consentDocumentRef: 'CS-2609-01' };
  let promoteReply = () => okJson({ member: { accountId: 'staff-1', role: 'OWNER' } });
  const page = adminPage({ merchants: [active], routes: {
    'GET /api/web/admin/merchants/real-1/staff': () => okJson({ staff: [{ accountId: 'staff-1', role: 'STAFF',
      grantedAt: '2026-09-30T00:00:00.000Z' }] }),
    'GET /api/web/admin/merchants/real-1/owners': () => okJson({ owners: [{ accountId: 'owner-1', role: 'OWNER',
      grantedAt: '2026-09-30T00:00:00.000Z' }] }),
    'POST /api/web/admin/merchants/real-1/members/staff-1/promote-owner': () => promoteReply(),
  } });
  await loadAdmin(page.fetcher, page.doc);
  assert.equal(page.calls.some((call) => call.path.endsWith('/owners')), false, 'owners load on demand');
  const staffPanel = page.nodes['admin-merchants'].children[1];
  const staffList = staffPanel.children[1];
  const promote = staffList.children[1];
  const [referenceLabel, promoteButton] = promote.children;
  assert.equal(promoteButton.textContent, '점주로 올리기');
  assert.equal(promoteButton.getAttribute('aria-label'), '월계 김밥 계정 staff-1 점주로 올리기');
  referenceLabel.children[0].value = '123-45-67890';
  await promote.submit();
  assert.deepEqual(page.writes(), []);
  referenceLabel.children[0].value = 'OWN-2609-01';
  promoteReply = () => refused(403, 'ADMIN_SELF_ROLE_CHANGE');
  await promote.submit();
  assert.match(page.nodes['admin-status'].textContent, /본인 계정은 점주로 올리거나 내릴 수 없어요/);
  promoteReply = () => okJson({ member: { accountId: 'staff-1', role: 'OWNER' } });
  await promote.submit();
  assert.deepEqual(page.writes().at(-1), { path: '/api/web/admin/merchants/real-1/members/staff-1/promote-owner',
    method: 'POST', body: { verificationDocumentRef: 'OWN-2609-01' } });
  assert.match(page.nodes['admin-status'].textContent, /점주로 올렸습니다/);

  const ownerPanel = page.nodes['admin-merchants'].children[1].children[4];
  assert.equal(ownerPanel.className, 'admin-owners');
  assert.match(ownerPanel.children[1].textContent, /사업자등록증 원본.*전화.*참조 번호만.*사업자등록번호·이름·전화번호는 적지 않아요/);
  await ownerPanel.children[2].click();
  const ownerList = ownerPanel.children[3];
  assert.equal(ownerList.children[0].textContent, '계정 owner-1 · 점주');
  const demote = ownerList.children[1];
  const [reasonLabel, demoteReference, demoteButton] = demote.children;
  assert.equal(demoteButton.className, 'danger');
  reasonLabel.children[0].value = 'OWNERSHIP_CHANGED';
  demoteReference.children[0].value = 'OWN-2609-02';
  await demote.submit();
  assert.deepEqual(page.writes().at(-1), { path: '/api/web/admin/merchants/real-1/members/owner-1/demote-owner',
    method: 'POST', body: { reason: 'OWNERSHIP_CHANGED', verificationDocumentRef: 'OWN-2609-02' } });
  assert.match(page.nodes['admin-status'].textContent, /직원으로 내렸습니다/);
});

test('비공개 점포의 직원에게는 점주 올리기 양식을 두지 않는다', async () => {
  const page = adminPage({ routes: {
    'GET /api/web/admin/merchants/real-1/staff': () => okJson({ staff: [{ accountId: 'staff-1', role: 'STAFF',
      grantedAt: '2026-09-30T00:00:00.000Z' }] }),
  } });
  await loadAdmin(page.fetcher, page.doc);
  assert.equal(page.nodes['admin-merchants'].children[1].children[1].children.length, 1);
});

test('보상 혜택 구역은 공개 중인 점포만 고르게 하고 활성 혜택만 멈출 수 있다', async () => {
  const offers = [
    { id: 'offer-1', merchantId: 'real-3', merchantName: '공개 점포', milestone: 1, title: '<b>김밥</b>', detail: '',
      validDays: 30, issuanceCap: 100, issuedCount: 3, status: 'ACTIVE', consentDocumentRef: 'OF-2609-01',
      createdAt: '2026-09-30T00:00:00.000Z' },
    { id: 'offer-2', merchantId: 'real-3', merchantName: '공개 점포', milestone: 3, title: '음료', detail: '',
      validDays: 30, issuanceCap: null, issuedCount: 0, status: 'PAUSED', consentDocumentRef: null,
      createdAt: '2026-09-29T00:00:00.000Z' },
  ];
  let pauseReply = () => okJson({ offer: { ...offers[0], status: 'PAUSED' }, replayed: false });
  const page = adminPage({ merchants: [readyMerchant, { ...readyMerchant, id: 'real-3', name: '공개 점포', status: 'ACTIVE' }],
    routes: {
      'GET /api/web/admin/reward-offers': () => okJson({ offers }),
      'POST /api/web/admin/reward-offers/offer-1/pause': () => pauseReply(),
    } });
  await loadAdmin(page.fetcher, page.doc);
  assert.equal(page.nodes['admin-offer-form'].hidden, false);
  assert.deepEqual(page.offerSelect.children.map((option) => option.value), ['real-3']);
  const rows = page.nodes['admin-offers'].children;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].textContent, '첫 번째 상자 · 공개 점포 · <b>김밥</b> · 발급 3장/100장 · 동의서 OF-2609-01 · 발급 중');
  assert.match(rows[1].textContent, /황금 상자 · 공개 점포 · 음료 · 발급 0장\/상한 없음 · 동의서 기록 없음 · 멈춤/);
  assert.equal(rows[1].children.length, 0);
  const pause = rows[0].children[0];
  assert.equal(pause.getAttribute('aria-label'), '공개 점포 <b>김밥</b> 혜택 멈춤');
  pauseReply = () => refused(404, 'ADMIN_OFFER_NOT_FOUND');
  await pause.click();
  assert.match(page.nodes['admin-status'].textContent, /혜택을 찾을 수 없어요/);
  pauseReply = () => okJson({ offer: { ...offers[0], status: 'PAUSED' }, replayed: false });
  await pause.click();
  assert.deepEqual(page.writes().at(-1), { path: '/api/web/admin/reward-offers/offer-1/pause', method: 'POST', body: {} });
  assert.match(page.nodes['admin-status'].textContent, /혜택 발급을 멈췄습니다/);

  const hiddenOnly = adminPage();
  await loadAdmin(hiddenOnly.fetcher, hiddenOnly.doc);
  assert.equal(hiddenOnly.nodes['admin-offer-form'].hidden, true);
  assert.match(hiddenOnly.nodes['admin-offers'].textContent, /등록된 보상 혜택이 없습니다/);
});

test('캠페인 초안은 공개하고, 공개 중인 캠페인은 중지·중지된 캠페인은 다시 공개한다', async () => {
  const campaigns = [
    { id: 'campaign-a', merchantId: 'real-1', merchantName: '월계 김밥', title: '가을 탐험', status: 'ACTIVE', public: true,
      startsAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-10-31T00:00:00.000Z', enrollmentCapacity: 50, enrolledCount: 50,
      rewardGoals: [] },
    { id: 'campaign-b', merchantId: 'real-2', merchantName: '다른 점포', title: '겨울 탐험', status: 'PAUSED', public: false,
      startsAt: '2026-11-01T00:00:00.000Z', endsAt: '2026-11-30T00:00:00.000Z', enrollmentCapacity: 10, enrolledCount: 0,
      rewardGoals: [] },
  ];
  let publishReply = () => okJson({ campaign: { ...campaigns[1], status: 'ACTIVE' }, replayed: false });
  const page = adminPage({ routes: {
    'GET /api/web/admin/campaign-drafts': () => okJson({ drafts: [{ id: 'draft-1', merchantId: 'real-1', merchantName: '월계 김밥',
      title: '첫 탐험', enrollmentCapacity: 15 }] }),
    'GET /api/web/admin/campaigns': () => okJson({ campaigns }),
    'POST /api/web/admin/campaigns/draft-1/publish': () => publishReply(),
  } });
  await loadAdmin(page.fetcher, page.doc);
  const draft = page.nodes['admin-campaign-drafts'].children[0];
  assert.match(draft.textContent, /비공개 초안 · 정원 15명/);
  assert.equal(draft.children[0].getAttribute('aria-label'), '월계 김밥 첫 탐험 캠페인 공개');
  const [activeRow, pausedRow] = page.nodes['admin-campaigns'].children;
  assert.match(activeRow.textContent, /월계 김밥 · 가을 탐험 · 공개 중 · .* · 보이는 참여자 50\/50명/);
  assert.equal(activeRow.children[0].textContent, '중지');
  assert.equal(pausedRow.children[0].textContent, '다시 공개');
  publishReply = () => refused(409, 'ADMIN_CAMPAIGN_ACTIVE_EXISTS');
  await draft.children[0].click();
  assert.match(page.nodes['admin-status'].textContent, /이미 공개 중인 캠페인이 있어요/);
  publishReply = () => okJson({ campaign: { id: 'draft-1', status: 'ACTIVE' }, replayed: false });
  await draft.children[0].click();
  await activeRow.children[0].click();
  await pausedRow.children[0].click();
  assert.deepEqual(page.writes().map((call) => [call.path, call.body]), [
    ['/api/web/admin/campaigns/draft-1/publish', {}],
    ['/api/web/admin/campaigns/draft-1/publish', {}],
    ['/api/web/admin/campaigns/campaign-a/pause', {}],
    ['/api/web/admin/campaigns/campaign-b/publish', {}],
  ]);
});

test('관리 화면 HTML은 동의 5항목을 fieldset·legend로 묶고 모든 새 입력에 이름표를 둔다', () => {
  const page = readFileSync(new URL('../../apps/production-web/admin.html', import.meta.url), 'utf8');
  assert.match(page, /<fieldset class="admin-consent">\s*<legend>점주 동의 확인 \(5항목 모두\)<\/legend>/);
  for (const name of ['consentBenefit', 'consentOwnerPaysCost', 'consentValidity', 'consentIssuanceCap', 'consentDuplicateUse']) {
    assert.match(page, new RegExp(`<label><input type="checkbox" name="${name}" required> [^<]+</label>`), name);
  }
  assert.match(page, /<input name="issuanceCap" type="number" min="1" max="10000" step="1" required>/);
  const offerForm = /<form id="admin-offer-form" hidden>([^]*?)<\/form>/.exec(page)[1];
  for (const control of offerForm.match(/<(?:input|select|textarea)\b[^>]*>/g)) {
    const before = offerForm.slice(0, offerForm.indexOf(control));
    assert.ok(before.lastIndexOf('<label>') > before.lastIndexOf('</label>'), `${control} needs a label`);
  }
  assert.match(page, /방문 보상에는 참여 등록이 필요 없어/);
  assert.doesNotMatch(page, /정원 적용 규칙이 확정되기 전에는 공개할 수 없습니다/);
  const css = readFileSync(new URL('../../apps/production-web/assets/production.css', import.meta.url), 'utf8');
  const goLiveCss = css.slice(css.indexOf('/* 점포 공개·점주·보상 혜택·캠페인'), css.indexOf('.panel > *, #admin-campaign-draft'))
    .replace(/\/\*[^]*?\*\//g, '');
  assert.ok(goLiveCss.length > 0);
  // 새 규칙은 토큰 색만 쓰고 고정 폭을 두지 않아 어두운 화면과 390px에서 그대로 맞는다.
  assert.doesNotMatch(goLiveCss, /#[0-9a-f]{3,8}\b|rgb\(|\b\d{3,}px/i);
  assert.match(goLiveCss, /flex-wrap: wrap/);
});

test('고객 웹은 운영 API가 발행 준비 중이라고 하면 접수·진행 문구 대신 "NFT 발행 준비 중"을 보인다', async () => {
  assert.equal(nftLineLabel({ nftStatus: 'QUEUED' }, 'PREPARING'), 'NFT 발행 준비 중');
  assert.equal(nftLineLabel({ nftStatus: 'NOT_REQUESTED' }, 'PREPARING'), 'NFT 발행 준비 중');
  assert.equal(nftLineLabel({ nftStatus: 'FINALIZED' }, 'PREPARING'), 'NFT 발행 완료');
  assert.equal(nftLineLabel({ nftStatus: 'QUEUED' }, undefined), 'NFT 발행 접수');
  assert.equal(nftLineLabel({ nftStatus: 'QUEUED' }, 'SOMETHING_NEW'), 'NFT 발행 접수');
  const ids = ['collection-status', 'collection-login', 'collection-retry', 'collection-logout', 'collection-content',
    'visit-list', 'collectible-list', 'badge-list', 'badge-note', 'badge-content', 'badge-passport', 'reward-list', 'coupon-list'];
  const nodes = Object.fromEntries(ids.map((id) => [id, { ...element(), hidden: true }]));
  const doc = { getElementById(id) { return nodes[id]; }, createElement: element, hidden: false, addEventListener() {} };
  const collectible = { entitlementId: 'reward-1', merchantId: 'merchant-1', merchantName: '월계 가게', campaignId: 'campaign-1',
    campaignTitle: '방문', targetVisitCount: 1, displayName: '마스코트', appCollectibleStatus: 'COLLECTED', mintJobId: null,
    recipient: null, nftStatus: 'NOT_REQUESTED', nft: null };
  await loadCollection(async (path) => path === '/api/web/collection'
    ? okJson({ visits: [], collectibles: [collectible], nftMinting: 'PREPARING' })
    : { ok: false, status: 503 }, doc, { badgesTimeoutMs: 10 });
  const card = nodes['collectible-list'].children[0].children.map((child) => child.textContent).join(' ');
  assert.match(card, /NFT 발행 준비 중/);
  assert.doesNotMatch(card, /미신청|접수/);
});
