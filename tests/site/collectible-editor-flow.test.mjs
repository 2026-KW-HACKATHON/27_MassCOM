import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { mountCollectibleEditor } from '../../apps/production-web/assets/collectible-editor.mjs';
import { configureCreator, loadCreatorCampaigns } from '../../apps/production-web/assets/merchant.mjs';
import { createProject } from '../../apps/production-web/assets/collectible-model.mjs';
import { createFakeApi } from '../fixtures/collectible-fake-api.mjs';
import { installMiniDom, settle } from '../fixtures/mini-dom.mjs';

let dom, editors;
beforeEach(() => { dom = installMiniDom(); editors = []; });
afterEach(() => { for (const cleanup of editors) cleanup(); dom.restore(); });

/** 편집기를 DOM 대역에 올리고 화면 조작 도우미를 돌려준다. */
async function mount(api, options = {}) {
  const container = document.createElement('div');
  const notices = [];
  const asked = [];
  const cleanup = mountCollectibleEditor(container, {
    merchantId: 'm1', merchantName: '월계 식당', request: api.request, loadCampaigns: api.listCampaigns,
    onNotice: message => notices.push(message), confirm: message => { asked.push(message); return options.confirm ?? true; }, ...options.editor,
  });
  editors.push(cleanup);
  await settle();
  const ui = {
    container, notices, asked, api,
    get notice() { return container.querySelector('[data-view="notice"]').textContent; },
    control: name => container.querySelector(`[data-control="${name}"]`),
    action: name => container.querySelector(`[data-action="${name}"]`),
    async click(name) { ui.action(name).dispatchEvent({ type: 'click' }); await settle(); },
    async change(name, value) { const node = ui.control(name); node.value = value; node.dispatchEvent({ type: 'change' }); await settle(); },
    async input(name, value) { const node = ui.control(name); node.value = value; node.dispatchEvent({ type: 'input' }); await settle(); },
    async upload(file) { const node = ui.control('photo'); node.files = [file]; node.dispatchEvent({ type: 'change' }); await settle(); },
    /** 저장하지 않은 편집이 있으면 beforeunload가 이탈을 막는다. */
    get dirty() { const event = { type: 'beforeunload', returnValue: undefined, preventDefault() { this.prevented = true; } }; dom.window.dispatch(event); return event.prevented === true; },
  };
  return ui;
}

test('캠페인 목록은 점주 전용 API에서 받아 고르고, 공개 /merchants의 id·campaign 없는 응답에 의존하지 않는다', async () => {
  const api = createFakeApi();
  const requested = [];
  const fetcher = async (path, init) => { requested.push(path); return api.fetcher(path, init); };
  // 운영 프록시가 돌려주는 /merchants 모양(id·campaign 없음)을 그대로 확인한다.
  const catalog = await (await api.fetcher('/merchants')).json();
  assert.equal(catalog.merchants.some(item => 'id' in item || 'campaign' in item), false);

  const doc = dom.document;
  const page = doc.createElement('div');
  page.innerHTML = '<section id="merchant-creator" hidden><select id="merchant-creator-store"></select><button id="merchant-creator-open" type="button"></button><div id="merchant-creator-editor"></div></section><p id="merchant-status"></p>';
  doc.body.append(page);
  configureCreator(fetcher, doc, { accountScope: 'scope-a', merchants: [{ id: 'm1', name: '월계 식당', role: 'OWNER' }] });
  doc.getElementById('merchant-creator-store').value = 'm1';
  await doc.getElementById('merchant-creator-open').onclick();
  await settle();

  const select = doc.getElementById('merchant-creator-editor').querySelector('[data-control="campaign"]');
  assert.deepEqual(select.options.map(item => item.value), ['', 'campaign-a', 'campaign-b']);
  assert.equal(select.options[1].textContent, '가상 방문 캠페인');
  assert.equal(requested.includes('/merchants'), false, '제작기가 공개 /merchants를 읽으면 운영에서 캠페인이 비어 버린다');
  assert.ok(requested.includes('/api/web/merchant/merchants/m1/collectible-campaigns'));
  assert.deepEqual((await loadCreatorCampaigns(fetcher, 'm1')).map(item => item.id), ['campaign-a', 'campaign-b']);
});

test('캠페인 목록을 읽지 못하면 이유를 알리고 게시는 막되 편집은 계속한다', async () => {
  const api = createFakeApi();
  api.failNext('GET', /collectible-campaigns$/, { status: 403, code: 'MERCHANT_ACCESS_DENIED' });
  const ui = await mount(api);
  assert.match(ui.notice, /캠페인 목록을 불러오지 못했어요.*점주 권한/);
  assert.deepEqual(ui.control('campaign').options.map(item => item.value), ['']);
});
