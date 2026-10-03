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
async function fixture({ role = 'OWNER', data = overview(), clipboard, campaigns = [] } = {}) {
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
  const fetcher = async (path, options) => {
    calls.push({ path, options });
    if (path.endsWith('/me')) return response({ accountScope: 'local-test', merchants: [merchant] });
    if (path.endsWith('/registration-merchants')) return response({ merchants: [merchant] });
    if (path.endsWith('/overview')) return response(data);
    if (path.endsWith('/recent-visits')) return response({ businessDate: '2026-10-03', visits: [] });
    if (path.endsWith('/recent-coupon-redemptions')) return response({ coupons: [] });
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
});

test('미완료 단계는 실행 하나씩, 직원 이동은 기존 앵커로, 점주만 제작기로 연결한다', async () => {
  const f = await fixture();
  try {
    for (const row of f.rows()) assert.equal(row.querySelectorAll('button, a').length, 1);
    assert.equal(f.rows()[2].querySelector('a').getAttribute('href'), '#merchant-registration-title');
    assert.equal(f.rows()[3].querySelector('button').textContent, '수집품 만들기');
    const row = f.rows()[2], link = row.querySelector('a');
    for (const handler of f.doc.listeners.get('click')) handler({ target: link, button: 0, preventDefault() {} });
    assert.equal(f.doc.activeElement.id, 'merchant-registration-title');
  } finally { f.restore(); }
  const staff = await fixture({ role: 'STAFF' });
  try { assert.equal(staff.rows()[3].querySelector('button').textContent, '운영팀에 보낼 내용 복사'); }
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
    assert.equal(f.doc.querySelector('[data-control="campaign"]').value, 'c1');
    assert.equal(f.doc.activeElement.id, 'merchant-creator-title');
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
    assert.match(f.card('이번 주 첫 방문 / 재방문').textContent, /2건 \/ 1건/);
    assert.match(f.card('이번 주 첫 방문 / 재방문').textContent, /사람 수가 아니라 방문 건수/);
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
