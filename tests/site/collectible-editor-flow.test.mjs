import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { mountCollectibleEditor } from '../../apps/production-web/assets/collectible-editor.mjs';
import { configureCreator, loadCreatorCampaigns } from '../../apps/production-web/assets/merchant.mjs';
import { createProject } from '../../apps/production-web/assets/collectible-model.mjs';
import { createFakeApi } from '../fixtures/collectible-fake-api.mjs';
import { installMiniDom, settle } from '../fixtures/mini-dom.mjs';
import { draftStorageKey, faceFitCrop } from '../../apps/production-web/assets/collectible-assist.mjs';

let dom, editors;
beforeEach(() => { dom = installMiniDom(); editors = []; });
afterEach(() => { for (const cleanup of editors) cleanup(); dom.restore(); });

/** 화면 조작 도우미: 컨테이너 하나에 올라간 편집기를 클릭·입력·변경으로 다룬다. */
function driver(container, api, notices = [], asked = []) {
  const ui = {
    container, notices, asked, api,
    get notice() { return container.querySelector('[data-view="notice"]').textContent; },
    control: name => container.querySelector(`[data-control="${name}"]`),
    action: name => container.querySelector(`[data-action="${name}"]`),
    // 브라우저는 꺼진 버튼의 클릭을 전달하지 않는다.
    async click(name) { const node = ui.action(name); if (!node.disabled) node.dispatchEvent({ type: 'click' }); await settle(); },
    async change(name, value) { const node = ui.control(name); node.value = value; node.dispatchEvent({ type: 'change' }); await settle(); },
    async input(name, value) { const node = ui.control(name); node.value = value; node.dispatchEvent({ type: 'input' }); await settle(); },
    async upload(file) { const node = ui.control('photo'); node.files = [file]; node.dispatchEvent({ type: 'change' }); await settle(); },
    /** 저장하지 않은 편집이 있으면 beforeunload가 이탈을 막는다. */
    get dirty() { const event = { type: 'beforeunload', returnValue: undefined, preventDefault() { this.prevented = true; } }; dom.window.dispatch(event); return event.prevented === true; },
  };
  return ui;
}

/** 편집기를 DOM 대역에 올린다. */
async function mount(api, options = {}) {
  const container = document.createElement('div');
  const notices = [], asked = [];
  const cleanup = mountCollectibleEditor(container, {
    merchantId: 'm1', merchantName: '월계 식당', request: api.request, loadCampaigns: api.listCampaigns,
    onNotice: message => notices.push(message), confirm: message => { asked.push(message); return options.confirm ?? true; }, ...options.editor,
  });
  editors.push(cleanup);
  await settle();
  return driver(container, api, notices, asked);
}

/** 점주 웹(merchant.mjs)이 fetch로 연결하는 실제 경로로 올린다. 오류 응답의 Retry-After 헤더까지 편집기에 닿는다. */
async function mountViaMerchant(api, { confirm = () => true, merchants = [{ id: 'm1', name: '월계 식당', role: 'OWNER' }], open = true } = {}) {
  const page = document.createElement('div');
  page.innerHTML = '<section id="merchant-creator" hidden><select id="merchant-creator-store"></select><button id="merchant-creator-open" type="button"></button><div id="merchant-creator-editor"></div></section><p id="merchant-status"></p>';
  document.body.append(page);
  const asked = [];
  configureCreator(api.fetcher, document, { accountScope: 'scope-a', merchants }, { confirm: message => { asked.push(message); return confirm(message); } });
  const select = document.getElementById('merchant-creator-store'), host = document.getElementById('merchant-creator-editor');
  select.value = merchants[0].id;
  const openEditor = async () => { await document.getElementById('merchant-creator-open').onclick(); await settle(); };
  if (open) await openEditor();
  const ui = driver(host, api);
  Object.defineProperty(ui, 'status', { get: () => document.getElementById('merchant-status').textContent });
  return Object.assign(ui, { asked, select, host, openEditor, panel: document.getElementById('merchant-creator') });
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

const seeded = (name = '게시 중인 수집품') => createProject({ name });
const cards = ui => ui.container.querySelectorAll('[data-action="open-project"]');
const distribution = ui => ui.container.querySelector('[data-view="distribution"]').textContent;

test('게시 중인 프로젝트는 어느 캠페인에 나가는지 목록·상태에 보이고 열면 게시 중지를 할 수 있다', async () => {
  const api = createFakeApi();
  const published = api.seed(seeded(), { status: 'PUBLISHED', campaignId: 'campaign-a' });
  api.seed(seeded('아직 초안'));
  const ui = await mount(api);
  const labels = [...cards(ui)].map(card => card.textContent);
  assert.match(labels[0], /게시 중인 수집품.*“가상 방문 캠페인” 캠페인에 게시 중/);
  assert.doesNotMatch(labels[1], /캠페인에 게시 중/);
  assert.match(ui.control('project-list').options.map(option => option.textContent).join('|'), /게시 중인 수집품 · 게시 · v2 · “가상 방문 캠페인” 캠페인에 게시 중/);
  await ui.change('project-list', published.id);
  assert.match(distribution(ui), /게시한 버전 · 저장 버전 2 · “가상 방문 캠페인” 캠페인에 게시 중/);
  assert.equal(ui.action('unpublish').disabled, false);
  assert.equal(ui.action('delete').disabled, false);
});

test('게시 중지는 확인을 받고 expectedVersion으로 요청한 뒤 배포 상태를 새로 읽는다', async () => {
  const api = createFakeApi();
  const published = api.seed(seeded(), { status: 'PUBLISHED', campaignId: 'campaign-a' });
  const declined = await mount(api, { confirm: false });
  await declined.change('project-list', published.id);
  await declined.click('unpublish');
  assert.match(declined.asked[0], /“게시 중인 수집품”의 게시를 멈출까요\? “가상 방문 캠페인” 캠페인을 새로 방문하는 손님에게 더 이상 나가지 않아요\. 이미 받은 손님의 수집품은 그대로/);
  assert.equal(api.calls.some(call => call.path.endsWith('/unpublish')), false, '취소하면 요청하지 않는다');
  editors.pop()();

  const ui = await mount(api);
  await ui.change('project-list', published.id);
  await ui.click('unpublish');
  const call = api.calls.find(item => item.path.endsWith('/unpublish'));
  assert.equal(call.path, `/collectible-projects/${published.id}/unpublish`);
  assert.deepEqual(call.body, { expectedVersion: 2 });
  assert.equal(api.campaigns[0].publication, null);
  assert.match(ui.notice, /게시를 멈췄어요\. “가상 방문 캠페인” 캠페인을 새로 방문하는 손님부터/);
  assert.match(distribution(ui), /새 손님에게는 나가지 않아요/);
  assert.equal(ui.action('unpublish').disabled, true, '이미 나가지 않는 버전은 다시 중지할 수 없다');
});

test('게시 중지·삭제 오류는 코드별 문구로 알리고 입력과 버튼을 그대로 둔다', async () => {
  const api = createFakeApi();
  const published = api.seed(seeded(), { status: 'PUBLISHED', campaignId: 'campaign-a' });
  const ui = await mount(api);
  await ui.change('project-list', published.id);
  api.failNext('POST', /unpublish$/, { status: 409, code: 'COLLECTIBLE_VERSION_CONFLICT' });
  await ui.click('unpublish');
  assert.match(ui.notice, /다른 화면에서 초안이 변경됐어요/);
  assert.equal(ui.action('unpublish').disabled, false);
  api.failNext('POST', /delete$/, { status: 429, code: 'COLLECTIBLE_RATE_LIMITED', retryAfterSeconds: 9 });
  await ui.click('delete');
  assert.match(ui.notice, /9초 뒤에 다시 시도해 주세요/);
  assert.equal(api.store.size, 1, '실패하면 지우지 않는다');
  assert.equal(ui.action('delete').disabled, false);
});

test('초안 삭제는 확인을 받고 지운 뒤 편집기를 새 초안으로 되돌린다', async () => {
  const api = createFakeApi();
  const ui = await mount(api);
  await ui.upload(photoFile);
  await ui.input('name', '지울 초안');
  assert.equal(ui.action('delete').disabled, true, '저장하기 전에는 지울 서버 자료가 없다');
  await ui.click('draft');
  assert.match(distribution(ui), /초안 · 저장 버전 1 · 아직 손님에게 나가지 않아요/);
  await ui.input('name', '지울 초안 (고침)');
  await ui.click('delete');
  assert.match(ui.asked[0], /“지울 초안 \(고침\)” 초안을 삭제할까요\? 삭제한 초안은 되돌릴 수 없어요\. 저장하지 않은 편집도 함께 사라져요/);
  const call = api.calls.find(item => item.path.endsWith('/delete'));
  assert.deepEqual(call.body, { expectedVersion: 1 });
  assert.equal(api.store.size, 0);
  assert.equal(ui.control('name').value, '월계 식당 수집품');
  assert.equal(ui.dirty, false);
  assert.equal(ui.action('delete').disabled, true);
  assert.equal(cards(ui).length, 0);
  assert.match(ui.notice, /초안을 삭제했어요/);
});

test('게시한 프로젝트 삭제는 원본이 지워지고 이미 받은 손님의 수집품은 남는다고 확인받는다', async () => {
  const api = createFakeApi();
  const published = api.seed(seeded(), { status: 'PUBLISHED', campaignId: 'campaign-a' });
  const ui = await mount(api);
  await ui.change('project-list', published.id);
  await ui.click('delete');
  assert.match(ui.asked[0], /게시 프로젝트를 삭제할까요\? 새로 방문하는 손님에게 나가는 것을 멈추고, 저장해 둔 원본 사진과 편집 자료를 지워요\. 이미 받은 손님의 수집품은 그대로 남아요/);
  assert.deepEqual(api.calls.find(item => item.path.endsWith('/delete')).body, { expectedVersion: 2 });
  assert.equal(api.campaigns[0].publication, null);
  assert.match(ui.notice, /“가상 방문 캠페인” 캠페인을 새로 방문하는 손님부터 이 수집품이 나가지 않아요/);
  assert.equal(cards(ui).length, 0);
});

const MiB = 1024 * 1024;
const created = api => api.calls.find(call => call.method === 'POST' && call.path === '/collectible-projects')?.body.project;

test('게시용 완성 이미지·썸네일·장면 미리보기는 WebP 0.9로, 효과 마스크는 PNG로 만든다', async () => {
  const api = createFakeApi();
  const ui = await mount(api);
  await readyToPublish(ui, { scenes: true });
  await ui.click('effect-add');
  const grade = ui.container.querySelector('input[data-effect-grade][data-grade="bronze"]');
  grade.checked = true; grade.dispatchEvent({ type: 'change' }); await settle();
  await ui.click('publish');
  const project = created(api), bronze = project.derived.bronze;
  for (const name of ['imageDataUrl', 'baseDataUrl', 'thumbnailDataUrl']) assert.match(bronze[name], /^data:image\/webp;base64,/, name);
  assert.match(project.story.frames[0].previewDataUrl, /^data:image\/webp;base64,/);
  assert.match(bronze.effectMasks.surface, /^data:image\/png;base64,/, '알파가 중요한 마스크는 PNG로 둔다');
  const webp = dom.document.encodes.filter(item => item.type === 'image/webp');
  assert.ok(webp.length >= 13 && webp.every(item => item.quality === .9), 'WebP는 품질 0.9로 인코딩한다');
  assert.ok(webp.some(item => item.width === 160), '썸네일 160px');
  assert.match(ui.notice, /게시했어요/);
});

test('WebP 인코딩을 지원하지 않는 브라우저는 PNG로 게시한다', async () => {
  dom.restore(); dom = installMiniDom({ webp: false });
  const api = createFakeApi();
  const ui = await mount(api);
  await readyToPublish(ui);
  await ui.click('publish');
  assert.match(created(api).derived.bronze.imageDataUrl, /^data:image\/png;base64,/);
  assert.equal(api.store.get('project-1').status, 'PUBLISHED');
});

test('서버 크기 상한을 넘는 완성 이미지·썸네일·본문은 보내기 전에 안내하고 입력을 지킨다', async () => {
  const api = createFakeApi();
  const ui = await mount(api);
  await readyToPublish(ui);
  dom.document.encodedBytes = MiB + 4096;
  await ui.click('publish');
  assert.match(ui.notice, /완성 이미지가 너무 커요/);
  dom.document.encodedBytes = 200 * 1024;
  await ui.click('publish');
  assert.match(ui.notice, /완성 이미지가 너무 커요/, '썸네일은 128 KiB까지');
  assert.equal(posts(api).length, 0, '상한을 넘는 요청은 서버에 보내지 않는다');
  assert.equal(ui.dirty, true);
  dom.document.encodedBytes = 16;

  await ui.upload({ ...photoFile, dataUrl: `data:image/png;base64,${'A'.repeat(9 * MiB)}` });
  await ui.click('draft');
  assert.match(ui.notice, /서버 한도 8 MB를 넘었어요/);
  assert.equal(posts(api).length, 0);
});

test('스티커는 서버와 같은 30개까지 만들 수 있다', async () => {
  const api = createFakeApi();
  const ui = await mount(api);
  for (let index = 0; index < 31; index++) { ui.control('sticker-new').value = `스티커${index}`; ui.action('sticker-add').dispatchEvent({ type: 'click' }); await settle(2); }
  await settle();
  assert.equal(ui.control('sticker-list').options.length, 30);
  assert.match(ui.notice, /스티커는 30개까지 만들 수 있어요/);
});

test('413·429 응답은 원인별 문구와 Retry-After 초를 보여 주고 입력을 지킨다', async () => {
  const api = createFakeApi();
  const ui = await mountViaMerchant(api);
  await ui.upload(photoFile);
  api.failNext('POST', /collectible-projects$/, { status: 429, code: 'COLLECTIBLE_RATE_LIMITED', retryAfterSeconds: 12 });
  await ui.click('draft');
  assert.match(ui.status, /저장·게시 요청이 너무 잦아요.*12초 뒤에 다시 시도해 주세요/);
  assert.equal(ui.dirty, true);
  api.failNext('POST', /collectible-projects$/, { status: 413, code: 'BODY_TOO_LARGE' });
  await ui.click('draft');
  assert.match(ui.status, /수집품 전체 크기가 8 MB를 넘었어요/);
  api.failNext('POST', /collectible-projects$/, { status: 413, code: 'COLLECTIBLE_MEDIA_TOO_LARGE' });
  await ui.click('draft');
  assert.match(ui.status, /원본 사진은 3 MB, 음성은 1 MB·30초/);
  await ui.click('draft');
  assert.match(ui.status, /초안을 저장했어요/);
  assert.equal(ui.dirty, false);
});

test('버전 충돌(409)이면 입력을 지키고 충돌 문구를 보여 주며 버튼을 다시 쓸 수 있다', async () => {
  const api = createFakeApi();
  const ui = await mount(api);
  await ui.upload(photoFile);
  await ui.click('draft');
  await ui.input('name', '충돌 전에 고친 이름');
  api.failNext('PUT', /project-1$/, { status: 409, code: 'COLLECTIBLE_VERSION_CONFLICT' });
  await ui.click('draft');
  assert.match(ui.notice, /다른 화면에서 초안이 변경됐어요\. 현재 입력은 유지했어요/);
  assert.equal(ui.control('name').value, '충돌 전에 고친 이름');
  assert.equal(ui.dirty, true);
  assert.equal(ui.action('draft').disabled, false);
  assert.equal(ui.action('publish').disabled, false);
  assert.equal(api.store.get('project-1').version, 1, '충돌한 저장은 서버 버전을 올리지 않는다');
  await ui.click('draft');
  assert.match(ui.notice, /초안을 저장했어요/);
  assert.equal(api.store.get('project-1').project.name, '충돌 전에 고친 이름');
});

test('게시가 캠페인 문제로 거절돼도 저장된 초안은 남고 다시 게시할 수 있다', async () => {
  const api = createFakeApi();
  const ui = await mount(api);
  await readyToPublish(ui);
  api.failNext('POST', /publish$/, { status: 409, code: 'COLLECTIBLE_CAMPAIGN_UNAVAILABLE' });
  await ui.click('publish');
  assert.match(ui.notice, /선택한 캠페인에는 지금 게시할 수 없어요/);
  assert.equal(api.store.get('project-1').status, 'DRAFT');
  assert.equal(ui.dirty, true, '게시하지 못했으니 편집 상태를 지킨다');
  await ui.click('publish');
  assert.match(ui.notice, /게시했어요/);
  assert.deepEqual(api.calls.filter(call => call.method !== 'GET').map(call => `${call.method} ${call.path}`), [
    'POST /collectible-projects', 'POST /collectible-projects/project-1/publish',
    'PUT /collectible-projects/project-1', 'POST /collectible-projects/project-1/publish',
  ], '두 번째 게시는 같은 초안을 덮어쓴 뒤 게시한다');
  assert.equal(api.store.get('project-1').status, 'PUBLISHED');
});

test('게시 직전에 캠페인 목록을 다시 읽어 끝난 캠페인은 보내기 전에 막는다', async () => {
  const api = createFakeApi();
  const ui = await mount(api);
  await readyToPublish(ui);
  api.campaigns.splice(0, 1);
  await ui.click('publish');
  assert.match(ui.notice, /선택한 캠페인은 지금 게시할 수 없어요/);
  assert.equal(posts(api).length, 0);
  assert.deepEqual(ui.control('campaign').options.map(item => item.value), ['', 'campaign-b']);
});

test('캠페인을 바꾸면 그 캠페인에 없는 방문 목표의 수집품 연결은 풀고 보여 주지 않는다', async () => {
  const api = createFakeApi();
  const ui = await mount(api);
  await ui.change('campaign', 'campaign-a');
  assert.equal(ui.container.querySelectorAll('[data-reward-count]').length, 3);
  const five = ui.container.querySelector('[data-reward-count="5"]');
  five.value = 'gold'; five.dispatchEvent({ type: 'change' }); await settle();
  await ui.change('campaign', 'campaign-b');
  assert.deepEqual(ui.container.querySelectorAll('[data-reward-count]').map(node => node.dataset.rewardCount), ['1', '3']);
  assert.match(ui.notice, /캠페인에 없는 방문 목표\(5회\)의 수집품 연결은 풀었어요/);
});

test('게시한 프로젝트를 고쳐 저장하면 먼저 새 초안으로 복사하고 그 초안에 이어 저장한다', async () => {
  const api = createFakeApi();
  const published = api.seed(seeded(), { status: 'PUBLISHED', campaignId: 'campaign-a' });
  const ui = await mount(api);
  await ui.change('project-list', published.id);
  await ui.input('name', '수정한 이름');
  await ui.click('draft');
  const writes = api.calls.filter(call => call.method !== 'GET').map(call => `${call.method} ${call.path} ${JSON.stringify(call.body?.expectedVersion)}`);
  const draftId = api.calls.find(call => call.method === 'PUT').path.split('/').pop();
  assert.notEqual(draftId, published.id);
  assert.deepEqual(writes, [`POST /collectible-projects/${published.id}/copy 2`, `PUT /collectible-projects/${draftId} 1`]);
  assert.equal(api.store.get(published.id).status, 'PUBLISHED', '게시 버전은 그대로');
  assert.equal(api.store.get(published.id).project.name, '게시 중인 수집품');
  const draft = [...api.store.values()].find(item => item.id !== published.id);
  assert.equal(draft.project.name, '수정한 이름');
  assert.equal(ui.dirty, false);
  assert.match(distribution(ui), /초안 · 저장 버전 2/);
  await ui.input('name', '한 번 더');
  await ui.click('draft');
  assert.equal(api.calls.filter(call => call.method === 'PUT').at(-1).body.expectedVersion, 2, '복사본에 이어 저장한다');
  assert.equal(api.store.size, 2);
});

test('시즌 복사는 서버에 새 초안을 만들고 캠페인·보상 연결을 비운 채 그 초안으로 이어 간다', async () => {
  const api = createFakeApi();
  const ui = await mount(api);
  await readyToPublish(ui);
  await ui.click('draft');
  await ui.click('copy');
  const copy = api.calls.find(call => call.path.endsWith('/copy'));
  assert.deepEqual(copy.body, { expectedVersion: 1 });
  assert.equal(ui.control('name').value, '월계 식당 수집품 · 시즌 복사');
  assert.equal(ui.control('campaign').value, '');
  assert.equal(ui.container.querySelector('[data-reward-count="1"]').value, '');
  assert.equal(ui.dirty, true, '복사본의 이름·연결을 바꿨으니 저장해야 한다');
  await ui.click('draft');
  const put = api.calls.filter(call => call.method === 'PUT').at(-1);
  assert.notEqual(put.path, '/collectible-projects/project-1', '원래 초안이 아니라 복사본에 저장한다');
  assert.equal(put.body.expectedVersion, 1);
  assert.equal(put.body.project.campaignId, '');
  assert.equal(api.store.get('project-1').project.name, '월계 식당 수집품', '원래 초안은 그대로');
});

test('시즌 복사가 거절되면 현재 입력과 저장 대상을 바꾸지 않는다', async () => {
  const api = createFakeApi();
  const ui = await mount(api);
  await ui.upload(photoFile);
  await ui.click('draft');
  api.failNext('POST', /copy$/, { status: 409, code: 'COLLECTIBLE_PROJECT_LIMIT' });
  await ui.click('copy');
  assert.match(ui.notice, /점포마다 100개까지/);
  assert.equal(ui.control('name').value, '월계 식당 수집품');
  assert.equal(ui.dirty, false);
  await ui.input('name', '복사 실패 뒤 저장');
  await ui.click('draft');
  assert.equal(api.calls.filter(call => call.method === 'PUT').at(-1).path, '/collectible-projects/project-1');
});

test('저장하지 않은 편집이 있으면 새 초안을 시작하기 전에 묻고, 거절하면 편집과 되돌리기를 그대로 둔다', async () => {
  const api = createFakeApi();
  const ui = await mount(api, { confirm: false });
  await ui.upload(photoFile);
  await ui.input('name', '버리면 안 되는 이름');
  await ui.click('new');
  assert.match(ui.asked[0], /저장하지 않은 편집이 있어요\. 지금 새로 시작하거나 다른 프로젝트를 열면 사라져요/);
  assert.equal(ui.control('name').value, '버리면 안 되는 이름', '거절하면 편집이 남는다');
  assert.equal(ui.dirty, true);
  assert.equal(ui.notice.includes('새 초안을 시작했어요'), false, '거절했으니 새 초안으로 바뀌지 않는다');
  await ui.click('undo');
  assert.equal(ui.control('name').value, '월계 식당 수집품', '거절 뒤에도 되돌리기가 그대로 동작한다');
});

test('저장하지 않은 편집이 있어도 수락하면 새 초안을 시작한다', async () => {
  const api = createFakeApi();
  const ui = await mount(api, { confirm: true });
  await ui.upload(photoFile);
  await ui.input('name', '버려도 되는 이름');
  await ui.click('new');
  assert.equal(ui.asked.length, 1);
  assert.equal(ui.control('name').value, '월계 식당 수집품', '수락하면 새 초안으로 바뀐다');
  assert.equal(ui.dirty, false);
  assert.match(ui.notice, /새 초안을 시작했어요/);
});

test('저장하지 않은 편집이 있으면 저장한 프로젝트를 열기 전에 묻고, 거절하면 편집을 그대로 둔다', async () => {
  const api = createFakeApi();
  const published = api.seed(seeded(), { status: 'PUBLISHED', campaignId: 'campaign-a' });
  const ui = await mount(api, { confirm: false });
  await ui.upload(photoFile);
  await ui.input('name', '지금 편집 중');
  await ui.change('project-list', published.id);
  assert.match(ui.asked[0], /저장하지 않은 편집이 있어요\. 지금 새로 시작하거나 다른 프로젝트를 열면 사라져요/);
  assert.equal(ui.control('name').value, '지금 편집 중', '거절하면 편집이 남는다');
  assert.equal(ui.control('project-list').value, '', '거절하면 목록 선택도 지금 편집 중인 새 초안으로 돌아온다');
  assert.equal(ui.dirty, true);
  assert.equal(api.calls.some(call => call.path === `/collectible-projects/${published.id}`), false, '거절했으니 열지 않았다');
});

test('저장하지 않은 편집이 있어도 수락하면 저장한 프로젝트를 연다', async () => {
  const api = createFakeApi();
  const published = api.seed(seeded(), { status: 'PUBLISHED', campaignId: 'campaign-a' });
  const ui = await mount(api, { confirm: true });
  await ui.upload(photoFile);
  await ui.change('project-list', published.id);
  assert.equal(ui.asked.length, 1);
  assert.match(distribution(ui), /게시한 버전/);
});

test('카드로 저장한 프로젝트를 열 때도 저장하지 않은 편집이 있으면 묻고, 거절하면 그대로 둔다', async () => {
  const api = createFakeApi();
  const published = api.seed(seeded(), { status: 'PUBLISHED', campaignId: 'campaign-a' });
  const ui = await mount(api, { confirm: false });
  await ui.upload(photoFile);
  cards(ui)[0].dispatchEvent({ type: 'click' });
  await settle();
  assert.equal(ui.asked.length, 1);
  assert.equal(ui.dirty, true);
  assert.equal(api.calls.some(call => call.path === `/collectible-projects/${published.id}`), false, '거절했으니 열지 않았다');
});

test('고친 것이 없으면 새 초안 시작·프로젝트 열기는 묻지 않는다', async () => {
  const api = createFakeApi();
  const published = api.seed(seeded(), { status: 'PUBLISHED', campaignId: 'campaign-a' });
  const ui = await mount(api, { confirm: false });
  await ui.click('new');
  assert.equal(ui.asked.length, 0);
  await ui.change('project-list', published.id);
  assert.equal(ui.asked.length, 0);
  assert.match(distribution(ui), /게시한 버전/);
});

const owner = (id, name) => ({ id, name, role: 'OWNER' });

test('저장하지 않은 편집이 있으면 제작기를 다시 열기 전에 묻고, 거절하면 편집을 그대로 둔다', async () => {
  const api = createFakeApi();
  const declined = await mountViaMerchant(api, { confirm: () => false });
  await declined.input('name', '아직 저장 안 한 이름');
  await declined.openEditor();
  assert.match(declined.asked[0], /저장하지 않은 편집이 있어요\. 지금 제작기를 다시 열거나 다른 점포로 바꾸면 사라져요/);
  assert.equal(declined.control('name').value, '아직 저장 안 한 이름', '거절하면 편집이 남는다');
  assert.equal(api.calls.filter(call => call.path === '/collectible-projects' && call.method === 'GET').length, 1, '다시 열지 않았다');
});

test('저장하지 않은 편집이 있어도 수락하면 새 제작기를 연다', async () => {
  const api = createFakeApi();
  const accepted = await mountViaMerchant(api, { confirm: () => true });
  await accepted.input('name', '버려도 되는 편집');
  await accepted.openEditor();
  assert.equal(accepted.asked.length, 1);
  assert.equal(accepted.control('name').value, '월계 식당 수집품', '수락하면 새 제작기가 열린다');
});

test('저장한 뒤나 고친 것이 없으면 묻지 않고 다시 연다', async () => {
  const api = createFakeApi();
  const ui = await mountViaMerchant(api, { confirm: () => false });
  await ui.openEditor();
  await ui.upload(photoFile);
  await ui.click('draft');
  await ui.openEditor();
  assert.equal(ui.asked.length, 0);
});

test('저장하지 않은 편집이 있을 때 점포를 바꾸면 묻고, 거절하면 점포 선택을 되돌리며 수락하면 제작기를 닫는다', async () => {
  const api = createFakeApi();
  const merchants = [owner('m1', '월계 식당'), owner('m2', '두 번째 식당')];
  const ui = await mountViaMerchant(api, { confirm: () => false, merchants });
  await ui.input('name', '바꾸기 전 편집');
  ui.select.value = 'm2'; ui.select.onchange();
  assert.equal(ui.asked.length, 1);
  assert.equal(ui.select.value, 'm1', '거절하면 열려 있는 점포로 되돌린다');
  assert.ok(ui.host.children.length > 0);
  assert.equal(ui.control('name').value, '바꾸기 전 편집');
});

test('점포를 바꾸기로 수락하면 열려 있던 제작기를 닫는다', async () => {
  const api = createFakeApi();
  const merchants = [owner('m1', '월계 식당'), owner('m2', '두 번째 식당')];
  const accepting = await mountViaMerchant(api, { confirm: () => true, merchants });
  await accepting.input('name', '버릴 편집');
  accepting.select.value = 'm2'; accepting.select.onchange();
  assert.equal(accepting.host.children.length, 0, '점포를 바꾸기로 했으면 제작기를 닫는다');
});

test('점주가 아닌 계정은 제작기 패널을 보지 못하고, 점주 점포만 고를 수 있다', async () => {
  const api = createFakeApi();
  const staffOnly = await mountViaMerchant(api, { merchants: [{ id: 'm1', name: '월계 식당', role: 'STAFF' }], open: false });
  assert.equal(staffOnly.panel.hidden, true);
  const mixed = await mountViaMerchant(api, { merchants: [{ id: 'm1', name: '직원 점포', role: 'STAFF' }, owner('m2', '내 점포')], open: false });
  assert.equal(mixed.panel.hidden, false);
  assert.deepEqual(mixed.select.options.map(option => option.value), ['m2']);
  const granted = await mountViaMerchant(api, { merchants: [{ id: 'm1', name: '직원 점포', role: 'STAFF', canManageArt: true }], open: false });
  assert.equal(granted.panel.hidden, false, '서버가 권한을 알리면 따른다');
});

test('목록이 403이면 제작기를 닫고 권한 안내를 보인다', async () => {
  const api = createFakeApi();
  api.failNext('GET', /collectible-projects$/, { status: 403, code: 'MERCHANT_ACCESS_DENIED' });
  const ui = await mountViaMerchant(api);
  assert.equal(ui.host.children.length, 0);
  assert.match(ui.status, /이 점포의 그림 제작 권한이 없어요\. 점주 권한을 확인해 주세요/);
  assert.equal(ui.panel.hidden, false, '점주 계정의 일시적인 403이면 다시 열 수 있다');
});

test('이미 게시했고 고친 것이 없으면 게시 버튼을 막고, 고치면 다시 켠다', async () => {
  const api = createFakeApi();
  const ui = await mount(api);
  await readyToPublish(ui);
  assert.equal(ui.action('publish').disabled, false);
  await ui.click('publish');
  assert.equal(ui.action('publish').disabled, true, '게시 직후 같은 내용을 다시 게시하면 게시 버전만 늘어난다');
  assert.match(ui.action('publish').title, /이미 게시한 버전/);
  await ui.click('publish');
  assert.equal(api.calls.filter(call => call.path.endsWith('/publish')).length, 1);
  await ui.input('name', '고친 이름');
  assert.equal(ui.action('publish').disabled, false);
  assert.equal(ui.action('draft').disabled, false);
});

test('게시한 프로젝트를 열면 게시 버튼이 막혀 있다', async () => {
  const api = createFakeApi();
  const published = api.seed(seeded(), { status: 'PUBLISHED', campaignId: 'campaign-a' });
  const ui = await mount(api);
  await ui.change('project-list', published.id);
  assert.equal(ui.action('publish').disabled, true);
  await ui.input('name', '고침');
  assert.equal(ui.action('publish').disabled, false);
});

test('게시한 뒤에는 캠페인 목록을 새로 읽어 배포 연결 변화를 보이게 한다', async () => {
  const api = createFakeApi();
  const ui = await mount(api);
  await readyToPublish(ui);
  const before = api.calls.filter(call => call.path.endsWith('/collectible-campaigns')).length;
  await ui.click('publish');
  const reads = api.calls.filter(call => call.path.endsWith('/collectible-campaigns')).length;
  assert.equal(reads - before, 2, '게시 직전 검증용 조회 1번과 게시 뒤 새로 읽기 1번');
  assert.match(ui.notice, /게시했어요/);
  assert.equal(api.campaigns[0].publication.projectId, 'project-1');
});

// Issue #282: 자동 저장(A1)·등급 전체 선택(A2)·재질 충돌 안내(A8)·자동 맞춤(A4).
const readDraft = (win, merchantId, accountMarker) => { const raw = win.localStorage.getItem(draftStorageKey(merchantId, accountMarker)); return raw ? JSON.parse(raw) : null; };

test('편집이 멈추면 기기에 자동 저장하고, 서버 저장이 끝나면 지운다(A1)', async () => {
  const api = createFakeApi();
  const ui = await mount(api, { editor: { autosaveDelayMs: 5 } });
  await ui.upload(photoFile);
  await ui.input('name', '자동 저장 확인');
  await settle(10);
  const draft = readDraft(dom.window, 'm1', 'anon');
  assert.ok(draft, '편집이 멈추면 기기에 저장된다');
  assert.equal(draft.project.name, '자동 저장 확인');
  assert.equal(draft.merchantId, 'm1');
  assert.equal(draft.wrapperId, null, '서버에 저장하기 전이며, 서버 저장을 주장하지 않는다');
  await ui.click('draft');
  assert.equal(readDraft(dom.window, 'm1', 'anon'), null, '서버 저장이 끝나면 기기 보관본을 지운다');
});

test('사진이 커서 기기 저장 용량(4MB)을 넘으면 편집만 저장하고 사진은 다시 선택해야 한다고 남긴다(A1)', async () => {
  const api = createFakeApi();
  const ui = await mount(api, { editor: { autosaveDelayMs: 5 } });
  await ui.upload({ ...photoFile, dataUrl: `data:image/png;base64,${'A'.repeat(6 * MiB)}` });
  await settle(10);
  const draft = readDraft(dom.window, 'm1', 'anon');
  assert.equal(draft.mediaOmitted, true);
  assert.equal(draft.project.photo.originalDataUrl, '');
});

test('서버 버전보다 새로운 기기 보관본이 있으면 다시 열 때 이어서 할지 묻고, 수락하면 복원한다(A1)', async () => {
  const api = createFakeApi();
  const ui = await mount(api, { editor: { autosaveDelayMs: 5 } });
  await ui.upload(photoFile);
  await ui.input('name', '복원할 이름');
  await settle(10);
  editors.pop()();

  const restored = await mount(api, { confirm: true });
  assert.match(restored.asked[0], /저장하지 않은 편집을 이어서 할까요\?/);
  assert.equal(restored.control('name').value, '복원할 이름');
  assert.equal(restored.dirty, true);
  assert.match(restored.notice, /이어서 열었어요/);
});

test('기기 보관본 복원을 거절하면 지우고 새 편집으로 시작한다(A1)', async () => {
  const api = createFakeApi();
  const ui = await mount(api, { editor: { autosaveDelayMs: 5 } });
  await ui.upload(photoFile);
  await ui.input('name', '거절할 이름');
  await settle(10);
  editors.pop()();

  const declined = await mount(api, { confirm: false });
  assert.equal(declined.control('name').value, '월계 식당 수집품');
  assert.equal(readDraft(dom.window, 'm1', 'anon'), null);
});

test('명시적으로 새 초안을 시작하거나 삭제하면 기기 보관본도 함께 지운다(A1)', async () => {
  const api = createFakeApi();
  const ui = await mount(api, { editor: { autosaveDelayMs: 5 }, confirm: true });
  await ui.upload(photoFile);
  await settle(10);
  assert.ok(readDraft(dom.window, 'm1', 'anon'));
  await ui.click('new');
  assert.equal(readDraft(dom.window, 'm1', 'anon'), null, '명시적 새 초안 시작은 기기 보관본을 지운다');

  const published = api.seed(seeded('삭제할 프로젝트'), { status: 'PUBLISHED', campaignId: 'campaign-a' });
  await ui.click('refresh');
  await ui.change('project-list', published.id);
  await ui.input('name', '삭제 전 편집');
  await settle(10);
  assert.ok(readDraft(dom.window, 'm1', 'anon'));
  await ui.click('delete');
  assert.equal(readDraft(dom.window, 'm1', 'anon'), null, '삭제가 끝나면 기기 보관본을 지운다');
});

test('사생활 보호 모드처럼 저장 공간 접근이 막혀도 편집과 저장은 그대로 된다(A1)', async () => {
  dom.restore(); dom = installMiniDom({ storageThrows: true });
  const api = createFakeApi();
  const ui = await mount(api, { editor: { autosaveDelayMs: 5 } });
  await ui.upload(photoFile);
  await ui.input('name', '저장 공간 없이도 편집');
  await settle(10);
  assert.equal(ui.control('name').value, '저장 공간 없이도 편집');
  await ui.click('draft');
  assert.match(ui.notice, /초안을 저장했어요/);
});

test('효과의 적용 등급 전체 선택·해제는 미리보기 등급을 바꾸지 않고 한 번의 되돌리기로 남는다(A2)', async () => {
  const api = createFakeApi();
  const ui = await mount(api);
  await ui.click('effect-add');
  const effectId = ui.container.querySelector('[data-effect-strength]').dataset.effectStrength;
  const captionBefore = ui.container.querySelector('[data-view="preview-caption"]').textContent;
  ui.container.querySelector(`[data-action="effect-grade-all"][data-id="${effectId}"]`).dispatchEvent({ type: 'click' });
  await settle();
  const enabledCount = ui.container.querySelectorAll('[data-grade-enabled]').length;
  const checks = () => ui.container.querySelectorAll(`[data-effect-grade="${effectId}"]`);
  assert.equal(checks().length, enabledCount);
  assert.equal([...checks()].every(box => box.checked), true, '전체 선택은 사용 중인 등급을 모두 켠다');
  assert.equal(ui.container.querySelector('[data-view="preview-caption"]').textContent, captionBefore, '미리보기 등급은 바뀌지 않는다');
  ui.container.querySelector(`[data-action="effect-grade-none"][data-id="${effectId}"]`).dispatchEvent({ type: 'click' });
  await settle();
  assert.equal([...checks()].some(box => box.checked), false, '전체 해제는 모두 끈다');
  assert.match(ui.container.querySelector(`[data-effect-grade="${effectId}"]`).closest('fieldset').textContent, /현재 어느 등급에도 적용하지 않아요/);
  await ui.click('undo');
  assert.equal([...checks()].every(box => box.checked), true, '전체 해제는 undo 한 번으로 되돌아간다(한 단계)');
});

test('동작의 적용 등급 전체 선택·해제는 다른 동작과 배타적으로 동작한다(A2)', async () => {
  const api = createFakeApi();
  const ui = await mount(api);
  ui.container.querySelector('[data-action="motion-grade-all"][data-id="rotate"]').dispatchEvent({ type: 'click' });
  await settle();
  const enabledCount = ui.container.querySelectorAll('[data-grade-enabled]').length;
  const rotateChecks = () => ui.container.querySelectorAll('[data-motion-grade="rotate"]');
  assert.equal(rotateChecks().length, enabledCount);
  assert.equal([...rotateChecks()].every(box => box.checked), true);
  ui.container.querySelector('[data-action="motion-grade-none"][data-id="rotate"]').dispatchEvent({ type: 'click' });
  await settle();
  assert.equal([...rotateChecks()].some(box => box.checked), false);
});

const setEffectTarget = (ui, target) => { ui.control('effect-type').value = target.type; ui.control('effect-type').dispatchEvent({ type: 'change' }); };
const addMaterial = async (ui, type, excludeId) => {
  setEffectTarget(ui, { type });
  await ui.click('effect-add');
  return [...ui.container.querySelectorAll('[data-effect-strength]')].map(node => node.dataset.effectStrength).find(id => id !== excludeId);
};
const toggle = async (ui, effectId, gradeId, value) => {
  const box = ui.container.querySelector(`[data-effect-grade="${effectId}"][data-grade="${gradeId}"]`);
  box.checked = value; box.dispatchEvent({ type: 'change' }); await settle();
};

test('같은 곳의 배타 재질(무광·에나멜·유리)을 겹쳐 켜면 조용히 섞지 않고 확인 뒤 바꾼다(A8)', async () => {
  const api = createFakeApi();
  const ui = await mount(api, { confirm: true });
  const enamelId = await addMaterial(ui, 'enamel');
  await toggle(ui, enamelId, 'bronze', true);
  const matteId = await addMaterial(ui, 'matte', enamelId);
  await toggle(ui, matteId, 'bronze', true);
  assert.match(ui.asked.at(-1), /^무광과 에나멜은 같은 곳에 함께 쓸 수 없어요\. 에나멜을 끄고 무광을 켤까요\?$/);
  assert.equal(ui.container.querySelector(`[data-effect-grade="${matteId}"][data-grade="bronze"]`).checked, true, '수락하면 새 재질이 켜진다');
  assert.equal(ui.container.querySelector(`[data-effect-grade="${enamelId}"][data-grade="bronze"]`).checked, false, '수락하면 기존 재질은 꺼진다');
  assert.equal(ui.notice, '무광 재질로 바꿨어요. 같은 곳의 에나멜은 껐어요.');
});

test('재질 충돌 확인을 거절하면 체크를 되돌리고 기존 재질을 그대로 둔다(A8)', async () => {
  const api = createFakeApi();
  const ui = await mount(api, { confirm: false });
  const enamelId = await addMaterial(ui, 'enamel');
  await toggle(ui, enamelId, 'bronze', true);
  const matteId = await addMaterial(ui, 'matte', enamelId);
  await toggle(ui, matteId, 'bronze', true);
  assert.equal(ui.container.querySelector(`[data-effect-grade="${matteId}"][data-grade="bronze"]`).checked, false, '거절하면 새 재질은 켜지지 않는다');
  assert.equal(ui.container.querySelector(`[data-effect-grade="${enamelId}"][data-grade="bronze"]`).checked, true, '기존 재질은 그대로 남는다');
  assert.match(ui.notice, /다른 등급에 적용하거나 먼저 기존 재질을 꺼 주세요/);
});

test('메탈릭·펄·홀로그램·발광은 같은 등급·대상에 함께 켜도 충돌로 막지 않는다(A8)', async () => {
  const api = createFakeApi();
  const ui = await mount(api, { confirm: () => { throw new Error('충돌 확인을 묻지 않아야 한다'); } });
  const metallicId = await addMaterial(ui, 'metallic');
  await toggle(ui, metallicId, 'bronze', true);
  const pearlId = await addMaterial(ui, 'pearl', metallicId);
  await toggle(ui, pearlId, 'bronze', true);
  assert.equal(ui.container.querySelector(`[data-effect-grade="${metallicId}"][data-grade="bronze"]`).checked, true);
  assert.equal(ui.container.querySelector(`[data-effect-grade="${pearlId}"][data-grade="bronze"]`).checked, true);
});

test('사진을 올리기 전에는 자동 맞춤을 막는다(A4)', async () => {
  const api = createFakeApi();
  const ui = await mount(api);
  await ui.click('auto-fit');
  assert.match(ui.notice, /먼저 사진을 올려 주세요/);
});

test('얼굴 감지가 되면 얼굴 기준으로 맞추고 방법을 안내한다(A4, 합성 얼굴 상자)', async () => {
  const api = createFakeApi();
  const ui = await mount(api);
  await ui.upload(photoFile);
  const box = { x: 0.4, y: 0.3, width: 1.2, height: 1.2 };
  globalThis.FaceDetector = class { async detect() { return [{ boundingBox: box }]; } };
  try { await ui.click('auto-fit'); } finally { delete globalThis.FaceDetector; }
  const expected = faceFitCrop(2, 2, box);
  assert.match(ui.notice, /얼굴 기준으로 맞췄어요/);
  assert.ok(Math.abs(Number(ui.control('zoom').value) - expected.zoom) < 0.01);
  assert.ok(Math.abs(Number(ui.control('crop-x').value) - expected.x) < 0.02);
  assert.ok(Math.abs(Number(ui.control('crop-y').value) - expected.y) < 0.02);
});

test('얼굴 감지 기능이 없으면(feature-detect) 가운데로 채우고 방법을 안내한다(A4)', async () => {
  const api = createFakeApi();
  const ui = await mount(api);
  await ui.upload(photoFile);
  assert.equal('FaceDetector' in globalThis, false, '이 시험 환경은 기본으로 얼굴 감지를 지원하지 않는다');
  await ui.click('auto-fit');
  assert.match(ui.notice, /가운데로 맞췄어요/);
  assert.equal(ui.control('zoom').value, '1');
  assert.equal(ui.control('crop-x').value, '0');
  assert.equal(ui.control('crop-y').value, '0');
});

test('자동 맞춤은 누르기 전까지 자동으로 실행되지 않고, 한 번의 되돌리기로 이전 자르기로 돌아간다(A4)', async () => {
  const api = createFakeApi();
  const ui = await mount(api);
  await ui.upload(photoFile);
  assert.equal(ui.control('zoom').value, '1', '사진을 올린 직후에는 자동으로 맞추지 않는다');
  // 작은 얼굴일수록 더 확대해야 하므로 zoom이 1보다 커져 가운데 맞춤(zoom 1)과 구분된다.
  const box = { x: 0.85, y: 0.85, width: 0.3, height: 0.3 };
  globalThis.FaceDetector = class { async detect() { return [{ boundingBox: box }]; } };
  try { await ui.click('auto-fit'); } finally { delete globalThis.FaceDetector; }
  assert.notEqual(ui.control('zoom').value, '1');
  await ui.click('undo');
  assert.equal(ui.control('zoom').value, '1');
  assert.equal(ui.control('crop-x').value, '0');
  assert.equal(ui.control('crop-y').value, '0');
});

// PR #289 리뷰(Claude sonnet·Codex gpt-6.1-sol) 지적 반영.

test('이미 저장된 프로젝트를 고치면, 서버 버전이 같아도(더 새 버전이 아니면) 다시 열 때 복원을 물어본다(🔴 P1)', async () => {
  const api = createFakeApi();
  const published = api.seed(seeded('이미 저장된 프로젝트')); // DRAFT, version 1
  const ui = await mount(api, { editor: { autosaveDelayMs: 5 } });
  await ui.change('project-list', published.id);
  await ui.input('name', '같은 버전 위의 편집');
  await settle(10);
  editors.pop()();

  const remounted = await mount(api, { confirm: true });
  assert.match(remounted.asked[0], /저장하지 않은 편집을 이어서 할까요\?/, '서버 버전이 그대로여도(더 새 버전이 아니므로) 조용히 지우지 않고 물어봐야 한다');
  assert.equal(remounted.control('name').value, '같은 버전 위의 편집', '수락하면 복원된다');
});

test('저장 목록을 못 읽으면 서버 버전을 0으로 가정해 복원 여부를 결정하지 않고, 다음 성공한 새로고침에서 다시 판단한다(P2)', async () => {
  const api = createFakeApi();
  const published = api.seed(seeded('목록 실패 시험'), { status: 'PUBLISHED', campaignId: 'campaign-a' }); // version 2
  const ui = await mount(api, { editor: { autosaveDelayMs: 5 } });
  await ui.change('project-list', published.id);
  await ui.input('name', '목록 실패 전 편집');
  await settle(10);
  editors.pop()();

  api.failNext('GET', /collectible-projects$/, { status: 500 });
  const remounted = await mount(api, { confirm: true });
  assert.equal(remounted.asked.length, 0, '목록 조회가 실패했으면 서버 버전 0으로 잘못 판단해 묻거나 지우면 안 된다');
  assert.equal(remounted.control('name').value, '월계 식당 수집품', '아직 결정 전이라 복원도 하지 않는다');
  assert.ok(readDraft(dom.window, 'm1', 'anon'), '실패한 조회가 보관본을 지우지도 않는다');
  await remounted.click('refresh');
  assert.equal(remounted.asked.length, 1, '다음에 목록 조회가 성공하면 그때 다시 판단한다');
  assert.match(remounted.asked[0], /저장하지 않은 편집을 이어서 할까요\?/);
});

test('초기 목록 조회를 기다리는 동안 편집해도 자동 저장이 보관본을 먼저 덮어쓰지 않고, 결정 때 바뀐다는 사실을 분명히 확인한다(🔴 P1)', async () => {
  const api = createFakeApi();
  const previous = await mount(api, { editor: { autosaveDelayMs: 5 } });
  await previous.upload(photoFile);
  await previous.input('name', '이전 세션 편집');
  await settle(10);
  editors.pop()();

  const hold = api.holdNext('GET', /collectible-projects$/);
  const container = document.createElement('div');
  const asked = [];
  const cleanup = mountCollectibleEditor(container, {
    merchantId: 'm1', merchantName: '월계 식당', request: api.request, loadCampaigns: api.listCampaigns,
    onNotice: () => {}, confirm: message => { asked.push(message); return true; }, autosaveDelayMs: 5,
  });
  editors.push(cleanup);
  await settle(2); // 마운트는 끝났지만 목록 조회는 아직 보류 상태
  const name = container.querySelector('[data-control="name"]');
  name.value = '경합 중 입력'; name.dispatchEvent({ type: 'input' });
  await settle(10); // debounce는 지났지만 복원 결정 전이라 자동 저장이 보관본을 건드리면 안 된다

  assert.equal(readDraft(dom.window, 'm1', 'anon').project.name, '이전 세션 편집', '결정 전에는 자동 저장이 이전 보관본을 덮어쓰지 않는다');

  hold.release();
  await settle(10);
  assert.equal(asked.length, 1);
  assert.match(asked[0], /지금까지 입력한 내용을.*이전 편집으로 바꿀까요\?.*지금 입력한 내용은 사라져요/, '조용히 덮어쓰지 않고 바뀐다는 사실을 분명히 확인해야 한다');
  assert.equal(name.value, '이전 세션 편집', '수락하면 이전 보관본으로 바뀐다');
});

test('초기 경합 중 복원을 거절하면 지금 입력을 지키고 이전 보관본은 지운다(🔴 P1)', async () => {
  const api = createFakeApi();
  const previous = await mount(api, { editor: { autosaveDelayMs: 5 } });
  await previous.upload(photoFile);
  await previous.input('name', '이전 세션 편집');
  await settle(10);
  editors.pop()();

  const hold = api.holdNext('GET', /collectible-projects$/);
  const container = document.createElement('div');
  const cleanup = mountCollectibleEditor(container, {
    merchantId: 'm1', merchantName: '월계 식당', request: api.request, loadCampaigns: api.listCampaigns,
    onNotice: () => {}, confirm: () => false, autosaveDelayMs: 5,
  });
  editors.push(cleanup);
  await settle(2);
  const name = container.querySelector('[data-control="name"]');
  name.value = '경합 중 입력'; name.dispatchEvent({ type: 'input' });
  await settle(10);
  hold.release();
  await settle(10);
  assert.equal(name.value, '경합 중 입력', '거절하면 지금 입력을 지킨다');
  assert.equal(readDraft(dom.window, 'm1', 'anon'), null, '거절한 이전 보관본은 지운다');
});

test('로그아웃·계정 전환으로 닫히면 그 계정의 다른 점포 보관본까지 모두 지우고, 평소 닫기는 기기에 남긴다(P1)', async () => {
  const api = createFakeApi();
  const container1 = document.createElement('div');
  const cleanup1 = mountCollectibleEditor(container1, {
    merchantId: 'm1', merchantName: '가게1', request: api.request, loadCampaigns: api.listCampaigns,
    accountScope: 'scope-shared', autosaveDelayMs: 5, confirm: () => true,
  });
  const container2 = document.createElement('div');
  const cleanup2 = mountCollectibleEditor(container2, {
    merchantId: 'm-other', merchantName: '가게2', request: api.request, loadCampaigns: api.listCampaigns,
    accountScope: 'scope-shared', autosaveDelayMs: 5, confirm: () => true,
  });
  editors.push(cleanup2);
  await settle(4);
  const name1 = container1.querySelector('[data-control="name"]'), name2 = container2.querySelector('[data-control="name"]');
  name1.value = '점포1 편집'; name1.dispatchEvent({ type: 'input' });
  name2.value = '점포2 편집'; name2.dispatchEvent({ type: 'input' });
  await settle(10);
  assert.ok(readDraft(dom.window, 'm1', 'scope-shared'));
  assert.ok(readDraft(dom.window, 'm-other', 'scope-shared'));
  cleanup1('logout');
  assert.equal(readDraft(dom.window, 'm1', 'scope-shared'), null);
  assert.equal(readDraft(dom.window, 'm-other', 'scope-shared'), null, '로그아웃은 같은 계정의 다른 점포 보관본도 지운다');
});

test('명시적으로 편집을 버리고 다른 점포를 열면 그 초안의 기기 보관본만 지우고 다시 저장하지 않는다(P1)', async () => {
  const api = createFakeApi();
  const merchants = [owner('m1', '월계 식당'), owner('m2', '두 번째 식당')];
  // mountViaMerchant는 merchant.mjs의 기본 autosaveDelayMs(1.5초)를 그대로 쓰므로, 디바운스를 기다리는 대신
  // 이미 자동 저장된 것처럼 보관본을 먼저 심어 두고 dispose('discard')가 그 보관본을 지우는지만 본다.
  const ui = await mountViaMerchant(api, { confirm: () => true, merchants });
  dom.window.localStorage.setItem(draftStorageKey('m1', 'scope-a'), JSON.stringify({ merchantId: 'm1', accountMarker: 'scope-a', wrapperId: null, wrapperVersion: 0, savedAt: Date.now(), mediaOmitted: false, project: { name: '버릴 편집' } }));
  await ui.input('name', '버릴 편집'); // 실제 편집기도 dirty로 만들어야 merchant.mjs가 "버리기"로 판단한다
  assert.ok(readDraft(dom.window, 'm1', 'scope-a'));
  ui.select.value = 'm2'; ui.select.onchange();
  await settle(5);
  assert.equal(readDraft(dom.window, 'm1', 'scope-a'), null, '명시적으로 버린 초안은 기기 보관본도 지우고 dispose가 다시 저장하지 않는다');
});

test('계정 구분값이 계속 없어도 configureCreator를 다시 불렀다고 열린 제작기를 매번 닫지 않는다(🔵)', async () => {
  const api = createFakeApi();
  const merchants = [owner('m1', '월계 식당')];
  const doc = dom.document;
  const page = doc.createElement('div');
  page.innerHTML = '<section id="merchant-creator" hidden><select id="merchant-creator-store"></select><button id="merchant-creator-open" type="button"></button><div id="merchant-creator-editor"></div></section><p id="merchant-status"></p>';
  doc.body.append(page);
  configureCreator(api.fetcher, doc, { merchants }); // accountScope 없음(없는 채로 반복 호출돼도 열린 제작기를 지켜야 한다)
  doc.getElementById('merchant-creator-store').value = 'm1';
  await doc.getElementById('merchant-creator-open').onclick();
  await settle();
  const host = doc.getElementById('merchant-creator-editor');
  assert.ok(host.children.length > 0, '제작기가 열렸다');
  const name = host.querySelector('[data-control="name"]'); name.value = '계속 열려 있어야 하는 편집'; name.dispatchEvent({ type: 'input' });
  configureCreator(api.fetcher, doc, { merchants });
  assert.ok(host.children.length > 0, '계정 구분값 없이 다시 구성해도 열려 있던 제작기를 닫지 않는다');
  assert.equal(name.value, '계속 열려 있어야 하는 편집', '편집 내용도 그대로 남는다');
});

test('용량 초과로 사진이 빠진 채 복원한 초안은 사진을 다시 고르기 전까지 저장·게시를 막는다(P2)', async () => {
  const api = createFakeApi();
  const ui = await mount(api, { editor: { autosaveDelayMs: 5 } });
  await ui.upload({ ...photoFile, dataUrl: `data:image/png;base64,${'A'.repeat(6 * MiB)}` });
  await ui.input('name', '용량 초과 편집');
  await settle(10);
  assert.equal(readDraft(dom.window, 'm1', 'anon').mediaOmitted, true);
  editors.pop()();

  const restored = await mount(api, { confirm: true });
  assert.match(restored.notice, /사진이 커서 기기에는 저장하지 못했어요/);
  await restored.click('draft');
  assert.match(restored.notice, /사진을 다시 선택한 뒤 저장·게시해 주세요/);
  assert.equal(api.calls.filter(call => call.method === 'POST' && call.path === '/collectible-projects').length, 0, '사진을 다시 고르기 전에는 서버로 보내지 않는다');
  await restored.upload(photoFile);
  await restored.click('draft');
  assert.match(restored.notice, /초안을 저장했어요/);
  assert.equal(api.calls.filter(call => call.method === 'POST' && call.path === '/collectible-projects').length, 1, '사진을 다시 고르면 저장할 수 있다');
});

test('얼굴 감지가 끝나기 전에 사진을 바꾸면 낡은 자동 맞춤 결과를 버린다(P2)', async () => {
  const api = createFakeApi();
  const ui = await mount(api);
  await ui.upload(photoFile);
  let resolveDetect;
  globalThis.FaceDetector = class { async detect() { return new Promise(resolve => { resolveDetect = resolve; }); } };
  ui.action('auto-fit').dispatchEvent({ type: 'click' });
  await settle(2); // detect() 호출까지만 진행되고 멈춰 있다
  await ui.upload({ ...photoFile, dataUrl: 'data:image/png;base64,BBBB' }); // 그사이 사진을 바꾼다
  resolveDetect([{ boundingBox: { x: 0.4, y: 0.3, width: 1.2, height: 1.2 } }]);
  await settle(10);
  delete globalThis.FaceDetector;
  assert.equal(ui.control('zoom').value, '1', '낡은 얼굴 맞춤 결과를 적용하지 않는다');
  assert.equal(ui.notice.includes('얼굴 기준으로 맞췄어요'), false);
});

test('같은 대상·등급에 중복으로 켜 둔 배타 재질도(무광 두 개) 전부 끄고 새 재질을 켠다(P2)', async () => {
  const api = createFakeApi();
  const ui = await mount(api, { confirm: true });
  const addEffect = async type => {
    const before = new Set([...ui.container.querySelectorAll('[data-effect-strength]')].map(node => node.dataset.effectStrength));
    ui.control('effect-type').value = type; ui.control('effect-type').dispatchEvent({ type: 'change' });
    await ui.click('effect-add');
    return [...ui.container.querySelectorAll('[data-effect-strength]')].map(node => node.dataset.effectStrength).find(id => !before.has(id));
  };
  const check = async (id, value) => {
    const box = ui.container.querySelector(`[data-effect-grade="${id}"][data-grade="bronze"]`);
    box.checked = value; box.dispatchEvent({ type: 'change' }); await settle();
  };
  const matte1 = await addEffect('matte'); await check(matte1, true);
  const matte2 = await addEffect('matte'); await check(matte2, true);
  const glass = await addEffect('glass'); await check(glass, true);
  assert.equal(ui.container.querySelector(`[data-effect-grade="${glass}"][data-grade="bronze"]`).checked, true);
  assert.equal(ui.container.querySelector(`[data-effect-grade="${matte1}"][data-grade="bronze"]`).checked, false, '첫 번째 무광도 꺼진다');
  assert.equal(ui.container.querySelector(`[data-effect-grade="${matte2}"][data-grade="bronze"]`).checked, false, '두 번째 무광도 꺼진다(이전 버그는 하나만 껐다)');
});
