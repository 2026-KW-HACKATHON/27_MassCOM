import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { profileReadOnlyReason, serializeMerchantProfile } from '../../apps/production-web/assets/merchant-profile.mjs';
import { bindMerchant } from '../../apps/production-web/assets/merchant.mjs';
import { installMiniDom, settle } from '../fixtures/mini-dom.mjs';

const merchantHtml = readFileSync(new URL('../../apps/production-web/merchant.html', import.meta.url), 'utf8');
const merchantScript = readFileSync(new URL('../../apps/production-web/assets/merchant.mjs', import.meta.url), 'utf8');
const profileScript = readFileSync(new URL('../../apps/production-web/assets/merchant-profile.mjs', import.meta.url), 'utf8');

test('가게 정보 전송은 허용된 필드만 보내고 공백 메뉴를 버린다', () => {
  const { body, errors } = serializeMerchantProfile({ story: ' 소개 ', businessHours: ' 10:00~20:00 ',
    menuItems: [{ name: ' 국밥 ', price: ' 9000 ' }, { name: ' ', price: '' }], version: 7 });
  assert.deepEqual(errors, { story: '', businessHours: '', menuItems: '' });
  assert.deepEqual(body, { story: '소개', businessHours: '10:00~20:00',
    menuItems: [{ name: '국밥', priceWon: 9000 }], expectedVersion: 7 });
});

test('메뉴 가격·이름·30개 한도를 검사한다', () => {
  const fields = { story: '', businessHours: '', menuItems: [{ name: '', price: '100' }], version: 1 };
  assert.match(serializeMerchantProfile(fields).errors.menuItems, /이름/);
  fields.menuItems = [{ name: '메뉴', price: '1.5' }];
  assert.match(serializeMerchantProfile(fields).errors.menuItems, /가격/);
  fields.menuItems = [{ name: '메뉴', price: '1000000001' }];
  assert.match(serializeMerchantProfile(fields).errors.menuItems, /가격/);
  fields.menuItems = Array.from({ length: 31 }, (_, index) => ({ name: `메뉴 ${index}`, price: '0' }));
  assert.match(serializeMerchantProfile(fields).errors.menuItems, /30개/);
  fields.menuItems = Array.from({ length: 30 }, (_, index) => ({ name: `메뉴 ${index}`, price: '0' }));
  assert.equal(serializeMerchantProfile(fields).errors.menuItems, '');
  fields.menuItems = [{ name: '가'.repeat(200), price: '1000000000' }];
  assert.equal(serializeMerchantProfile(fields).errors.menuItems, '');
  fields.menuItems[0].name += '가';
  assert.match(serializeMerchantProfile(fields).errors.menuItems, /이름/);
});

test('소개와 영업시간은 계약의 글자 수 경계를 그대로 따른다', () => {
  const fields = { story: '가'.repeat(4000), businessHours: '나'.repeat(1000), menuItems: [], version: 1 };
  assert.deepEqual(serializeMerchantProfile(fields).errors, { story: '', businessHours: '', menuItems: '' });
  fields.story += '가'; fields.businessHours += '나';
  const { errors } = serializeMerchantProfile(fields);
  assert.match(errors.story, /4000자/);
  assert.match(errors.businessHours, /1000자/);
});

test('읽기 전용 사유를 점주에게 설명한다', () => {
  assert.equal(profileReadOnlyReason('ROLE'), '가게 정보는 대표 계정만 고칠 수 있어요.');
  assert.equal(profileReadOnlyReason('SHARED_DEMO_STORE'), '시연용 공용 가상 점포는 고칠 수 없어요.');
});

test('안내문과 정보 양식은 자체 스크립트·외부 CSS로 엄격한 CSP를 지킨다', () => {
  assert.match(merchantHtml, /script-src 'self'; style-src 'self'/);
  assert.doesNotMatch(merchantHtml, /\son[a-z]+\s*=|\sstyle\s*=/i);
  assert.match(merchantHtml, /id="merchant-install-poster"/);
  assert.match(merchantHtml, /assets\/install-qr\.png/);
  assert.match(merchantHtml, /방문하면 수집품을 모아요/);
  assert.match(merchantHtml, /① QR로 앱 설치[\s\S]*② 방문 후 직원에게 내 방문 코드 보여 주기[\s\S]*③ 1·3·5번째 방문마다 수집품 받기/);
  assert.match(merchantScript, /textContent = value\.name/);
  assert.match(merchantScript, /'PUT', body/);
  assert.match(profileScript, /expectedVersion/);
  assert.doesNotMatch(merchantScript, /innerHTML\s*=/);
});

const ok = value => ({ ok: true, status: 200, json: async () => value });
const overview = () => ({ generatedAt: '2026-10-04T00:00:00Z', businessDate: '2026-10-04',
  visits: { today: 0, thisWeek: 0, lastWeek: 0, total: 0,
    last7Days: Array.from({ length: 7 }, (_, i) => ({ date: `2026-09-${24 + i}`, count: 0 })) },
  comparison: null, couponsRedeemedThisWeek: 0, repeatVisitors: 0, campaign: null,
  readiness: { message: '', steps: [{ key: 'basic', label: '정보', state: 'DONE', hint: '' }] } });
const profile = (merchantId, version = 1) => ({ merchantId, name: merchantId === 'm1' ? '첫 가게' : '둘째 가게',
  roadAddress: '서울시', story: '소개', businessHours: '09:00', menuItems: [{ name: '차', priceWon: 1000 }],
  version, canEdit: true, readOnlyReason: null });
async function profileFixture(profileRequest) {
  const env = installMiniDom();
  const doc = env.document;
  const createElement = doc.createElement.bind(doc);
  doc.createElement = tag => { const node = createElement(tag); node.style = { setProperty() {} }; return node; };
  doc.body.innerHTML = merchantHtml;
  let printed = 0;
  doc.defaultView.print = () => { printed += 1; };
  const calls = [];
  const fetcher = async (path, options) => {
    calls.push({ path, options });
    if (path.endsWith('/me')) return ok({ accountScope: 'test', merchants: [
      { id: 'm1', name: '첫 가게', role: 'OWNER' }, { id: 'm2', name: '둘째 가게', role: 'OWNER' }] });
    if (path.endsWith('/registration-merchants')) return ok({ merchants: [] });
    if (path.endsWith('/overview')) return ok(overview());
    if (path.endsWith('/recent-visits')) return ok({ businessDate: '2026-10-04', visits: [] });
    if (path.endsWith('/recent-coupon-redemptions')) return ok({ coupons: [] });
    if (path.endsWith('/visitor-feedback')) return ok({ tags: [], suggestions: [], notes: [] });
    if (path.endsWith('/profile')) return profileRequest(path, options);
    throw new Error(`unexpected ${path}`);
  };
  await bindMerchant(fetcher, doc);
  return { ...env, doc, calls, printed: () => printed };
}

test('프로필은 현재 점포 이름을 인쇄하고 버전과 허용 필드만 저장한다', async () => {
  const f = await profileFixture((path, options) => ok(profile('m1', options.method === 'PUT' ? 2 : 1)));
  try {
    assert.equal(f.doc.getElementById('merchant-profile-name').textContent, '첫 가게');
    f.doc.getElementById('merchant-profile-print').dispatchEvent({ type: 'click' });
    assert.equal(f.printed(), 1);
    const story = f.doc.getElementById('merchant-profile-story');
    story.value = ' 새 소개 ';
    story.dispatchEvent({ type: 'input' });
    assert.match(f.doc.getElementById('merchant-profile-dirty').textContent, /저장하지 않은/);
    f.doc.getElementById('merchant-profile-form').dispatchEvent({ type: 'submit', preventDefault() {} });
    await settle();
    const put = f.calls.find(call => call.options.method === 'PUT');
    assert.deepEqual(JSON.parse(put.options.body), { story: '새 소개', businessHours: '09:00',
      menuItems: [{ name: '차', priceWon: 1000 }], expectedVersion: 1 });
    assert.equal(f.doc.getElementById('merchant-profile-dirty').textContent, '');
  } finally { f.restore(); }
});

test('점포 전환 중 늦게 도착한 프로필은 현재 점포를 덮지 않는다', async () => {
  let finishSecond;
  const f = await profileFixture((path, options) => {
    if (path.includes('/m2/')) return new Promise(resolve => { finishSecond = () => resolve(ok(profile('m2'))); });
    return ok(profile('m1'));
  });
  try {
    const select = f.doc.getElementById('merchant-overview-merchant');
    select.value = 'm2'; select.dispatchEvent({ type: 'change' });
    assert.equal(f.doc.getElementById('merchant-poster-name').textContent, '');
    assert.equal(f.doc.getElementById('merchant-profile-print').disabled, true);
    select.value = 'm1'; select.dispatchEvent({ type: 'change' });
    await settle();
    assert.equal(f.doc.getElementById('merchant-poster-name').textContent, '첫 가게');
    finishSecond(); await settle();
    assert.equal(f.doc.getElementById('merchant-poster-name').textContent, '첫 가게');
  } finally { f.restore(); }
});

test('읽기 전용 가게는 값을 보여 주되 수정 요청을 만들지 않는다', async () => {
  const f = await profileFixture(() => ok({ ...profile('m1'), canEdit: false, readOnlyReason: 'SHARED_DEMO_STORE' }));
  try {
    assert.equal(f.doc.getElementById('merchant-profile-story').readOnly, true);
    assert.equal(f.doc.getElementById('merchant-profile-save').hidden, true);
    assert.match(f.doc.getElementById('merchant-profile-read-only').textContent, /공용 가상 점포/);
    f.doc.getElementById('merchant-profile-form').dispatchEvent({ type: 'submit', preventDefault() {} });
    await settle();
    assert.equal(f.calls.filter(call => call.options.method === 'PUT').length, 0);
  } finally { f.restore(); }
});

for (const reloadWorks of [true, false]) {
  test(`409 뒤 재조회 ${reloadWorks ? '성공' : '실패'} 결과를 정확히 알린다`, async () => {
    let reads = 0;
    const f = await profileFixture((path, options) => {
      if (options.method === 'PUT') return { ok: false, status: 409, json: async () => ({ code: 'MERCHANT_PROFILE_VERSION_CONFLICT' }) };
      reads += 1;
      if (reads > 1 && !reloadWorks) return { ok: false, status: 500, json: async () => ({}) };
      return ok(profile('m1', reads));
    });
    try {
      f.doc.getElementById('merchant-profile-form').dispatchEvent({ type: 'submit', preventDefault() {} });
      await settle();
      const status = f.doc.getElementById('merchant-profile-status').textContent;
      if (reloadWorks) {
        assert.match(status, /최신 내용을 불러왔어요/);
        assert.equal(f.doc.getElementById('merchant-profile-retry').hidden, true);
        assert.equal(f.doc.getElementById('merchant-profile-save').disabled, false);
      } else {
        assert.doesNotMatch(status, /최신 내용을 불러왔어요/);
        assert.match(status, /불러오지 못했어요/);
        assert.equal(f.doc.getElementById('merchant-profile-retry').hidden, false);
        assert.equal(f.doc.getElementById('merchant-profile-print').disabled, true);
      }
    } finally { f.restore(); }
  });
}

for (const statusCode of [400, 429]) {
  test(`${statusCode} 저장 오류는 편집 값과 버전을 유지하고 이유를 알린다`, async () => {
    const f = await profileFixture((path, options) => options.method === 'PUT'
      ? { ok: false, status: statusCode, json: async () => ({ code: statusCode === 400 ? 'MERCHANT_PROFILE_INVALID' : 'RATE_LIMITED' }) }
      : ok(profile('m1')));
    try {
      const story = f.doc.getElementById('merchant-profile-story');
      story.value = '새 소개'; story.dispatchEvent({ type: 'input' });
      f.doc.getElementById('merchant-profile-form').dispatchEvent({ type: 'submit', preventDefault() {} });
      await settle();
      assert.equal(story.value, '새 소개');
      assert.match(f.doc.getElementById('merchant-profile-dirty').textContent, /저장하지 않은/);
      assert.equal(f.doc.getElementById('merchant-profile-save').disabled, false);
      if (statusCode === 400) {
        assert.match(f.doc.getElementById('merchant-profile-story-error').textContent, /4000자/);
        assert.equal(story.getAttribute('aria-invalid'), 'true');
      } else assert.match(f.doc.getElementById('merchant-profile-status').textContent, /잠시 뒤/);
    } finally { f.restore(); }
  });
}

for (const [typed, expected] of [['-100', null], ['1.5', null], ['1e3', null], ['1,000', 1000], [' 3000 ', 3000], ['0', 0], ['1,000,000,000', 1000000000], ['1000000001', null]]) {
  test(`가격 원문 ${JSON.stringify(typed)}의 input 뒤 submit은 검증된 값만 전송한다`, async () => {
    const f = await profileFixture(() => ok(profile('m1')));
    try {
      const row = f.doc.getElementById('merchant-profile-menu').children[0];
      const price = row.querySelectorAll('input')[1];
      price.value = typed;
      price.dispatchEvent({ type: 'input', bubbles: true });
      assert.equal(price.value, typed);
      assert.equal(price.getAttribute('pattern'), null);
      f.doc.getElementById('merchant-profile-form').dispatchEvent({ type: 'submit', preventDefault() {} });
      await settle();
      const writes = f.calls.filter(call => call.options.method === 'PUT');
      if (expected === null) {
        assert.equal(writes.length, 0);
        assert.equal(price.value, typed);
        assert.equal(price.getAttribute('aria-invalid'), 'true');
        const error = f.doc.getElementById(price.getAttribute('aria-describedby'));
        assert.match(error.textContent, /가격.*0~1,000,000,000/);
        assert.ok(row.querySelectorAll('span').includes(error));
        price.value = '1000';
        price.dispatchEvent({ type: 'input', bubbles: true });
        f.doc.getElementById('merchant-profile-form').dispatchEvent({ type: 'submit', preventDefault() {} });
        await settle();
        assert.equal(f.calls.filter(call => call.options.method === 'PUT').length, 1);
        assert.equal(price.getAttribute('aria-invalid'), null);
        assert.equal(error.textContent, '');
      } else {
        assert.equal(writes.length, 1);
        assert.equal(JSON.parse(writes[0].options.body).menuItems[0].priceWon, expected);
      }
    } finally { f.restore(); }
  });
}

test('메뉴 추가는 새 이름으로, 삭제는 다음·이전 이름 또는 추가 버튼으로 초점을 옮긴다', async () => {
  const f = await profileFixture(() => ok(profile('m1')));
  try {
    const menu = f.doc.getElementById('merchant-profile-menu');
    const add = f.doc.getElementById('merchant-profile-add-menu');
    const first = menu.children[0];
    const nameOf = row => row.querySelector('input');
    for (let index = 0; index < 2; index += 1) {
      add.focus(); add.dispatchEvent({ type: 'click' });
      assert.ok(f.doc.activeElement === nameOf(menu.children[index + 1]));
    }
    const second = menu.children[1];
    const third = menu.children[2];
    const remove = row => {
      const button = row.querySelector('button');
      button.focus(); button.dispatchEvent({ type: 'click' });
    };
    remove(second);
    assert.ok(f.doc.activeElement === nameOf(third));
    remove(third);
    assert.ok(f.doc.activeElement === nameOf(first));
    remove(first);
    assert.ok(f.doc.activeElement === add);
    assert.equal(menu.children.length, 0);
  } finally { f.restore(); }
});

test('새 상태 안내와 캠페인 안내는 비어 있어도 접근성 트리에서 숨기지 않는다', () => {
  const css = readFileSync(new URL('../../apps/production-web/assets/production.css', import.meta.url), 'utf8');
  const adminHtml = readFileSync(new URL('../../apps/production-web/admin.html', import.meta.url), 'utf8');
  for (const [html, id] of [[merchantHtml, 'merchant-profile-status'], [merchantHtml, 'merchant-profile-dirty'],
    [merchantHtml, 'merchant-campaign-ending'], [adminHtml, 'admin-status']]) {
    assert.match(html, new RegExp(`id="${id}"[^>]*role="status"[^>]*aria-live="polite"`));
    const rule = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, selectors, declarations]) =>
      selectors.split(',').some(selector => selector.trim() === `#${id}:empty`) && /display:\s*block/.test(declarations));
    assert.ok(rule, `${id} needs a visually hidden empty-state rule`);
    assert.match(rule[2], /position:\s*absolute/);
    assert.match(rule[2], /clip-path:\s*inset\(50%\)/);
    assert.doesNotMatch(rule[2], /display:\s*none|visibility:\s*hidden/);
  }
});
