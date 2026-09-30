// Issue #254: 관리자 웹의 점포 동네(행정동)·업종 입력을 가짜 DOM으로 확인한다. 둘은 공개 NFT 메타데이터에 들어가고 공개 조건과는 무관하다.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  loadAdmin, merchantCategories, neighborhoodHint, neighborhoodProblem, publicMetadataNoticeText,
} from '../../apps/production-web/assets/admin.mjs';

function element(tag = 'div') {
  const listeners = new Map();
  return {
    tagName: tag.toUpperCase(), textContent: '', children: [], className: '', attributes: {}, value: '',
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    append(...children) { this.children.push(...children); },
    replaceChildren() { this.children = []; },
    addEventListener(type, callback) { listeners.set(type, callback); },
    async submit() { return listeners.get('submit')?.({ preventDefault() {}, currentTarget: this }); },
    focus() {},
  };
}

const okJson = (value) => ({ ok: true, json: async () => value });
const merchant = { id: 'real-1', name: '월계 김밥', story: '', roadAddress: '서울 노원구 월계로 1', minimumSpendWon: 0,
  menuItems: [{ name: '김밥', priceWon: 4500 }], businessHours: '매일 10:00–20:00', status: 'ACTIVE', demo: false,
  version: 4, consentDocumentRef: 'CS-2609-01', publishedAt: '2026-09-30T00:00:00.000Z', neighborhood: '월계동', category: '분식' };

function adminPage(merchants) {
  const ids = ['admin-status', 'admin-login', 'admin-content', 'admin-merchants', 'admin-create', 'admin-logout',
    'admin-offer-form', 'admin-offers', 'admin-campaign-draft', 'admin-campaign-drafts', 'admin-campaigns'];
  const nodes = Object.fromEntries(ids.map((id) => [id, { ...element(), hidden: true }]));
  nodes['admin-offer-form'].querySelector = () => element('select');
  nodes['admin-campaign-draft'].querySelector = () => element('select');
  const calls = [];
  const doc = { getElementById(id) { return nodes[id]; }, createElement: element,
    defaultView: { confirm: () => true, addEventListener() {},
      FormData: class { constructor(form) { return form.values ?? new Map(); } } } };
  const fetcher = async (path, options = {}) => {
    const method = options.method ?? 'GET';
    calls.push({ path, method, body: options.body === undefined ? undefined : JSON.parse(options.body) });
    if (path === '/api/web/admin/me') return okJson({ admin: true });
    if (path === '/api/web/admin/merchants') return okJson({ merchants });
    if (path.endsWith('/staff')) return okJson({ staff: [] });
    if (path === '/api/web/admin/campaign-drafts') return okJson({ drafts: [] });
    if (path === '/api/web/admin/campaigns') return okJson({ campaigns: [] });
    if (path === '/api/web/admin/reward-offers') return okJson({ offers: [] });
    if (method === 'PATCH') return okJson({ merchant });
    throw new Error(`unexpected ${method} ${path}`);
  };
  return { nodes, doc, fetcher, calls };
}

const findControl = (form, name) => form.children.flatMap((child) => child.children ?? []).find((control) => control.name === name);

test('동네는 서버·DB와 같은 행정동 규칙으로 보내기 전에 확인하고 빈 값은 비우기로 둔다', () => {
  for (const valid of ['월계동', '월계1동', '상계3·4동', '종로1가', '하계리', '', '  ']) {
    assert.equal(neighborhoodProblem(valid), null, valid);
  }
  for (const invalid of ['서울 노원구 월계로 1', '월계로 12', 'Wolgye-dong', '월계', '월계123동', '가나다라마바사아자차동', '월계 동']) {
    assert.match(neighborhoodProblem(invalid), /동네를 확인해 주세요/, invalid);
  }
  assert.match(neighborhoodHint, /행정동/);
  assert.match(neighborhoodHint, /NFT 공개 정보/);
});

test('업종 목록은 서버 규칙·migration 0036의 CHECK 목록과 같다', () => {
  const rules = readFileSync(new URL('../../apps/api/src/merchant-profile-rules.ts', import.meta.url), 'utf8');
  const serverList = /merchantCategories = \[([^\]]+)\]/.exec(rules)[1].match(/'([^']+)'/g).map((item) => item.slice(1, -1));
  const migration = readFileSync(new URL('../../apps/api/migrations/0036_nft_metadata.sql', import.meta.url), 'utf8');
  const sqlList = /category IN \(([^)]+)\)/.exec(migration)[1].match(/'([^']+)'/g).map((item) => item.slice(1, -1));
  assert.deepEqual(merchantCategories, serverList);
  assert.deepEqual(merchantCategories, sqlList);
  assert.match(migration, /neighborhood ~ '\^\[가-힣\]\[가-힣0-9·\]\{0,8\}\[동가리\]\$' AND neighborhood !~ '\[0-9\]\{3\}'/);
});

test('수정 양식은 저장된 동네·업종을 채우고 요청 본문에 함께 보내며, 틀린 동네면 요청하지 않고 안내한다', async () => {
  const page = adminPage([merchant]);
  await loadAdmin(page.fetcher, page.doc);
  const form = page.nodes['admin-merchants'].children[0];
  const neighborhood = findControl(form, 'neighborhood');
  const category = findControl(form, 'category');
  assert.equal(neighborhood.value, '월계동');
  assert.equal(neighborhood.maxLength, 10);
  assert.equal(category.tagName, 'SELECT');
  assert.equal(category.value, '분식');
  assert.deepEqual(category.children.map((option) => option.value), ['', ...merchantCategories]);
  assert.equal(category.children[0].textContent, '선택 안 함');
  // 수정 양식에도 공개·발행 뒤 고정 안내가 있다.
  const notice = form.children.find((child) => child.textContent === publicMetadataNoticeText);
  assert.ok(notice, 'edit form explains that the values become public NFT metadata');
  assert.match(publicMetadataNoticeText, /공개 정보/);
  assert.match(publicMetadataNoticeText, /이미 발행한 NFT에는 발행 때 값이 그대로/);

  const values = { name: '월계 김밥', story: '', roadAddress: '서울 노원구 월계로 1', minimumSpendWon: '0',
    menuItems: '김밥 | 4500', businessHours: '매일 10:00–20:00', neighborhood: ' 월계1동 ', category: '카페' };
  form.values = new Map(Object.entries(values));
  await form.submit();
  const patch = page.calls.find((call) => call.method === 'PATCH');
  assert.equal(patch.path, '/api/web/admin/merchants/real-1');
  assert.equal(patch.body.neighborhood, '월계1동');
  assert.equal(patch.body.category, '카페');
  assert.equal(patch.body.expectedVersion, 4);

  const before = page.calls.length;
  const again = page.nodes['admin-merchants'].children[0];
  again.values = new Map(Object.entries({ ...values, neighborhood: '월계로 12' }));
  await again.submit();
  assert.equal(page.calls.slice(before).some((call) => call.method === 'PATCH'), false);
  assert.match(page.nodes['admin-status'].textContent, /동네를 확인해 주세요/);
});

test('동네·업종이 없는 옛 점포는 빈 칸과 "선택 안 함"으로 보이고 비운 채로 보낸다', async () => {
  const page = adminPage([{ ...merchant, neighborhood: undefined, category: null }]);
  await loadAdmin(page.fetcher, page.doc);
  const form = page.nodes['admin-merchants'].children[0];
  assert.equal(findControl(form, 'neighborhood').value, '');
  assert.equal(findControl(form, 'category').value, '');
  form.values = new Map(Object.entries({ name: '월계 김밥', story: '', roadAddress: '서울', minimumSpendWon: '0',
    menuItems: '', businessHours: '' }));
  await form.submit();
  const patch = page.calls.find((call) => call.method === 'PATCH');
  assert.equal(patch.body.neighborhood, '');
  assert.equal(patch.body.category, '');
});

test('등록 양식 HTML은 동네·업종에 이름표와 안내를 두고 업종은 고정 목록만 고르게 한다', () => {
  const page = readFileSync(new URL('../../apps/production-web/admin.html', import.meta.url), 'utf8');
  const create = /<form id="admin-create" class="admin-panel">([^]*?)<\/form>/.exec(page)[1];
  assert.match(create, /<label>동네\(행정동, 선택\) <input name="neighborhood" maxlength="10" autocomplete="off" aria-describedby="admin-neighborhood-hint"><\/label>/);
  const select = /<select name="category">([^]*?)<\/select>/.exec(create)[1];
  const options = [...select.matchAll(/<option(?: value="")?>([^<]*)<\/option>/g)].map((match) => match[1]);
  assert.deepEqual(options, ['선택 안 함', ...merchantCategories]);
  assert.match(create, /<p id="admin-neighborhood-hint" class="admin-hint">[^<]*공개 조건이 아니며 NFT 공개 정보/);
  for (const control of create.match(/<(?:input|select|textarea)\b[^>]*>/g)) {
    const before = create.slice(0, create.indexOf(control));
    assert.ok(before.lastIndexOf('<label>') > before.lastIndexOf('</label>'), `${control} needs a label`);
  }
});

test('관리자 웹의 동네 정규식은 서버 규칙(merchant-profile-rules.ts)과 글자 그대로 같다', () => {
  const web = readFileSync(new URL('../../apps/production-web/assets/admin.mjs', import.meta.url), 'utf8');
  const server = readFileSync(new URL('../../apps/api/src/merchant-profile-rules.ts', import.meta.url), 'utf8');
  const webPattern = /neighborhoodProblem[^]*?if \(!(\/\^[^\n]*?\$\/)\.test\(neighborhood\)/.exec(web)?.[1];
  const serverPattern = /const neighborhoodPattern = (\/\^[^\n]*?\$\/);/.exec(server)?.[1];
  assert.ok(webPattern && serverPattern, 'both patterns are found');
  assert.equal(webPattern, serverPattern);
  assert.match(web, /\/\[0-9\]\{3\}\/\.test\(neighborhood\)/);
  assert.match(server, /!\/\[0-9\]\{3\}\/\.test\(value\)/);
});

test('캠페인 초안 양식은 캠페인 이름이 공개 NFT 정보에 들어간다고 안내한다', () => {
  const page = readFileSync(new URL('../../apps/production-web/admin.html', import.meta.url), 'utf8');
  const draft = /<form id="admin-campaign-draft" hidden>([^]*?)<\/form>/.exec(page)[1];
  assert.match(draft, /<input name="title" required maxlength="200" aria-describedby="admin-campaign-title-hint">/);
  assert.match(draft, /<p id="admin-campaign-title-hint" class="admin-hint">캠페인 이름은 발행하는 NFT의 공개 정보/);
});
