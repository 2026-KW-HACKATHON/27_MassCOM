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

const photoFile = { type: 'image/png', size: 1000, name: 'shop.png', dataUrl: 'data:image/png;base64,AAAA' };
const sceneFile = { type: 'image/png', size: 1000, name: 'scene.png', dataUrl: 'data:image/png;base64,BBBB' };
const posts = api => api.calls.filter(call => call.method === 'POST').map(call => call.path);

/** 사진·캠페인·보상 연결까지 마친 게시 직전 상태로 만든다. */
async function readyToPublish(ui, { scenes = false } = {}) {
  await ui.upload(photoFile);
  await ui.change('campaign', 'campaign-a');
  const reward = ui.container.querySelector('[data-reward-count="1"]');
  reward.value = 'bronze'; reward.dispatchEvent({ type: 'change' }); await settle();
  if (scenes) {
    await ui.change('story-type', 'wide');
    const files = ui.control('story-files'); files.files = [sceneFile]; files.dispatchEvent({ type: 'change' }); await settle();
  }
}

test('저장하면 서버가 돌려준 project가 새 기준이 되어 저장하지 않은 변경이 남지 않는다', async () => {
  const api = createFakeApi();
  const ui = await mount(api);
  await ui.upload(photoFile);
  assert.equal(ui.dirty, true, '사진을 올린 직후에는 저장하지 않은 변경이 있다');
  await ui.click('draft');
  assert.deepEqual(posts(api), ['/collectible-projects']);
  assert.equal(ui.dirty, false);
  assert.match(ui.notice, /초안을 저장했어요/);
  // 서버가 이미지 바이트를 다시 썼다(#server). 편집기는 그 응답을 기준으로 삼으므로 다음 저장 본문도 그 값을 이어 간다.
  await ui.input('name', '바뀐 이름');
  assert.equal(ui.dirty, true);
  await ui.click('draft');
  const put = api.calls.find(call => call.method === 'PUT');
  assert.equal(put.path, '/collectible-projects/project-1');
  assert.equal(put.body.expectedVersion, 1);
  assert.equal(put.body.project.name, '바뀐 이름');
  assert.match(put.body.project.photo.originalDataUrl, /#server$/);
  assert.equal(ui.dirty, false);
  assert.equal(api.store.get('project-1').version, 2);
});

test('게시한 뒤에도 장면 미리보기 같은 파생 필드 때문에 저장하지 않은 변경이 남지 않는다', async () => {
  const api = createFakeApi();
  const ui = await mount(api);
  await readyToPublish(ui, { scenes: true });
  await ui.click('publish');
  assert.deepEqual(posts(api), ['/collectible-projects', '/collectible-projects/project-1/publish']);
  const publish = api.calls.find(call => call.path.endsWith('/publish'));
  assert.deepEqual(publish.body, { expectedVersion: 1, campaignId: 'campaign-a' });
  const created = api.calls.find(call => call.method === 'POST' && call.path === '/collectible-projects');
  assert.deepEqual(Object.keys(created.body.project.derived), ['bronze', 'silver', 'gold', 'prism']);
  assert.ok(created.body.project.story.frames[0].previewDataUrl, '게시용 장면 미리보기를 함께 보낸다');
  assert.match(ui.notice, /게시했어요/);
  assert.equal(api.store.get('project-1').status, 'PUBLISHED');
  assert.equal(ui.dirty, false, '게시 직후에는 "한 번 더 저장" 경고가 없어야 한다');
});

test('저장하는 동안 새로 편집한 내용은 지키고 한 번 더 저장하게 한다', async () => {
  const api = createFakeApi();
  const ui = await mount(api);
  await ui.upload(photoFile);
  const hold = api.holdNext('POST', /collectible-projects$/);
  const saving = ui.click('draft');
  await settle();
  await ui.input('name', '저장 중에 고친 이름');
  hold.release(); await saving; await settle();
  assert.equal(ui.dirty, true);
  assert.match(ui.container.querySelector('[data-view="save-state"]').textContent, /저장 중 새로 편집한 내용은 한 번 더 저장/);
  assert.equal(ui.control('name').value, '저장 중에 고친 이름');
  await ui.click('draft');
  assert.equal(api.calls.find(call => call.method === 'PUT').body.project.name, '저장 중에 고친 이름');
  assert.equal(ui.dirty, false);
});
