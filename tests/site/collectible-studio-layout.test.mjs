import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { mountCollectibleEditor } from '../../apps/production-web/assets/collectible-editor.mjs';
import { createFakeApi } from '../fixtures/collectible-fake-api.mjs';
import { installMiniDom, settle } from '../fixtures/mini-dom.mjs';

let dom, cleanups;
beforeEach(() => { dom = installMiniDom(); cleanups = []; });
afterEach(() => { for (const cleanup of cleanups) cleanup(); dom.restore(); });

/** 스튜디오 배치 시험용: 편집기를 올리고 단계·노드 위치를 묻는 도우미를 돌려준다. */
export async function mountStudio() {
  const api = createFakeApi(), container = document.createElement('div');
  cleanups.push(mountCollectibleEditor(container, { merchantId: 'm1', merchantName: '월계 식당', request: api.request, loadCampaigns: api.listCampaigns, onNotice() {}, confirm: () => true }));
  await settle();
  const q = selector => container.querySelector(selector);
  const all = selector => [...container.querySelectorAll(selector)];
  const click = async node => { node.dispatchEvent({ type: 'click' }); await settle(); };
  const act = async (name, id) => click(all(`[data-action="${name}"]`).find(node => id === undefined || node.dataset.id === id));
  const stepOf = node => node?.closest('[data-step-panel]')?.dataset.stepPanel;
  const choice = (control, id) => all('[data-action="choice"]').find(node => node.dataset.controlFor === control && node.dataset.id === id);
  await act('new');
  return { api, container, q, all, click, act, stepOf, choice };
}

test('1단계에는 사진·모양·자르기만 펼치고 이름은 4단계로 간다', async () => {
  const ui = await mountStudio();
  assert.equal(ui.stepOf(ui.q('[data-control="photo"]')), '1');
  assert.equal(ui.stepOf(ui.choice('shape', 'stamp')), '1');
  assert.equal(ui.stepOf(ui.q('[data-view="crop"]')), '1');
  assert.notEqual(ui.stepOf(ui.q('[data-control="name"]')), '1');
  const fine = ui.q('[data-control="crop-x"]').closest('details');
  assert.ok(fine, '가로·세로 미세 조정은 접힌 더 보기 안에 있다');
  assert.equal(fine.open, false);
  for (const name of ['crop-reset', 'auto-fit', 'crop-apply', 'undo', 'redo']) {
    const more = ui.q(`[data-action="${name}"]`).closest('details');
    assert.ok(more?.classList.contains('ce-more'), `${name}은 더 보기 안에 있다`);
    assert.equal(more.open, false, `${name}이 든 더 보기는 접혀 있다`);
  }
  for (const node of [ui.q('[data-control="zoom"]'), ...ui.all('[data-action="zoom-step"]'), ui.choice('shape', 'circle'), ui.choice('shape', 'stamp'), ui.choice('shape', 'serrated')]) {
    assert.equal(node.closest('details'), null, '확대 줄과 모양 타일은 어떤 접힘 안에도 없다');
  }
});

test('확대 −/+ 버튼은 0.25배씩 바꾸고 1~8배를 넘지 않는다', async () => {
  const ui = await mountStudio();
  const zoom = ui.q('[data-control="zoom"]'), readout = ui.q('[data-value="zoom"]');
  const [zoomOut, zoomIn] = ui.all('[data-action="zoom-step"]');
  assert.notEqual(zoomOut.getAttribute('aria-label'), zoom.getAttribute('aria-label'));
  assert.notEqual(zoomIn.getAttribute('aria-label'), zoom.getAttribute('aria-label'));
  await ui.act('zoom-step', '0.25');
  assert.equal(Number(zoom.value), 1.25);
  assert.equal(readout.textContent, '1.25배');
  await ui.act('undo');
  assert.equal(Number(zoom.value), 1, '한 번 되돌리면 확대 버튼 이전 값으로 돌아온다');
  assert.equal(readout.textContent, '1.00배');
  await ui.act('zoom-step', '0.25');
  await ui.act('zoom-step', '-0.25'); await ui.act('zoom-step', '-0.25');
  assert.equal(Number(zoom.value), 1, '1배 아래로 내려가지 않는다');
  zoom.value = '8'; await ui.act('zoom-step', '0.25');
  assert.equal(Number(zoom.value), 8, '8배를 넘지 않는다');
});

test('확대가 한계에 닿은 −/+ 는 되돌리기 기록도 편집 표시도 남기지 않는다', async () => {
  const ui = await mountStudio();
  const saveState = ui.q('[data-view="save-state"]'), readout = ui.q('[data-value="zoom"]'), before = saveState.textContent;
  await ui.act('zoom-step', '-0.25');
  assert.equal(saveState.textContent, before, '편집 표시가 바뀌지 않는다');
  ui.q('[data-control="zoom"]').value = '8'; await ui.act('zoom-step', '0.25');
  assert.equal(readout.textContent, '1.00배', '최대에서 +는 값 변경 이벤트를 보내지 않는다');
  assert.equal(saveState.textContent, before);
  await ui.act('undo');
  assert.equal(ui.q('[data-view="notice"]').textContent, '되돌릴 편집이 아직 없어요.', '되돌리기 기록이 비어 있다');
});

test('2단계에 표현 스타일·깊이·두께 3단계가 있고 등급 관리는 접혀 있다', async () => {
  const ui = await mountStudio();
  assert.equal(ui.stepOf(ui.choice('style', 'incised')), '2');
  assert.equal(ui.stepOf(ui.q('[data-control="relief"]')), '2');
  assert.equal(ui.stepOf(ui.choice('thickness', '14')), '2');
  const grades = ui.q('[data-view="grade-manager"]').closest('details');
  assert.equal(ui.stepOf(grades), '2'); assert.equal(grades.open, false);
});

test('두께 버튼은 값을 바꾸고, 다른 값은 직접 지정으로 보존한다', async () => {
  const ui = await mountStudio();
  const thickness = ui.q('[data-control="thickness"]');
  await ui.click(ui.choice('thickness', '14'));
  assert.equal(thickness.value, '14');
  assert.equal(ui.choice('thickness', '14').getAttribute('aria-pressed'), 'true');
  thickness.value = '11'; thickness.dispatchEvent({ type: 'change' }); await settle();
  assert.equal(thickness.value, '11', '직접 지정 값은 바뀌지 않는다');
  assert.ok(['4', '8', '14'].every(id => ui.choice('thickness', id).getAttribute('aria-pressed') === 'false'));
  const custom = ui.q('.ce-thickness-custom');
  assert.equal(custom.hidden, false); assert.equal(custom.textContent, '직접 지정 11');
});

test('기본 두께로 되돌리면 두께 버튼 선택도 보통으로 돌아온다', async () => {
  const ui = await mountStudio();
  await ui.click(ui.choice('thickness', '14'));
  await ui.act('thickness-reset');
  assert.equal(ui.q('[data-control="thickness"]').value, '8');
  assert.equal(ui.choice('thickness', '8').getAttribute('aria-pressed'), 'true');
  assert.equal(ui.choice('thickness', '14').getAttribute('aria-pressed'), 'false');
});

test('두께 버튼도 되돌리기 한 번으로 돌아오고 숫자 표시가 값을 따른다', async () => {
  const ui = await mountStudio();
  const thickness = ui.q('[data-control="thickness"]'), readout = ui.q('[data-value="thickness"]');
  await ui.click(ui.choice('thickness', '14'));
  assert.equal(readout.textContent, '14');
  assert.equal(ui.choice('thickness', '14').getAttribute('aria-pressed'), 'true');
  await ui.act('undo');
  assert.equal(thickness.value, '8');
  assert.equal(readout.textContent, '8');
  assert.equal(ui.choice('thickness', '8').getAttribute('aria-pressed'), 'true');
  assert.equal(ui.choice('thickness', '14').getAttribute('aria-pressed'), 'false');
  await ui.click(ui.choice('thickness', '8'));
  await ui.act('undo');
  assert.equal(ui.q('[data-view="notice"]').textContent, '되돌릴 편집이 아직 없어요.', '이미 고른 값을 다시 눌러도 기록이 늘지 않는다');
});
