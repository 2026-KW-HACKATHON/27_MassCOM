import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { bindMerchant, readinessRequestText, operatorContact } from '../../apps/production-web/assets/merchant.mjs';
import { installMiniDom, settle } from '../fixtures/mini-dom.mjs';

const steps = () => [
  { key: 'basic', label: '가게 기본 정보', state: 'NEEDS_SETUP', hint: '비어 있는 항목: 영업시간, 도로명 주소. 운영팀에 입력을 요청해 주세요.' },
  { key: 'menu', label: '메뉴', state: 'NEEDS_SETUP', hint: '메뉴를 1개 이상 등록해야 해요.' },
  { key: 'members', label: '점주·직원', state: 'CHECK', hint: '활성 점주가 없어요.' },
  { key: 'reward', label: '방문 보상', state: 'NEEDS_SETUP', hint: '방문 보상 수집품이 아직 캠페인에 연결되지 않았어요.' },
  { key: 'campaign', label: '캠페인', state: 'SCHEDULED', hint: '캠페인 시작일이 아직 되지 않았어요.' },
  { key: 'visible', label: '고객 앱 공개', state: 'WAITING_APPROVAL', hint: '운영팀 공개 처리 대기 중이에요.' },
];
const overview = () => ({
  businessDate: '2026-10-03', visits: { today: 2, thisWeek: 3, lastWeek: 1, total: 8,
    last7Days: Array.from({ length: 7 }, (_, i) => ({ date: `2026-09-${24 + i}`, count: i === 6 ? 3 : 0 })) },
  comparison: null, couponsRedeemedThisWeek: 2, repeatVisitors: 1, campaign: null,
  readiness: { steps: steps(), message: '공개 준비가 필요해요.' },
  weekVisitors: { first: 2, repeat: 1 },
  weekCollectibles: [{ gradeId: 'bronze', gradeName: '브론즈', count: 2 }, { gradeId: 'gold', gradeName: '골드', count: 1 }],
  weekCoupons: { issued: 3, redeemed: 2 }, weekDetailViews: 12,
});
const response = body => ({ ok: true, status: 200, json: async () => body });
async function fixture({ role = 'OWNER', data = overview(), clipboard, campaigns = [], merchants, couponState } = {}) {
  const env = installMiniDom();
  const { document: doc } = env;
  const createElement = doc.createElement.bind(doc);
  doc.createElement = tag => {
    const node = createElement(tag);
    node.style = { setProperty() {} };
    return node;
  };
  doc.body.innerHTML = readFileSync(new URL('../../apps/production-web/merchant.html', import.meta.url), 'utf8');
  doc.defaultView.navigator = { clipboard: clipboard ?? {} };
  const calls = [];
  const merchant = { id: 'm1', name: '월계 식당', role };
  const mine = merchants ?? [merchant];
  const fetcher = async (path, options) => {
    calls.push({ path, options });
    if (path.endsWith('/me')) return response({ accountScope: 'local-test', merchants: mine });
    if (path.endsWith('/registration-merchants')) return response({ merchants: [merchant] });
    if (path.endsWith('/overview')) return response(data);
    if (path.endsWith('/recent-visits')) return response({ businessDate: '2026-10-03', visits: [] });
    if (path.endsWith('/recent-coupon-redemptions')) return response({ coupons: couponState?.redeemed ? [{
      couponId: 'coupon-1', title: '음료 1잔', customerLabel: '손님 K7QM',
      redeemedAt: couponState.redeemedAt, undoUntil: couponState.undoUntil, canUndo: true,
    }] : [] });
    if (couponState && path.endsWith('/customer-identities/resolve')) return response({ expiresAt: '2026-10-09T10:10:00Z' });
    if (couponState && path.endsWith('/coupons/lookup')) return response({ coupons: [{
      couponId: 'coupon-1', title: '음료 1잔', detail: '', expiresAt: '2026-10-10T10:00:00Z',
    }] });
    if (couponState && path.endsWith('/coupons/coupon-1/redeem')) {
      couponState.redeemed = true;
      return response({ status: 'REDEEMED' });
    }
    if (path.endsWith('/visitor-feedback')) return response({ tags: [], suggestions: [], notes: [] });
    if (path.endsWith('/collectible-campaigns')) return response({ campaigns });
    if (path.endsWith('/collectible-projects')) return response({ projects: [] });
    if (path.endsWith('/logout')) return { ok: true, status: 204 };
    throw new Error(`unexpected ${path}`);
  };
  await bindMerchant(fetcher, doc);
  const rows = () => doc.getElementById('merchant-readiness-list').children;
  const card = label => doc.getElementById('merchant-overview-cards').children
    .find(node => node.querySelector('.overview-card-label').textContent === label);
  const click = async node => { node.dispatchEvent({ type: 'click', target: node, button: 0, preventDefault() {} }); await settle(); };
  return { ...env, doc, merchant, calls, rows, card, click };
}

test('운영 요청은 가게 ID와 서버가 알려준 누락값만 포함하고 실제 문의처를 안내한다', () => {
  assert.equal(operatorContact, 'choijunhuk2007@gmail.com');
  assert.match(readFileSync(new URL('../../docs/privacy.html', import.meta.url), 'utf8'), new RegExp(operatorContact.replaceAll('.', '\\.')));
  const text = readinessRequestText({ id: 'm1', name: '월계 식당' }, steps()[0]);
  assert.match(text, /가게: 월계 식당\n가게 ID: m1/);
  assert.match(text, /필요한 내용: 영업시간, 도로명 주소 입력$/);
  assert.doesNotMatch(text, /메뉴|전화번호/);
  assert.match(readinessRequestText({ id: 'm1', name: '월계 식당' }, steps()[1]), /메뉴 1개 이상 등록/);
  assert.match(readinessRequestText({ id: 'm1', name: '월계 식당' }, steps()[2]), /필요한 내용: 현재 가게의 점주 지정$/);
});

test('점주 보상 업무는 제작기를 기본 화면으로 두고 방문 확인과 운영 결과만 전환한다', async () => {
  const f = await fixture();
  try {
    const buttons = [...f.doc.body.querySelectorAll('[data-merchant-view-target]')];
    assert.deepEqual(buttons.map(button => button.textContent), ['방문 보상 만들기', '방문 확인', '운영 결과']);
    assert.equal(buttons[0].getAttribute('aria-current'), 'page');
    assert.equal(f.doc.getElementById('merchant-creator').classList.contains('merchant-view-hidden'), false);
    assert.equal(f.doc.getElementById('merchant-overview').classList.contains('merchant-view-hidden'), true);
    const claimPanel = f.doc.getElementById('merchant-claim-title').closest('section');
    assert.equal(claimPanel.classList.contains('merchant-view-hidden'), true);

    await f.click(buttons[1]);
    assert.equal(buttons[1].getAttribute('aria-current'), 'page');
    assert.equal(claimPanel.classList.contains('merchant-view-hidden'), false);
    assert.equal(f.doc.getElementById('merchant-creator').classList.contains('merchant-view-hidden'), true);

    await f.click(buttons[2]);
    assert.equal(buttons[2].getAttribute('aria-current'), 'page');
    assert.equal(f.doc.getElementById('merchant-overview').classList.contains('merchant-view-hidden'), false);
    assert.equal(f.doc.getElementById('merchant-reversal').classList.contains('merchant-view-hidden'), false);
    assert.equal(claimPanel.classList.contains('merchant-view-hidden'), true);
  } finally { f.restore(); }
});

test('방문 확인에서 최근 처리 목록으로 바로 이동하며 선택 점포와 초점을 맞춘다', async () => {
  const f = await fixture({ merchants: [
    { id: 'm1', name: '월계 식당', role: 'OWNER' },
    { id: 'm2', name: '두 번째 가게', role: 'OWNER' },
  ] });
  try {
    const claimStore = f.doc.getElementById('merchant-claim-merchant');
    claimStore.value = 'm2';
    await f.click(f.doc.getElementById('merchant-claim-recent'));
    assert.equal(f.doc.getElementById('merchant-reversal-merchant').value, 'm2');
    assert.equal(f.doc.getElementById('merchant-overview-merchant').value, 'm2');
    assert.equal(f.doc.getElementById('merchant-reversal').classList.contains('merchant-view-hidden'), false);
    assert.equal(f.doc.activeElement.id, 'merchant-reversal-title');
    assert.ok(f.calls.some(call => call.path.endsWith('/merchants/m2/recent-visits')));
  } finally { f.restore(); }
});

test('같은 점포에서 쿠폰을 사용한 뒤 최근 처리 바로가기는 새 결과와 되돌리기를 보여준다', async () => {
  const redeemedAt = Date.now();
  const couponState = { redeemed: false, redeemedAt: new Date(redeemedAt).toISOString(),
    undoUntil: new Date(redeemedAt + 10 * 60_000).toISOString() };
  const f = await fixture({ couponState });
  try {
    f.doc.defaultView.confirm = () => true;
    assert.equal(f.doc.getElementById('merchant-reversal-merchant').value, 'm1');
    assert.equal(f.doc.getElementById('merchant-redemption-list').children.length, 0);
    f.doc.getElementById('merchant-claim-token').value = 'customer-qr';
    await f.click(f.doc.getElementById('merchant-claim-resolve'));
    await f.click(f.doc.getElementById('merchant-coupon-lookup'));
    await f.click(f.doc.getElementById('merchant-coupon-list').querySelector('button'));
    assert.equal(couponState.redeemed, true);
    assert.equal(f.doc.getElementById('merchant-redemption-list').children.length, 0);

    await f.click(f.doc.getElementById('merchant-claim-recent'));
    const result = f.doc.getElementById('merchant-redemption-list').children[0];
    assert.match(result.textContent, /음료 1잔.*손님 K7QM/);
    assert.match(result.textContent, /까지 되돌릴 수 있어요/);
    assert.equal(result.querySelector('button').textContent, '사용 되돌리기');
    assert.equal(f.doc.activeElement.id, 'merchant-reversal-title');
    assert.equal(f.calls.filter(call => call.path.endsWith('/recent-coupon-redemptions')).length, 2);
  } finally { f.restore(); }
});

test('보상 업무 HTML은 메뉴·직원·실제 정보 양식을 보조 구역으로 남기되 기본 흐름에 노출하지 않는다', () => {
  const html = readFileSync(new URL('../../apps/production-web/merchant.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../../apps/production-web/assets/production.css', import.meta.url), 'utf8');
  assert.match(html, /id="merchant-owner-nav"[\s\S]*방문 보상 만들기[\s\S]*방문 확인[\s\S]*운영 결과/);
  assert.ok(html.indexOf('id="merchant-reversal"') < html.indexOf('id="merchant-overview"'));
  for (const id of ['merchant-operations', 'merchant-profile', 'real-world-merchant']) {
    assert.match(html, new RegExp(`id="${id}"[^>]*merchant-workflow-secondary`));
  }
  assert.match(css, /\.merchant-view-hidden, \.merchant-workflow-secondary \{ display: none !important; \}/);
});

test('미완료 단계는 실행 하나씩, 점주 부재는 운영 요청으로, 점주만 제작기로 연결한다', async () => {
  const f = await fixture();
  try {
    for (const row of f.rows()) assert.equal(row.querySelectorAll('button, a').length, 1);
    assert.equal(f.rows()[2].querySelector('a'), null);
    assert.equal(f.rows()[2].querySelector('button').textContent, '운영팀에 보낼 내용 복사');
    assert.equal(f.rows()[3].querySelector('button').textContent, '수집품 만들기');
    await f.click(f.rows()[2].querySelector('button'));
    assert.match(f.rows()[2].querySelector('textarea').value, /필요한 내용: 현재 가게의 점주 지정$/);
  } finally { f.restore(); }
  const staff = await fixture({ role: 'STAFF' });
  try {
    assert.equal(staff.rows()[3].querySelector('button').textContent, '운영팀에 보낼 내용 복사');
    assert.equal(staff.rows()[2].querySelector('a'), null);
    await staff.click(staff.rows()[2].querySelector('button'));
    assert.match(staff.rows()[2].querySelector('textarea').value, /현재 가게의 점주 지정/);
  }
  finally { staff.restore(); }
});

test('완료 단계는 실행 버튼을 추가하지 않는다', async () => {
  const data = overview(); data.readiness.steps = steps().map(step => ({ ...step, state: 'DONE' }));
  const f = await fixture({ data });
  try { assert.ok(f.rows().every(row => row.querySelectorAll('button, a').length === 0)); }
  finally { f.restore(); }
});

test('체크리스트 제작 버튼은 선택 점포와 유일한 1·3·5 캠페인으로 제작기를 연다', async () => {
  const f = await fixture({ campaigns: [{ id: 'c1', title: '방문 캠페인', status: 'ACTIVE',
    startsAt: '2026-09-01T00:00:00Z', endsAt: '2099-12-31T00:00:00Z', goals: [1, 3, 5], publication: null }] });
  try {
    await f.click(f.rows()[3].querySelector('button'));
    await settle(30);
    assert.equal(f.doc.getElementById('merchant-creator-store').value, 'm1');
    assert.equal(f.doc.querySelector('[data-control="name"]').value, '월계 식당 방문 수집품');
    assert.equal(f.doc.querySelector('[data-control="campaign"]'), null);
    assert.match(f.doc.querySelector('[data-view="campaign-status"]').textContent, /자동으로 연결/);
    assert.equal(f.doc.querySelector('[data-reward-count]'), null);
    assert.match(f.doc.querySelector('[data-view="reward-grades"]').textContent, /1회 브론즈 · 3회 실버 · 5회 골드/);
    assert.equal(f.doc.activeElement.id, 'merchant-creator-title');
  } finally { f.window.dispatch({ type: 'pagehide' }); f.restore(); }
});

test('/me의 가게 그림은 선택한 점포 제작기에만 전달되고 null이면 시작 버튼이 없다', async () => {
  const artUrl = `/merchant-art/${'a'.repeat(64)}.webp`;
  const f = await fixture({ merchants: [
    { id: 'm1', name: '월계 식당', role: 'OWNER', artUrl: null },
    { id: 'm2', name: '두 번째 가게', role: 'OWNER', artUrl },
  ] });
  try {
    const store = f.doc.getElementById('merchant-creator-store');
    const start = f.doc.getElementById('merchant-creator-open');
    await start.onclick();
    await settle();
    assert.equal(f.doc.querySelector('[data-action="art-photo"]'), null);
    store.value = 'm2';
    store.onchange();
    await start.onclick();
    await settle();
    assert.equal(store.value, 'm2');
    assert.equal(f.doc.querySelector('[data-action="art-photo"]')?.textContent, '가게 그림으로 시작');
    assert.ok(f.calls.some(call => call.path === '/api/web/merchant/merchants/m2/collectible-projects'));
  } finally { f.window.dispatch({ type: 'pagehide' }); f.restore(); }
});

test('클립보드 성공은 라이브 알림과 전송 위치를 보여준다', async () => {
  const copied = [];
  const f = await fixture({ clipboard: { writeText: async text => { copied.push(text); } } });
  try {
    await f.click(f.rows()[0].querySelector('button'));
    assert.match(copied[0], /영업시간, 도로명 주소 입력/);
    const notice = f.rows()[0].querySelector('[role="status"]');
    assert.equal(notice.getAttribute('aria-live'), 'polite');
    assert.match(notice.textContent, /복사했어요.*choijunhuk2007@gmail.com/);
    assert.equal(f.rows()[0].querySelector('label').hidden, true);
    await f.click(f.rows()[2].querySelector('button'));
    assert.match(copied[1], /가게: 월계 식당\n가게 ID: m1/);
    assert.match(copied[1], /필요한 내용: 현재 가게의 점주 지정$/);
    assert.match(f.rows()[2].querySelector('[role="status"]').textContent, /복사했어요/);
  } finally { f.restore(); }
});

for (const clipboard of [{}, { writeText: async () => { throw new Error('denied'); } }]) {
  test('클립보드 부재·거절은 선택 가능한 요청문과 초점을 제공한다', async () => {
    const f = await fixture({ clipboard });
    try {
      await f.click(f.rows()[1].querySelector('button'));
      const fallback = f.rows()[1].querySelector('textarea');
      assert.equal(fallback.readOnly, true);
      assert.equal(f.rows()[1].querySelector('label').hidden, false);
      assert.match(fallback.value, /메뉴 1개 이상 등록/);
      assert.equal(f.doc.activeElement, fallback);
      assert.match(f.rows()[1].querySelector('[role="status"]').textContent, /자동 복사를 사용할 수 없어요/);
    } finally { f.restore(); }
  });
}

test('이번 주 현황은 계약의 방문 건수·등급 순서·쿠폰·열람 횟수와 주의 문구를 표시한다', async () => {
  const f = await fixture();
  try {
    assert.match(f.card('이번 주 처음 확인된 방문 / 다시 확인된 방문').textContent, /2건 \/ 1건/);
    assert.match(f.card('이번 주 처음 확인된 방문 / 다시 확인된 방문').textContent, /사람 수가 아니라 방문 건수/);
    // #412: 앱 기록 기준의 "처음 확인"일 뿐 새 손님이라는 뜻이 아니라고 밝힌다.
    assert.match(f.card('이번 주 처음 확인된 방문 / 다시 확인된 방문').textContent, /MassCOM에서 이 가게 방문이 처음 확인된 건/);
    assert.doesNotMatch(f.card('이번 주 처음 확인된 방문 / 다시 확인된 방문').textContent, /신규 고객|첫 손님/);
    assert.match(f.card('이번 주 받은 수집품(등급별)').textContent, /브론즈 2개골드 1개/);
    assert.match(f.card('쿠폰 발급·사용(이번 주)').textContent, /발급 3장 · 사용 2장/);
    assert.match(f.card('가게 상세 조회(이번 주)').textContent, /12회/);
    assert.match(f.card('가게 상세 조회(이번 주)').textContent, /조회와 방문은 같은 사람으로 연결하지 않아요/);
    assert.equal(f.doc.getElementById('merchant-overview-cards').children.length, 12);
  } finally { f.restore(); }
});

test('빈 집계는 0·빈 상태, 아직 없는 API 필드는 집계 준비 중으로 구분한다', async () => {
  const data = overview(); Object.assign(data, { weekVisitors: { first: 0, repeat: 0 }, weekCollectibles: [], weekCoupons: { issued: 0, redeemed: 0 }, weekDetailViews: 0 });
  const f = await fixture({ data });
  try { assert.match(f.card('이번 주 받은 수집품(등급별)').textContent, /없어요/); assert.match(f.card('가게 상세 조회(이번 주)').textContent, /0회/); }
  finally { f.restore(); }
  for (const key of ['weekVisitors', 'weekCollectibles', 'weekCoupons', 'weekDetailViews']) delete data[key];
  const old = await fixture({ data });
  try { assert.match(old.card('가게 상세 조회(이번 주)').textContent, /집계 준비 중/); }
  finally { old.restore(); }
});

test('잘못된 추가 집계 응답은 숫자 카드로 표시하지 않는다', async () => {
  const data = overview(); data.weekCoupons.issued = -1;
  const f = await fixture({ data });
  try { assert.equal(f.doc.getElementById('merchant-overview-cards').children.length, 0); assert.match(f.doc.getElementById('merchant-overview-status').textContent, /불러오지 못했어요/); }
  finally { f.restore(); }
});

test('늦은 복사 응답은 점포 새로고침 뒤 알림을 되살리지 않는다', async () => {
  let finish;
  const f = await fixture({ clipboard: { writeText: () => new Promise(resolve => { finish = resolve; }) } });
  try {
    const oldRow = f.rows()[0]; oldRow.querySelector('button').dispatchEvent({ type: 'click' });
    await f.click(f.doc.getElementById('merchant-overview-refresh'));
    finish(); await settle();
    assert.equal(oldRow.querySelector('[role="status"]').textContent, '');
    assert.equal(f.rows()[0].querySelector('[role="status"]').textContent, '');
  } finally { f.restore(); }
});
