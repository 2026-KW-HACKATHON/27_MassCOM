import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { createMerchantStarterProject } from '../../apps/production-web/assets/collectible-model.mjs';
import { mountCollectibleEditor } from '../../apps/production-web/assets/collectible-editor.mjs';
import { createFakeApi, fakeCampaigns } from '../fixtures/collectible-fake-api.mjs';
import { installMiniDom, settle } from '../fixtures/mini-dom.mjs';

let dom, cleanups, originalFetch;
beforeEach(() => { dom = installMiniDom(); cleanups = []; originalFetch = globalThis.fetch; });
afterEach(() => { for (const cleanup of cleanups) cleanup(); globalThis.fetch = originalFetch; dom.restore(); });

async function mount(api, options = {}) {
  const host = document.createElement('div');
  cleanups.push(mountCollectibleEditor(host, {
    merchantId: 'm1', merchantName: '월계 식당', request: api.request, loadCampaigns: api.listCampaigns,
    ...options,
  }));
  await settle();
  const control = name => host.querySelector(`[data-control="${name}"]`);
  const click = async action => { host.querySelector(`[data-action="${action}"]`).dispatchEvent({ type: 'click' }); await settle(); };
  return { host, control, click };
}

test('새 프로젝트는 가게 이름과 1·3·5 등급을 채우고 정확히 한 캠페인만 자동으로 고른다', async () => {
  const api = createFakeApi();
  const ui = await mount(api);
  assert.equal(ui.control('name').value, '월계 식당 방문 수집품');
  assert.equal(ui.control('campaign').value, 'campaign-a');
  for (const [count, grade] of [[1, 'bronze'], [3, 'silver'], [5, 'gold']]) {
    assert.equal(ui.host.querySelector(`[data-reward-count="${count}"]`).value, grade);
    assert.equal(ui.host.querySelector(`[data-grade-enabled="${grade}"]`).checked, true);
  }
  await ui.click('new');
  assert.equal(ui.control('campaign').value, 'campaign-a', '새 초안을 다시 시작해도 같은 기본값을 쓴다');
});

test('대상 캠페인이 여러 개면 선택을 남기고, 명시된 캠페인은 자격을 확인해 선택한다', () => {
  const campaigns = [...fakeCampaigns(), { ...fakeCampaigns()[0], id: 'campaign-c' }];
  assert.equal(createMerchantStarterProject({ merchantName: '월계 식당', campaigns }).campaignId, '');
  assert.equal(createMerchantStarterProject({ merchantName: '월계 식당', campaigns, preferredCampaignId: 'campaign-c' }).campaignId, 'campaign-c');
  assert.equal(createMerchantStarterProject({ merchantName: '월계 식당', campaigns, preferredCampaignId: 'campaign-b' }).campaignId, '');
  assert.equal(createMerchantStarterProject({ merchantName: '월계 식당', campaigns: [fakeCampaigns()[0]] }).campaignId, 'campaign-a');
});

test('등록 메뉴 시작점은 가게와 메뉴를 표시하고 방문 단계마다 다른 연출을 제안한다', async () => {
  const project = createMerchantStarterProject({ merchantName: '월계 식당', menuName: '국수', suggested: true, campaigns: [fakeCampaigns()[0]] });
  assert.equal(project.name, '국수 방문 수집품');
  assert.deepEqual(project.back.stickers.map(item => item.text), ['월계 식당', '국수']);
  assert.deepEqual(project.effects.map(item => [item.gradeIds[0], item.type, item.target]), [
    ['bronze', 'matte', 'surface'], ['silver', 'pearl', 'surface'], ['gold', 'metallic', 'border'],
  ]);
  assert.deepEqual(project.motion.map(item => [item.gradeIds[0], item.type]), [
    ['bronze', 'stamp'], ['silver', 'float'], ['gold', 'shine'],
  ]);
  assert.equal(project.back.mode, 'custom');
  assert.deepEqual(project.stickers.slice(0, 3).map(item => [item.text,
    item.layouts.bronze.size, item.layouts.silver.size, item.layouts.gold.size]), [
    ['⌂', 110, 20, 20], ['◯', 8, 110, 24], ['✦', 8, 8, 120],
  ]);
  const ui = await mount(createFakeApi(), { merchantMenuItems: [{ name: '국수', priceWon: 7000 }] });
  const choice = ui.host.querySelector('[data-action="starter"][data-id="0"]');
  assert.ok(choice);
  assert.match(choice.textContent, /국수/);
  choice.dispatchEvent({ type: 'click' }); await settle();
  assert.equal(ui.control('name').value, '국수 방문 수집품');
});

test('가게 그림 버튼은 허용된 같은 출처 경로에서만 보이고 기존 사진 검사를 거쳐 편집에 반영한다', async () => {
  const artUrl = `/merchant-art/${'a'.repeat(64)}.webp`;
  const requested = [];
  globalThis.fetch = async (url, options) => {
    requested.push([url, options]);
    return { ok: true, blob: async () => ({ type: 'image/webp', size: 1000, dataUrl: 'data:image/webp;base64,AAAA' }) };
  };
  const api = createFakeApi();
  const ui = await mount(api, { merchantArtUrl: artUrl });
  await ui.click('new');
  assert.ok(ui.host.querySelector('[data-action="art-photo"]').closest('[data-step-panel="1"]'));
  await ui.click('art-photo');
  assert.deepEqual(requested, [[artUrl, { credentials: 'same-origin' }]]);
  assert.match(ui.host.querySelector('[data-view="notice"]').textContent, /가게 그림을 사진으로 가져왔어요/);
  await ui.click('draft');
  assert.equal(api.calls.find(call => call.method === 'POST')?.body.project.photo.originalDataUrl, 'data:image/webp;base64,AAAA');
  const bad = await mount(createFakeApi(), { merchantArtUrl: 'https://example.com/image.webp' });
  assert.equal(bad.host.querySelector('[data-action="art-photo"]'), null);
});

test('시작점 선택을 거절하면 현재 수동 편집을 보존한다', async () => {
  const ui = await mount(createFakeApi(), { merchantMenuItems: [{ name: '국수' }], confirm: () => false });
  ui.control('name').value = '수동 편집';
  ui.control('name').dispatchEvent({ type: 'input' }); await settle();
  ui.host.querySelector('[data-action="starter"][data-id="0"]').dispatchEvent({ type: 'click' }); await settle();
  assert.equal(ui.control('name').value, '수동 편집');
});
