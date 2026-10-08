import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { mountCollectibleEditor, photoFileLimits, photoImportPlan, preparePhotoFile } from '../../apps/production-web/assets/collectible-editor.mjs';
import { createFakeApi } from '../fixtures/collectible-fake-api.mjs';
import { installMiniDom, settle } from '../fixtures/mini-dom.mjs';

let dom, cleanups, originalFetch;

beforeEach(() => {
  dom = installMiniDom();
  cleanups = [];
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  globalThis.fetch = originalFetch;
  dom.restore();
});

const png = data => `data:image/png;base64,${data}`;
const smallPhoto = { type: 'image/png', size: 1000, name: 'shop.png', dataUrl: png('AAAA') };

function withStudioRoutes(api, { state, round, profile } = {}) {
  const extraCalls = [];
  const baseRequest = api.request.bind(api);
  return Object.assign(api, {
    extraCalls,
    async request(path, options = {}) {
      const method = options.method ?? 'GET';
      extraCalls.push({ method, path, body: options.body });
      if (path === '/api/web/merchant/merchants/m1/art' && method === 'GET') {
        return state ?? { configured: true, quota: { draftRoundsLeft: 1, finalsLeft: 0 }, round: null };
      }
      if (path === '/api/web/merchant/merchants/m1/art/rounds' && method === 'POST') {
        return round ?? { id: 'round-a', status: 'DRAFTS_READY', drafts: [{ index: 0, style: 'store', label: '가게 초안', imageDataUrl: png('BBBB') }], chosenIndex: null, final: null };
      }
      if (path === '/api/web/v1/merchant/merchants/m1/real-world-profile' && method === 'GET') {
        return profile ?? { photos: [{ id: 'latest-photo' }] };
      }
      return baseRequest(path, options);
    },
  });
}

async function mount(api, options = {}) {
  const host = document.createElement('div');
  const cleanup = mountCollectibleEditor(host, {
    merchantId: 'm1',
    merchantName: '월계 식당',
    request: api.request,
    loadCampaigns: api.listCampaigns,
    ...options,
  });
  cleanups.push(cleanup);
  await settle();
  const control = name => host.querySelector(`[data-control="${name}"]`);
  const action = (name, id) => host.querySelector(`[data-action="${name}"]${id === undefined ? '' : `[data-id="${id}"]`}`);
  const click = async (name, id) => { action(name, id).dispatchEvent({ type: 'click' }); await settle(); };
  const upload = async file => { const input = control('photo'); input.files = [file]; input.dispatchEvent({ type: 'change' }); await settle(); };
  const save = async () => { await click('draft'); return api.calls.findLast(call => call.method === 'POST' && call.path === '/collectible-projects'); };
  return { host, control, action, click, upload, save, get notice() { return host.querySelector('[data-view="notice"]').textContent; } };
}

test('홈은 메뉴 등록 없이 AI 초안과 준비 이미지 두 진입점을 보여 주고 준비 이미지는 기존 저장 계약으로 이어진다', async () => {
  const api = createFakeApi();
  const ui = await mount(api);
  assert.match(ui.host.textContent, /AI로 초안 생성 후 스튜디오 하기/);
  assert.doesNotMatch(ui.host.querySelector('[data-view="studio-home"]').textContent, /등록된 메뉴로 만들어요/);
  assert.match(ui.host.textContent, /미리 준비한 이미지 넣어서 스튜디오 가기/);
  assert.equal(ui.host.querySelector('[data-action="starter"][data-id="0"]'), null, '메뉴 스타터 카드는 홈에서 제거한다');
  const storeStarter = ui.host.querySelector('[data-action="starter"][data-id="store"]');
  assert.ok(storeStarter, '가게 자체 스타터는 접힌 선택지로 남긴다');
  assert.equal(storeStarter.closest('details').open, false, '가게 스타터 묶음은 기본 접힘이다');

  let chooserOpened = 0;
  ui.control('photo').click = () => { chooserOpened++; };
  await ui.click('prepared-photo');
  assert.equal(chooserOpened, 1);

  await ui.upload(smallPhoto);
  const saved = await ui.save();
  assert.equal(saved.body.project.photo.originalDataUrl, smallPhoto.dataUrl);
});

test('AI 초안은 state와 rounds만 사용하고 선택한 그림을 초안 사진으로 저장한다', async () => {
  const api = withStudioRoutes(createFakeApi());
  const ui = await mount(api);

  await ui.click('ai-start');
  assert.deepEqual(api.extraCalls.filter(call => call.path.includes('/art')).map(call => [call.method, call.path]), [
    ['GET', '/api/web/merchant/merchants/m1/art'],
    ['POST', '/api/web/merchant/merchants/m1/art/rounds'],
  ]);
  assert.match(ui.host.querySelector('[data-view="ai-status"]').textContent, /마음에 드는 그림/);

  await ui.click('ai-use', '0');
  const saved = await ui.save();
  assert.equal(saved.body.project.photo.originalDataUrl, png('BBBB'));
  assert.equal(api.extraCalls.some(call => /\/apply$/.test(call.path)), false);
  assert.equal(api.extraCalls.some(call => /\/publish$/.test(call.path)), false);
});

test('AI 미설정과 사용량 소진은 준비 이미지 fallback 문구를 보여 주고 초안 요청을 보내지 않는다', async () => {
  const disabled = withStudioRoutes(createFakeApi(), { state: { configured: false, quota: { draftRoundsLeft: 1, finalsLeft: 0 }, round: null } });
  const disabledUi = await mount(disabled);
  await disabledUi.click('ai-start');
  assert.match(disabledUi.host.querySelector('[data-view="ai-status"]').textContent, /미리 준비한 이미지/);
  assert.equal(disabled.extraCalls.some(call => call.method === 'POST' && call.path.endsWith('/rounds')), false);

  const exhausted = withStudioRoutes(createFakeApi(), { state: { configured: true, quota: { draftRoundsLeft: 0, finalsLeft: 0 }, round: null } });
  const exhaustedUi = await mount(exhausted);
  await exhaustedUi.click('ai-start');
  assert.match(exhaustedUi.host.querySelector('[data-view="ai-status"]').textContent, /오늘 만들 수 있는 AI 초안/);
  assert.equal(exhausted.extraCalls.some(call => call.method === 'POST' && call.path.endsWith('/rounds')), false);
});

test('늦게 끝난 AI state 응답은 dispose 이후 화면이나 저장값을 덮어쓰지 않는다', async () => {
  let release;
  const stateGate = new Promise(resolve => { release = resolve; });
  const api = withStudioRoutes(createFakeApi(), {
    state: stateGate.then(() => ({ configured: true, quota: { draftRoundsLeft: 1, finalsLeft: 0 }, round: { id: 'late', status: 'DRAFTS_READY', drafts: [{ index: 0, style: 'late', label: '늦은 초안', imageDataUrl: png('LATE') }], final: null } })),
  });
  const ui = await mount(api);
  ui.control('name').value = '수동 편집';
  ui.control('name').dispatchEvent({ type: 'input' });
  await settle();
  ui.action('ai-start').dispatchEvent({ type: 'click' });
  cleanups.pop()('navigate');
  release();
  await settle();
  assert.equal(ui.host.querySelector('[data-action="ai-use"]'), null);
});

test('최근 가게 사진은 owner profile의 첫 번째 사진을 같은 출처 private image로 가져온다', async () => {
  const api = withStudioRoutes(createFakeApi(), { profile: { photos: [{ id: 'newest' }, { id: 'older' }] } });
  const fetched = [];
  globalThis.fetch = async (url, options) => {
    fetched.push({ url, credentials: options.credentials, hasSignal: Boolean(options.signal) });
    return { ok: true, blob: async () => ({ type: 'image/webp', size: 1000, dataUrl: 'data:image/webp;base64,PHOTO' }) };
  };
  const ui = await mount(api);

  await ui.click('latest-photo');
  assert.deepEqual(fetched, [{ url: '/api/web/v1/merchant/merchants/m1/photos/newest/image', credentials: 'same-origin', hasSignal: true }]);
  const saved = await ui.save();
  assert.equal(saved.body.project.photo.originalDataUrl, 'data:image/webp;base64,PHOTO');
});

test('웹 사진 입력은 20MiB와 48MP/12000px를 받고 저장용 4096px/3MiB 계획으로 줄인다', async () => {
  assert.deepEqual(photoImportPlan({ type: 'image/jpeg', size: 20 * 1024 * 1024 }, 12000, 4000), { width: 4096, height: 1365, normalize: true });
  assert.throws(() => photoImportPlan({ type: 'image/gif', size: 1000 }, 10, 10), /JPG/);
  assert.throws(() => photoImportPlan({ type: 'image/png', size: photoFileLimits.inputBytes + 1 }, 10, 10), /20 MB/);
  assert.throws(() => photoImportPlan({ type: 'image/png', size: 1000 }, 12001, 10), /12,000/);
  assert.throws(() => photoImportPlan({ type: 'image/png', size: 1000 }, 8000, 7000), /4,800만/);

  const normalized = await preparePhotoFile({ type: 'image/png', size: photoFileLimits.storedBytes + 1, dataUrl: png('AAAA') });
  assert.equal(normalized.normalized, true);
  assert.equal(normalized.width, 2);
  assert.equal(normalized.height, 2);
  assert.equal(dom.document.encodes[0].type, 'image/webp');

  dom.document.encodedBytes = photoFileLimits.storedBytes + 1;
  await assert.rejects(
    preparePhotoFile({ type: 'image/png', size: photoFileLimits.storedBytes + 1, dataUrl: png('AAAA') }),
    /저장 가능한 크기로 줄이지 못했어요/,
  );
});
