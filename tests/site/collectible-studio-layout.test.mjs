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
  for (const name of ['crop-reset', 'auto-fit', 'crop-apply']) {
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

test('3단계는 자르기 조작을 반복하지 않고 1단계로 가는 버튼·되돌리기·붓·필터·스티커를 보인다', async () => {
  const ui = await mountStudio();
  await ui.act('step', '3');
  const crop = ui.q('[data-view="crop"]');
  assert.equal(ui.stepOf(crop), '3', '붓이 칠하는 사진 캔버스가 3단계에 있다');
  assert.equal(crop.closest('.ce-panel').querySelector('h3').textContent, '붓 도구', '캔버스는 붓 도구 칸 안에 있다');
  for (const node of [ui.q('[data-control="zoom"]'), ui.q('[data-action="crop-apply"]'), ui.q('[data-action="crop-reset"]'), ui.q('[data-action="auto-fit"]'), ui.choice('shape', 'circle'), ui.choice('shape', 'stamp'), ui.choice('shape', 'serrated')]) {
    assert.equal(ui.stepOf(node), '1', '확대·모양·자르기 동작은 1단계에만 있다');
  }
  const back = ui.all('[data-action="step"]').find(node => node.dataset.id === '1' && ui.stepOf(node) === '3');
  assert.ok(back, '3단계에 1단계로 가는 버튼이 있다');
  for (const name of ['undo', 'redo', 'compare']) assert.equal(ui.stepOf(ui.q(`[data-action="${name}"]`)), '3', name);
  assert.equal(ui.stepOf(ui.choice('brush', 'erase')), '3');
  assert.equal(ui.stepOf(ui.q('[data-control="brush-size"]')), '3');
  assert.equal(ui.stepOf(ui.q('[data-control="brush-color"]')), '3');
  assert.equal(ui.stepOf(ui.q('[data-control="sticker-kind"]')), '3');
  assert.equal(ui.q('[data-control="sticker-kind"]').closest('details').open, true);
  const more = ui.q('[data-edit="brightness"]').closest('details');
  assert.equal(ui.stepOf(more), '3'); assert.equal(more.open, false);
  for (const control of ['living-kind', 'story-type']) assert.ok(ui.q(`[data-control="${control}"]`).closest('details').classList.contains('ce-more'), `${control}의 더 보기도 같은 점선 모양이다`);
  assert.ok(more.classList.contains('ce-more'));
  for (const control of ['sticker-kind', 'greeting']) assert.equal(ui.q(`[data-control="${control}"]`).closest('details').classList.contains('ce-more'), false, `${control}은 펼쳐 둔 묶음이라 점선 모양이 아니다`);
});

test('1단계로 돌아오면 사진 캔버스도 1단계로 돌아오고 붓은 사진 이동으로 되돌아온다', async () => {
  const ui = await mountStudio();
  await ui.act('step', '3');
  await ui.click(ui.choice('brush', 'erase'));
  assert.equal(ui.q('[data-control="brush"]').value, 'erase');
  assert.equal(ui.choice('brush', 'erase').getAttribute('aria-pressed'), 'true');
  const undoNotice = () => ui.q('[data-view="notice"]').textContent;
  await ui.act('step', '1');
  assert.equal(ui.stepOf(ui.q('[data-view="crop"]')), '1', '캔버스가 1단계로 돌아온다');
  assert.equal(ui.q('[data-control="brush"]').value, 'move', '1단계에서 끌어도 지워지지 않는다');
  assert.equal(ui.choice('brush', 'move').getAttribute('aria-pressed'), 'true');
  assert.equal(ui.choice('brush', 'erase').getAttribute('aria-pressed'), 'false');
  await ui.act('undo');
  assert.equal(undoNotice(), '되돌릴 편집이 아직 없어요.', '붓을 되돌리는 일은 되돌리기 기록을 만들지 않는다');
  await ui.act('step', '4'); await ui.act('step', '3');
  assert.equal(ui.stepOf(ui.q('[data-view="crop"]')), '3', '3단계로 다시 가면 캔버스도 따라온다');
});

test('필터 선택은 보이는 강도 슬라이더만 바꾸고 값은 그대로 둔다', async () => {
  const ui = await mountStudio();
  const slider = name => ui.q(`[data-edit="${name}"]`).closest('label');
  const tile = name => ui.q(`[data-filter="${name}"]`);
  assert.equal(slider('cartoon').hidden, false, '모두 0이면 만화풍을 보인다');
  assert.equal(slider('merge').hidden, true);
  const merge = ui.q('[data-edit="merge"]'); merge.value = '30'; merge.dispatchEvent({ type: 'input' }); await settle();
  await ui.click(tile('merge'));
  assert.equal(slider('merge').hidden, false); assert.equal(slider('cartoon').hidden, true);
  assert.equal(tile('merge').getAttribute('aria-pressed'), 'true');
  assert.equal(merge.value, '30', '선택을 바꿔도 값은 그대로다');
});

test('다른 초안을 열면 필터 선택을 그 초안 값으로 다시 정한다', async () => {
  const ui = await mountStudio();
  await ui.click(ui.q('[data-filter="simplify"]'));
  await ui.act('new');
  assert.equal(ui.q('[data-edit="cartoon"]').closest('label').hidden, false, '새 초안은 기본(만화풍)으로 돌아간다');
});

test('4단계에 움직임·효과·음성·게시 정보가 펼쳐져 있고 이야기·살아 있는 그림은 접혀 있다', async () => {
  const ui = await mountStudio();
  for (const selector of ['[data-view="templates"]', '[data-control="effect-type"]', '[data-control="greeting"]', '[data-view="waveform"]', '[data-control="name"]', '[data-control="campaign"]']) {
    assert.equal(ui.stepOf(ui.q(selector)), '4', selector);
  }
  for (const control of ['templates', 'greeting', 'campaign']) {
    // data-view="greeting"은 미리보기 쪽 안내 문단이라 먼저 찾으면 안 된다. 입력 컨트롤을 먼저 찾는다.
    const details = (ui.q(`[data-control="${control}"]`) || ui.q(`[data-view="${control}"]`)).closest('details');
    assert.equal(details.open, true, control);
  }
  for (const control of ['living-kind', 'story-type']) assert.equal(ui.q(`[data-control="${control}"]`).closest('details').open, false, control);
});

test('3단계를 떠나면 붓 대상도 사진 보정으로 돌아와 1단계에서 끌어도 패럴랙스 점이 생기지 않는다', async () => {
  const ui = await mountStudio();
  const target = ui.q('[data-control="brush-target"]'), parallaxControls = ui.q('[data-view="parallax-controls"]');
  const pick = async value => { target.value = value; target.dispatchEvent({ type: 'change' }); await settle(); };
  // 사진이 없을 때: 값만 되돌아오고 되돌리기 기록은 만들지 않는다.
  await ui.act('step', '3'); await pick('parallax');
  assert.equal(parallaxControls.hidden, false, '3단계에서 패럴랙스 붓이 켜진다');
  await ui.act('step', '1');
  assert.equal(target.value, 'photo');
  assert.equal(parallaxControls.hidden, true, '패럴랙스 조절도 다시 숨는다');
  await ui.act('undo');
  assert.equal(ui.q('[data-view="notice"]').textContent, '되돌릴 편집이 아직 없어요.', '붓 대상을 되돌리는 일은 되돌리기 기록을 만들지 않는다');
  // 사진이 있을 때: 1단계에서 끌어도 패럴랙스 획이 쌓이지 않는다.
  const photo = ui.q('[data-control="photo"]');
  photo.files = [{ type: 'image/png', size: 1000, name: 'p.png', dataUrl: 'data:image/png;base64,AAAA' }]; photo.dispatchEvent({ type: 'change' }); await settle();
  await ui.act('step', '3'); await pick('parallax'); await ui.act('step', '1');
  assert.equal(target.value, 'photo');
  const crop = ui.q('[data-view="crop"]');
  crop.dispatchEvent({ type: 'pointerdown', pointerId: 1, clientX: 256, clientY: 256 });
  for (let point = 0; point < 5; point++) crop.dispatchEvent({ type: 'pointermove', pointerId: 1, clientX: 256 + point, clientY: 256 });
  crop.dispatchEvent({ type: 'pointerup', pointerId: 1 }); await settle();
  await ui.act('draft');
  const saves = ui.api.calls.filter(call => call.body?.project);
  assert.ok(saves.length > 0, '초안을 저장했다');
  assert.equal(saves.at(-1).body.project.parallax.strokes.length, 0, '패럴랙스 획이 생기지 않았다');
}); 

test('다른 필터로 옮겨도 값이 남고 슬라이더를 움직여도 선택이 튀지 않는다', async () => {
  const ui = await mountStudio();
  const slider = n => ui.q(`[data-edit="${n}"]`), label = n => slider(n).closest('label');
  const set = async (n, v) => { slider(n).value = String(v); slider(n).dispatchEvent({ type: 'input' }); await settle(); };
  await set('merge', 30);
  await ui.click(ui.q('[data-filter="simplify"]'));
  assert.equal(slider('merge').value, '30');
  await set('simplify', 20);
  assert.equal(label('simplify').hidden, false); assert.equal(label('merge').hidden, true);
  assert.equal(slider('merge').value, '30'); assert.equal(slider('simplify').value, '20');
});

test('값이 있는 저장 초안을 열면 0이 아닌 첫 필터를 보인다', async () => {
  const ui = await mountStudio();
  const s = ui.q('[data-edit="simplify"]'); s.value = '40'; s.dispatchEvent({ type: 'input' }); await settle();
  await ui.act('draft'); await ui.act('new');
  assert.equal(ui.q('[data-edit="cartoon"]').closest('label').hidden, false);
  await ui.click(ui.all('[data-action="open-project"]')[0]);
  assert.equal(ui.q('[data-edit="simplify"]').closest('label').hidden, false);
  assert.equal(ui.q('[data-edit="cartoon"]').closest('label').hidden, true);
});
