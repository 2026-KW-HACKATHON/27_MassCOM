import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { createMerchantStarterProject, createProject } from '../../apps/production-web/assets/collectible-model.mjs';
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
  assert.equal(ui.host.querySelector('[data-control="campaign"]'), null, '캠페인 선택기는 없다');
  assert.equal(ui.host.querySelector('[data-reward-count]'), null, '점주는 방문 횟수별 보상을 고르지 않는다');
  assert.match(ui.host.querySelector('[data-view="campaign-status"]').textContent, /방문 보상은 자동으로 연결돼요/);
  assert.match(ui.host.querySelector('[data-view="reward-grades"]').textContent, /1회 브론즈 · 3회 실버 · 5회 골드/);
  for (const grade of ['bronze', 'silver', 'gold']) assert.equal(ui.host.querySelector(`[data-grade-enabled="${grade}"]`).checked, true);
  await ui.click('draft');
  const project = api.calls.find(call => call.method === 'POST')?.body.project;
  assert.equal(project.campaignId, 'campaign-a');
  assert.deepEqual(project.rewardGrades, { 1: 'bronze', 3: 'silver', 5: 'gold' });
  await ui.click('new');
  assert.match(ui.host.querySelector('[data-view="campaign-status"]').textContent, /방문 보상은 자동으로 연결돼요/, '새 초안을 다시 시작해도 같은 기본값을 쓴다');
});

test('대상 캠페인은 정확한 1·3·5회 활성 캠페인이 하나일 때만 자동 연결한다', () => {
  const campaigns = [...fakeCampaigns(), { ...fakeCampaigns()[0], id: 'campaign-c' }];
  assert.equal(createMerchantStarterProject({ merchantName: '월계 식당', campaigns }).campaignId, '');
  assert.equal(createMerchantStarterProject({ merchantName: '월계 식당', campaigns, preferredCampaignId: 'campaign-c' }).campaignId, '', '두 활성 캠페인은 저장한 선호값으로 임의 결정하지 않는다');
  assert.equal(createMerchantStarterProject({ merchantName: '월계 식당', campaigns, preferredCampaignId: 'campaign-b' }).campaignId, '');
  assert.equal(createMerchantStarterProject({ merchantName: '월계 식당', campaigns: [fakeCampaigns()[0]] }).campaignId, 'campaign-a');
  assert.equal(createMerchantStarterProject({ campaigns: [fakeCampaigns()[0], { ...fakeCampaigns()[0], id: 'draft', status: 'DRAFT' }] }).campaignId, 'campaign-a');
  assert.equal(createMerchantStarterProject({ campaigns: [fakeCampaigns()[0], { ...fakeCampaigns()[0], id: 'private', isPublic: false }] }).campaignId, 'campaign-a');
  assert.equal(createMerchantStarterProject({ campaigns: [fakeCampaigns()[0], { ...fakeCampaigns()[0], id: 'expired', endsAt: '2000-01-01T00:00:00.000Z' }] }).campaignId, 'campaign-a');
  assert.equal(createMerchantStarterProject({ merchantName: '월계 식당', campaigns: [{ ...fakeCampaigns()[0], goals: [1, 3] }] }).campaignId, '');
  assert.equal(createMerchantStarterProject({ merchantName: '월계 식당', campaigns: [{ ...fakeCampaigns()[0], status: 'ENDED' }] }).campaignId, '');
});

test('활성 공개 캠페인이 둘이면 게시 불가 이유를 화면에 보여 준다', async () => {
  const api = createFakeApi({ campaigns: [fakeCampaigns()[0], { ...fakeCampaigns()[0], id: 'campaign-c' }] });
  const ui = await mount(api);
  assert.equal(ui.host.querySelector('[data-view="campaign-status"]').textContent, '게시할 캠페인을 하나로 정할 수 없어요. 운영팀에 문의해 주세요');
  await ui.click('draft');
  assert.equal(api.calls.find(call => call.method === 'POST')?.body.project.campaignId, '');
});

test('프리즘이 빠진 기존 16등급 초안을 열고 다시 저장해도 등급을 추가하지 않는다', async () => {
  const api = createFakeApi();
  const project = createProject({ campaignId: 'campaign-a' });
  project.photo.originalDataUrl = 'data:image/png;base64,AAAA';
  project.grades = [...project.grades.filter(grade => grade.id !== 'prism'), ...Array.from({ length: 13 }, (_, i) => ({ id: `extra-${i}`, name: `추가 ${i}`, kind: 'special', enabled: true }))];
  const existing = api.seed(project);
  const ui = await mount(api);
  ui.control('project-list').value = existing.id;
  ui.control('project-list').dispatchEvent({ type: 'change' });
  await settle();
  await ui.click('draft');
  const saved = api.calls.filter(call => call.method === 'PUT').at(-1)?.body.project;
  assert.equal(saved.grades.length, 16);
  assert.equal(saved.grades.some(grade => grade.id === 'prism'), false);
  await ui.click('publish');
  assert.match(ui.host.querySelector('[data-view="notice"]').textContent, /기본 4등급을 위해 추가 등급을 하나 줄여 주세요/);
  assert.equal(api.calls.some(call => call.path.endsWith('/publish')), false);
});

test('브론즈가 빠진 기존 16등급 초안은 유효한 기존 보상 매핑으로 저장한다', async () => {
  const api = createFakeApi();
  const project = createProject({ campaignId: 'campaign-a' });
  project.grades = [...project.grades.filter(grade => grade.id !== 'bronze'), ...Array.from({ length: 13 }, (_, i) => ({ id: `extra-${i}`, name: `추가 ${i}`, kind: 'special', enabled: true }))];
  project.rewardGrades = { 1: 'extra-0', 3: 'silver', 5: 'gold' };
  const existing = api.seed(project);
  const ui = await mount(api);
  ui.control('project-list').value = existing.id;
  ui.control('project-list').dispatchEvent({ type: 'change' });
  await settle();
  await ui.click('draft');
  const saved = api.calls.filter(call => call.method === 'PUT').at(-1)?.body.project;
  assert.equal(saved.grades.length, 16);
  assert.deepEqual(saved.rewardGrades, project.rewardGrades);
});

test('등록 메뉴 시작점 모델은 메뉴 이름과 방문 단계마다 다른 연출을 제안하지만 UI 카드는 만들지 않는다', async () => {
  const project = createMerchantStarterProject({ merchantName: '월계 식당', menuName: '국수', suggested: true, campaigns: [fakeCampaigns()[0]] });
  assert.equal(project.name, '국수 방문 수집품');
  assert.equal(project.back.mode, 'default');
  assert.deepEqual(project.back.stickers, []);
  assert.deepEqual(project.effects.map(item => [item.gradeIds[0], item.type, item.target]), [
    ['bronze', 'matte', 'surface'], ['silver', 'pearl', 'surface'], ['gold', 'metallic', 'border'],
  ]);
  assert.deepEqual(project.motion.map(item => [item.gradeIds[0], item.type]), [
    ['bronze', 'stamp'], ['silver', 'float'], ['gold', 'shine'],
  ]);
  assert.deepEqual(project.stickers.slice(0, 3).map(item => [item.text,
    item.layouts.bronze.size, item.layouts.silver.size, item.layouts.gold.size]), [
    ['⌂', 110, 20, 20], ['◯', 8, 110, 24], ['✦', 8, 8, 120],
  ]);
  const ui = await mount(createFakeApi(), { merchantMenuItems: [{ name: '국수', priceWon: 7000 }] });
  assert.equal(ui.host.querySelector('[data-action="starter"][data-id="0"]'), null, '등록 메뉴는 더 이상 홈 스타터 카드를 만들지 않는다');
  const storeStarter = ui.host.querySelector('[data-action="starter"][data-id="store"]');
  assert.ok(storeStarter, '가게 스타터는 유지한다');
  assert.doesNotMatch(storeStarter.textContent, /국수/);
  assert.match(storeStarter.textContent, /1회/);
  assert.match(storeStarter.textContent, /3회/);
  assert.match(storeStarter.textContent, /5회/);
  storeStarter.dispatchEvent({ type: 'click' }); await settle();
  assert.equal(ui.control('name').value, '월계 식당 방문 수집품');
  assert.equal(ui.host.querySelector('[data-reward-count]'), null);
  assert.match(ui.host.querySelector('[data-view="reward-grades"]').textContent, /1회 브론즈 · 3회 실버 · 5회 골드/);
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
  ui.host.querySelector('[data-action="starter"][data-id="store"]').dispatchEvent({ type: 'click' }); await settle();
  assert.equal(ui.control('name').value, '수동 편집');
});
