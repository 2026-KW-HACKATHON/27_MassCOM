// Issue #412 (D-092): 관리자 웹 캠페인 초안 양식의 목적 선택, 서버로 보내는 payload, 목록 문구, 점원 안내를 가짜 DOM으로 확인한다.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  bindAdmin, campaignDraftPayload, campaignPurposeNames, loadAdmin, purposeLabel, purposePayload,
} from '../../apps/production-web/assets/admin.mjs';

// FormData처럼 get/getAll을 가진 값 상자. 같은 이름이 여러 번 오는 체크박스(요일)는 배열로 넣는다.
class Form {
  constructor(values) { this.values = values; }
  get(name) { const value = this.values[name]; return Array.isArray(value) ? value[0] ?? null : value ?? null; }
  getAll(name) { const value = this.values[name]; return value === undefined ? [] : Array.isArray(value) ? value : [value]; }
}
const base = {
  merchantId: 'real-1', title: '한산한 시간 채우기', startsAt: '2026-10-01T09:00', endsAt: '2026-11-01T09:00',
  enrollmentCapacity: '15', goal1: '첫 방문', goal3: '세 번째 방문', goal5: '다섯 번째 방문',
};
const form = (extra = {}) => new Form({ ...base, ...extra });
const problem = (extra, pattern) => assert.throws(() => campaignDraftPayload(form(extra)), pattern, JSON.stringify(extra));

test('a draft without a purpose sends exactly the request it always sent', () => {
  const legacy = campaignDraftPayload(new Map(Object.entries(base)));
  assert.equal('purpose' in legacy, false);
  assert.deepEqual(Object.keys(legacy), ['merchantId', 'title', 'startsAt', 'endsAt', 'enrollmentCapacity', 'rewardGoals']);
  assert.equal('purpose' in campaignDraftPayload(form({ purpose: '' })), false);
  // 목적을 고르지 않았다면 남아 있는 다른 목적의 입력값은 보내지 않는다.
  assert.equal('purpose' in campaignDraftPayload(form({ purpose: '', window1Days: ['1'], window1Start: '14:00', window1End: '17:00', purposeMenu: '김밥' })), false);
});

test('an off-peak draft sends sorted days and 24:00 for an end time of 00:00', () => {
  const payload = campaignDraftPayload(form({
    purpose: 'OFF_PEAK', purposeMenu: ' 라떼 ',
    window1Days: ['5', '1', '3', '1'], window1Start: '14:00', window1End: '17:00',
    window2Days: ['6'], window2Start: '21:00', window2End: '00:00',
    window3Days: [], window3Start: '', window3End: '',
  }));
  assert.deepEqual(payload.purpose, { purpose: 'OFF_PEAK', featuredMenuName: '라떼', timeWindows: [
    { days: [1, 3, 5], start: '14:00', end: '17:00' },
    { days: [6], start: '21:00', end: '24:00' },
  ] });
  assert.equal(payload.rewardGoals.length, 3);
});

test('an off-peak draft needs at least one complete window with an end after its start', () => {
  const off = { purpose: 'OFF_PEAK' };
  problem(off, /한산한 시간대를 한 개 이상 입력해 주세요/);
  problem({ ...off, window1Days: ['1'], window1Start: '14:00' }, /시간대 1의 요일과 시작·끝 시각을 모두 입력해 주세요/);
  problem({ ...off, window1Start: '14:00', window1End: '17:00' }, /시간대 1의 요일과 시작·끝 시각을 모두 입력해 주세요/);
  problem({ ...off, window1Days: ['1'], window1Start: '17:00', window1End: '14:00' }, /끝 시각은 시작 시각보다 늦어야 해요/);
  problem({ ...off, window1Days: ['1'], window1Start: '14:00', window1End: '14:00' }, /끝 시각은 시작 시각보다 늦어야 해요/);
  // 22:00~02:00처럼 자정을 넘기면 끝이 시작보다 이른 값이라 거절된다(둘로 나눠 입력).
  problem({ ...off, window1Days: ['1'], window1Start: '22:00', window1End: '02:00' }, /자정을 넘기는 시간대는 둘로 나눠 주세요/);
  problem({ ...off, window1Days: ['1'], window1Start: '14:00', window1End: '17:00', window2Days: ['2'], window2Start: '09:00' }, /시간대 2의 요일/);
  problem({ ...off, window1Days: ['9'], window1Start: '14:00', window1End: '17:00' }, /시간대 1의 요일/);
  problem({ ...off, window1Days: ['x'], window1Start: '14:00', window1End: '17:00' }, /시간대 1의 요일/);
  problem({ purpose: 'EVERYTHING' }, /캠페인 목적을 다시 골라 주세요/);
  problem({ purpose: 'NEW_CUSTOMERS', purposeMenu: '가'.repeat(41) }, /40자 이하/);
});

test('a revisit draft sends only the revisit fields that were typed and checks the day range', () => {
  assert.deepEqual(campaignDraftPayload(form({ purpose: 'REVISIT' })).purpose, { purpose: 'REVISIT' });
  assert.deepEqual(campaignDraftPayload(form({ purpose: 'REVISIT', revisitMinDays: '3', revisitWindowDays: '21',
    nextStepText: ' 다음에는 코인이 완성돼요 ', purposeMenu: '', window1Days: ['1'], window1Start: '14:00', window1End: '17:00' })).purpose,
  { purpose: 'REVISIT', revisitMinDays: 3, revisitWindowDays: 21, nextStepText: '다음에는 코인이 완성돼요' });
  problem({ purpose: 'REVISIT', revisitMinDays: '0' }, /최소 일수는 1~30/);
  problem({ purpose: 'REVISIT', revisitMinDays: '31', revisitWindowDays: '60' }, /최소 일수는 1~30/);
  problem({ purpose: 'REVISIT', revisitWindowDays: '1' }, /기간 일수는 2~60/);
  problem({ purpose: 'REVISIT', revisitWindowDays: '61' }, /기간 일수는 2~60/);
  problem({ purpose: 'REVISIT', revisitMinDays: '2.5' }, /최소 일수는 1~30/);
  problem({ purpose: 'REVISIT', revisitMinDays: '5', revisitWindowDays: '5' }, /최소 일수는 기간 일수보다 작게/);
  // 입력하지 않은 쪽은 서버 기본값(1일, 14일)과 비교한다.
  problem({ purpose: 'REVISIT', revisitMinDays: '14' }, /최소 일수는 기간 일수보다 작게/);
  problem({ purpose: 'REVISIT', nextStepText: '가'.repeat(81) }, /80자 이하/);
});

test('a first-visit draft sends the featured menu and nothing else', () => {
  assert.deepEqual(campaignDraftPayload(form({ purpose: 'NEW_CUSTOMERS' })).purpose, { purpose: 'NEW_CUSTOMERS' });
  assert.deepEqual(campaignDraftPayload(form({ purpose: 'NEW_CUSTOMERS', purposeMenu: '김밥', revisitMinDays: '3', nextStepText: '다음에' })).purpose,
    { purpose: 'NEW_CUSTOMERS', featuredMenuName: '김밥' });
  assert.deepEqual(purposePayload(new Map([['purpose', 'NEW_CUSTOMERS']])), { purpose: 'NEW_CUSTOMERS' });
});

test('the list line names the purpose and its conditions, and unknown purposes add nothing', () => {
  assert.equal(purposeLabel(undefined), '');
  assert.equal(purposeLabel({ kind: 'FUTURE_KIND' }), '');
  assert.equal(purposeLabel({ kind: 'NEW_CUSTOMERS' }), ' · 목적: 처음 확인되는 방문 늘리기');
  assert.equal(purposeLabel({ kind: 'NEW_CUSTOMERS', featuredMenuName: '김밥' }), ' · 목적: 처음 확인되는 방문 늘리기 · 대표 메뉴 김밥');
  assert.equal(purposeLabel({ kind: 'REVISIT', revisitMinDays: 3, revisitWindowDays: 21 }), ' · 목적: 다시 방문하게 하기 · 3일 뒤부터 21일 안');
  assert.equal(purposeLabel({ kind: 'OFF_PEAK', timeWindows: [{ days: [1, 2, 3, 4, 5], start: '14:00', end: '17:00' }, { days: [6, 7], start: '10:00', end: '12:00' }] }),
    ' · 목적: 한산한 시간대 채우기 · 평일 14:00–17:00, 주말 10:00–12:00');
  assert.equal(purposeLabel({ kind: 'OFF_PEAK', timeWindows: [{ days: [1, 3, 5], start: '09:00', end: '24:00' }] }),
    ' · 목적: 한산한 시간대 채우기 · 월·수·금 09:00–24:00');
  // 관리자 화면에 "신규 고객"·"첫 손님"이라는 말을 쓰지 않는다.
  assert.doesNotMatch(Object.values(campaignPurposeNames).join(' '), /신규 고객|첫 손님/);
});

test('the draft form lists the three purposes, hides every purpose field until chosen and puts each control in a label', () => {
  const page = readFileSync(new URL('../../apps/production-web/admin.html', import.meta.url), 'utf8');
  const draft = /<form id="admin-campaign-draft" hidden>([^]*?)<\/form>/.exec(page)[1];
  // 점포 목록 select가 여전히 첫 select다(관리자 스크립트가 form.querySelector('select')로 찾는다).
  assert.match(draft, /<select name="merchantId" required><\/select>/);
  assert.ok(draft.indexOf('name="merchantId"') < draft.indexOf('name="purpose"'));
  const options = [...draft.match(/<select name="purpose">([^]*?)<\/select>/)[1].matchAll(/<option value="([A-Z_]*)">/g)].map(match => match[1]);
  assert.deepEqual(options, ['', 'NEW_CUSTOMERS', 'REVISIT', 'OFF_PEAK']);
  // 목적별 칸은 처음에 모두 숨겨져 있다.
  const gated = draft.match(/<(?:label|div) data-purpose-for="[A-Z_ ]+"[^>]*>/g);
  assert.equal(gated.length, 3);
  assert.ok(gated.every(tag => tag.endsWith(' hidden>')), gated.join('\n'));
  // 시간대 세 줄(첫 줄은 필수, 나머지는 선택), 각각 월~일 체크박스 7개와 시작·끝 시각.
  for (const index of [1, 2, 3]) {
    assert.equal(draft.match(new RegExp(`name="window${index}Days" value="[1-7]"`, 'g')).length, 7);
    assert.match(draft, new RegExp(`<input name="window${index}Start" type="time">`));
    assert.match(draft, new RegExp(`<input name="window${index}End" type="time">`));
  }
  assert.match(draft, /<legend>시간대 1<\/legend>/);
  assert.match(draft, /<legend>시간대 2 \(선택\)<\/legend>/);
  // 모든 입력은 label 안에 있다.
  for (const control of draft.match(/<(?:input|select|textarea)\b[^>]*>/g)) {
    const before = draft.slice(0, draft.indexOf(control));
    assert.ok(before.lastIndexOf('<label') > before.lastIndexOf('</label>'), `${control} needs a label`);
  }
  assert.doesNotMatch(draft, /신규 고객|첫 손님/);
  assert.match(draft, /공개한 뒤에는 목적과 조건을 바꿀 수 없어요/);
});

function adminPage({ routes = {} } = {}) {
  const element = () => {
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
      async fire(type, event) { return listeners.get(type)?.(event); },
      focus() {},
    };
  };
  const ids = ['admin-status', 'admin-login', 'admin-content', 'admin-merchants', 'admin-create', 'admin-logout',
    'admin-offer-form', 'admin-offers', 'admin-campaign-draft', 'admin-campaign-drafts', 'admin-campaigns'];
  const nodes = Object.fromEntries(ids.map(id => [id, { ...element(), hidden: true }]));
  const purposeNodes = ['NEW_CUSTOMERS REVISIT OFF_PEAK', 'REVISIT', 'OFF_PEAK'].map(purposeFor => ({ ...element(), hidden: true, dataset: { purposeFor } }));
  const offerSelect = element();
  const offerButton = element();
  nodes['admin-offer-form'].querySelector = selector => selector.startsWith('select') ? offerSelect : offerButton;
  nodes['admin-offer-form'].values = new Map();
  nodes['admin-offer-form'].reset = () => {};
  const form = nodes['admin-campaign-draft'];
  form.querySelector = () => element();
  form.querySelectorAll = () => purposeNodes;
  form.elements = { purpose: { value: '' } };
  form.reset = function reset() { this.elements.purpose.value = ''; };
  const calls = [];
  const merchant = { id: 'real-1', name: '월계 김밥', story: '', roadAddress: '서울', minimumSpendWon: 0, menuItems: [],
    businessHours: '', status: 'PAUSED', demo: false, version: 1, consentDocumentRef: null, publishedAt: null };
  const doc = { getElementById(id) { return nodes[id]; }, createElement: element,
    defaultView: { confirm: () => true, addEventListener() {}, FormData: class { constructor(source) { return source.values ?? new Map(); } } } };
  const json = value => ({ ok: true, json: async () => value });
  const fetcher = async (path, options = {}) => {
    const method = options.method ?? 'GET';
    calls.push({ path, method, body: options.body === undefined ? undefined : JSON.parse(options.body) });
    const route = routes[`${method} ${path}`];
    if (route) return route();
    if (path === '/api/web/admin/me') return json({ admin: true });
    if (path === '/api/web/admin/merchants') return json({ merchants: [merchant] });
    if (path.endsWith('/staff')) return json({ staff: [] });
    if (path === '/api/web/admin/campaign-drafts') return json({ drafts: [] });
    if (path === '/api/web/admin/campaigns') return json({ campaigns: [] });
    if (path === '/api/web/admin/reward-offers') return json({ offers: [] });
    return json({});
  };
  return { nodes, doc, fetcher, calls, form, purposeNodes };
}

test('choosing a purpose shows only its own fields, and saving sends it and resets the form', async () => {
  const page = adminPage();
  await bindAdmin(page.fetcher, page.doc);
  const visible = () => page.purposeNodes.map(node => !node.hidden);
  assert.deepEqual(visible(), [false, false, false]);
  for (const [kind, expected] of [['NEW_CUSTOMERS', [true, false, false]], ['REVISIT', [true, true, false]],
    ['OFF_PEAK', [true, false, true]], ['', [false, false, false]]]) {
    page.form.elements.purpose.value = kind;
    await page.form.fire('change', { target: { name: 'purpose' } });
    assert.deepEqual(visible(), expected, kind);
  }
  // 다른 칸의 change는 목적 칸을 건드리지 않는다.
  page.form.elements.purpose.value = 'OFF_PEAK';
  await page.form.fire('change', { target: { name: 'title' } });
  assert.deepEqual(visible(), [false, false, false]);

  page.form.values = form({ purpose: 'OFF_PEAK', window1Days: ['1', '2'], window1Start: '14:00', window1End: '17:00' });
  page.form.elements.purpose.value = 'OFF_PEAK';
  await page.form.fire('change', { target: { name: 'purpose' } });
  await page.form.submit();
  const post = page.calls.find(call => call.method === 'POST' && call.path === '/api/web/admin/campaign-drafts');
  assert.deepEqual(post.body.purpose, { purpose: 'OFF_PEAK', timeWindows: [{ days: [1, 2], start: '14:00', end: '17:00' }] });
  assert.equal(page.form.elements.purpose.value, '');
  assert.deepEqual(visible(), [false, false, false]);
});

test('binding the admin page shows the fields of a purpose the browser already restored in the form', async () => {
  const page = adminPage();
  page.form.elements.purpose.value = 'REVISIT';
  await bindAdmin(page.fetcher, page.doc);
  assert.deepEqual(page.purposeNodes.map(node => !node.hidden), [true, true, false]);
  // 아무것도 고르지 않은 채 열면 모두 숨겨져 있다.
  const empty = adminPage();
  await bindAdmin(empty.fetcher, empty.doc);
  assert.deepEqual(empty.purposeNodes.map(node => !node.hidden), [false, false, false]);
});

test('a purpose mistake is shown as a Korean message and nothing is posted', async () => {
  const page = adminPage();
  await bindAdmin(page.fetcher, page.doc);
  page.form.values = form({ purpose: 'OFF_PEAK' });
  await page.form.submit();
  assert.match(page.nodes['admin-status'].textContent, /한산한 시간대를 한 개 이상 입력해 주세요/);
  assert.equal(page.calls.some(call => call.method === 'POST'), false);
});

test('drafts and published campaigns show their purpose in the admin lists', async () => {
  const purposeOffPeak = { kind: 'OFF_PEAK', timeWindows: [{ days: [1, 2, 3, 4, 5], start: '14:00', end: '17:00' }] };
  const page = adminPage({ routes: {
    'GET /api/web/admin/campaign-drafts': () => ({ ok: true, json: async () => ({ drafts: [
      { id: 'd1', merchantId: 'real-1', merchantName: '월계 김밥', title: '한산한 시간', enrollmentCapacity: 15, purpose: purposeOffPeak },
      { id: 'd2', merchantId: 'real-1', merchantName: '월계 김밥', title: '옛 초안', enrollmentCapacity: 15 },
    ] }) }),
    'GET /api/web/admin/campaigns': () => ({ ok: true, json: async () => ({ campaigns: [
      { id: 'c1', merchantId: 'real-1', merchantName: '월계 김밥', title: '공개 중', status: 'ACTIVE', public: true,
        startsAt: '2026-10-01T00:00:00.000Z', endsAt: '2099-11-01T00:00:00.000Z', enrollmentCapacity: 5, enrolledCount: 1, rewardGoals: [],
        purpose: { kind: 'REVISIT', revisitMinDays: 1, revisitWindowDays: 14 } },
    ] }) }),
  } });
  await loadAdmin(page.fetcher, page.doc);
  const [withPurpose, legacy] = page.nodes['admin-campaign-drafts'].children;
  assert.match(withPurpose.textContent, /비공개 초안 · 정원 15명 · 목적: 한산한 시간대 채우기 · 평일 14:00–17:00/);
  assert.doesNotMatch(legacy.textContent, /목적:/);
  assert.match(page.nodes['admin-campaigns'].children[0].textContent, /보이는 참여자 1\/5명 · 목적: 다시 방문하게 하기 · 1일 뒤부터 14일 안/);
});

test('the merchant web staff screen explains a code made outside the campaign window and says the visit still counts', () => {
  const source = readFileSync(new URL('../../apps/production-web/assets/merchant.mjs', import.meta.url), 'utf8');
  assert.match(source, /const outsideWindowStaffNote = '이 코드를 만든 시각은 캠페인 시간대 밖이에요\(방문은 인정돼요\)';/);
  // 혜택은 뒤 PR에서 생기므로 점원 안내도 혜택을 말하지 않는다.
  assert.doesNotMatch(/const outsideWindowStaffNote = '[^']*'/.exec(source)[0], /혜택/);
  assert.match(source, /issued\.windowStatus === 'OUTSIDE_WINDOW' \? ` · \$\{outsideWindowStaffNote\}` : ''/);
  const mobile = readFileSync(new URL('../../apps/mobile/src/commerce/benefit-window.ts', import.meta.url), 'utf8');
  // 웹과 모바일 점원 화면의 안내 문구는 같은 문장이다.
  assert.ok(mobile.includes("'이 코드를 만든 시각은 캠페인 시간대 밖이에요(방문은 인정돼요)'"));
});
