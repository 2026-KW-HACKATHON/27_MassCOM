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
  const unmount = mountCollectibleEditor(container, { merchantId: 'm1', merchantName: '월계 식당', request: api.request, loadCampaigns: api.listCampaigns, onNotice() {}, confirm: () => true });
  let disposed = false;
  const dispose = () => { if (!disposed) { disposed = true; unmount(); } };
  cleanups.push(dispose);
  await settle();
  const q = selector => container.querySelector(selector);
  const all = selector => [...container.querySelectorAll(selector)];
  const click = async node => { node.dispatchEvent({ type: 'click' }); await settle(); };
  const act = async (name, id) => click(all(`[data-action="${name}"]`).find(node => id === undefined || node.dataset.id === id));
  const stepOf = node => node?.closest('[data-step-panel]')?.dataset.stepPanel;
  const choice = (control, id) => all('[data-action="choice"]').find(node => node.dataset.controlFor === control && node.dataset.id === id);
  await act('new');
  return { api, container, q, all, click, act, stepOf, choice, dispose };
}

test('고정 작업 영역의 미리보기 캔버스를 관찰하고 표시되면 렌더를 다시 예약한다', async () => {
  const originalObserver = Object.getOwnPropertyDescriptor(globalThis, 'IntersectionObserver');
  const originalRaf = globalThis.requestAnimationFrame;
  const observed = [];
  let callback, rafCalls = 0, ui;
  globalThis.IntersectionObserver = class {
    constructor(handler) { callback = handler; }
    observe(target) { observed.push(target); }
    disconnect() {}
  };
  globalThis.requestAnimationFrame = () => ++rafCalls;
  try {
    ui = await mountStudio();
    const preview = ui.q('[data-view="preview"]');
    assert.equal(observed.length, 1);
    assert.ok(observed[0] === preview, '편집기 컨테이너 대신 미리보기 캔버스를 관찰한다');
    callback([{ target: preview, isIntersecting: false }]);
    await ui.act('step', '2');
    // 단계 이동이 예약한 프레임도 취소한 뒤 표시 콜백 자체의 예약을 확인한다.
    callback([{ target: preview, isIntersecting: false }]);
    const before = rafCalls;
    callback([{ target: preview, isIntersecting: true }]);
    assert.equal(rafCalls, before + 1, '미리보기가 표시되면 새 렌더 프레임을 예약한다');
  } finally {
    ui?.dispose();
    globalThis.requestAnimationFrame = originalRaf;
    if (originalObserver) Object.defineProperty(globalThis, 'IntersectionObserver', originalObserver);
    else delete globalThis.IntersectionObserver;
  }
});

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

test('단계를 옮기면 붓은 사진 이동으로 되돌아오고 사진 캔버스는 그 단계의 칸을 따라간다', async () => {
  const ui = await mountStudio();
  const brush = () => ui.q('[data-control="brush"]'), crop = () => ui.q('[data-view="crop"]');
  const pressed = id => ui.choice('brush', id).getAttribute('aria-pressed');
  for (const destination of ['1', '2', '4']) {
    await ui.act('step', '3');
    await ui.click(ui.choice('brush', 'erase'));
    assert.equal(brush().value, 'erase');
    assert.equal(pressed('erase'), 'true');
    await ui.act('step', destination);
    assert.equal(brush().value, 'move', `3단계에서 ${destination}단계로 가면 붓이 사진 이동으로 돌아온다`);
    assert.equal(pressed('move'), 'true'); assert.equal(pressed('erase'), 'false');
  }
  await ui.act('step', '3'); await ui.click(ui.choice('brush', 'erase'));
  await ui.act('home'); await ui.act('resume');
  assert.equal(ui.stepOf(crop()), '3', '스튜디오 홈에서 3단계로 돌아오면 캔버스도 3단계에 있다');
  assert.equal(brush().value, 'move', '홈에서 단계로 들어올 때도 붓이 돌아온다');
  await ui.act('step', '1');
  assert.equal(ui.stepOf(crop()), '1', '캔버스가 1단계로 돌아온다');
  await ui.act('undo');
  assert.equal(ui.q('[data-view="notice"]').textContent, '되돌릴 편집이 아직 없어요.', '붓을 되돌리는 일은 되돌리기 기록을 만들지 않는다');
  await ui.act('step', '4'); await ui.act('step', '3');
  assert.equal(ui.stepOf(crop()), '3', '3단계로 다시 가면 캔버스도 따라온다');
  await ui.act('step', '2');
  assert.notEqual(ui.stepOf(crop()), '2', '2단계에는 사진 캔버스를 보이지 않는다');
});

test('4단계에서는 사진 캔버스가 살아 있는 그림 안에 있고 2단계에는 나타나지 않는다', async () => {
  const ui = await mountStudio();
  const crop = ui.q('[data-view="crop"]'), living = ui.q('[data-control="living-kind"]').closest('details');
  await ui.act('step', '4');
  assert.equal(ui.stepOf(crop), '4');
  assert.equal(crop.closest('details'), living, '캔버스는 "살아 있는 그림" 묶음 안에 있다');
  assert.equal(living.querySelector('.ce-detail').children[0].querySelector('[data-view="crop"]'), crop, '살아 있는 그림 조작보다 앞에 있다');
  assert.equal(living.open, false, '묶음은 접혀 있다');
  for (const step of ['2', '3', '1']) {
    await ui.act('step', step);
    assert.notEqual(crop.closest('details'), living, `${step}단계에는 캔버스가 살아 있는 그림 묶음에 남지 않는다`);
    if (step === '2') assert.notEqual(ui.stepOf(crop), '2', '2단계에는 사진 캔버스를 보이지 않는다');
  }
});

test('4단계에서 영역 칠하기를 켜도 다른 단계로 가면 사진 보정으로 돌아와 1단계 끌기가 점을 찍지 않는다', async () => {
  const ui = await mountStudio();
  const target = ui.q('[data-control="brush-target"]'), crop = ui.q('[data-view="crop"]');
  const photo = ui.q('[data-control="photo"]');
  photo.files = [{ type: 'image/png', size: 1000, name: 'p.png', dataUrl: 'data:image/png;base64,AAAA' }]; photo.dispatchEvent({ type: 'change' }); await settle();
  await ui.act('step', '4');
  await ui.act('living-add');
  const paint = ui.all('[data-action="living-paint"]')[0];
  assert.ok(paint, '영역 항목에는 "이 영역 칠하기"가 있다');
  await ui.click(paint);
  assert.match(target.value, /^living:/, '4단계에서 칠하기를 켜면 living 대상이 된다');
  assert.equal(ui.stepOf(crop), '4');
  crop.dispatchEvent({ type: 'pointerdown', pointerId: 1, clientX: 100, clientY: 100 });
  crop.dispatchEvent({ type: 'pointerup', pointerId: 1 }); await settle();
  await ui.act('step', '1');
  assert.equal(target.value, 'photo', '단계를 옮기면 붓 대상이 사진 보정으로 돌아온다');
  crop.dispatchEvent({ type: 'pointerdown', pointerId: 2, clientX: 256, clientY: 256 });
  for (let point = 0; point < 5; point++) crop.dispatchEvent({ type: 'pointermove', pointerId: 2, clientX: 256 + point, clientY: 256 });
  crop.dispatchEvent({ type: 'pointerup', pointerId: 2 }); await settle();
  await ui.act('draft');
  const saved = ui.api.calls.filter(call => call.body?.project).at(-1).body.project;
  assert.equal(saved.living.items.length, 1);
  assert.equal(saved.living.items[0].strokes.length, 1, '점은 4단계에서 찍은 한 개뿐이고 1단계 끌기는 점을 더하지 않았다');
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
  // 사진이 없을 때: 어느 단계로 가든 값만 되돌아오고 되돌리기 기록은 만들지 않는다.
  for (const destination of ['1', '2', '4']) {
    await ui.act('step', '3'); await pick('parallax');
    assert.equal(parallaxControls.hidden, false, '3단계에서 패럴랙스 붓이 켜진다');
    await ui.act('step', destination);
    assert.equal(target.value, 'photo', `${destination}단계로 가면 붓 대상이 돌아온다`);
    assert.equal(parallaxControls.hidden, true, '패럴랙스 조절도 다시 숨는다');
  }
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

test('값이 있는 필터가 여럿이면 먼저 오는 것을 보인다', async () => {
  const ui = await mountStudio();
  const set = async (name, value) => { const input = ui.q(`[data-edit="${name}"]`); input.value = String(value); input.dispatchEvent({ type: 'input' }); await settle(); };
  const hidden = name => ui.q(`[data-edit="${name}"]`).closest('label').hidden;
  await set('simplify', 10); await set('cartoon', 20);
  await ui.act('draft'); await ui.act('new');
  assert.equal(hidden('cartoon'), false, '새 초안은 기본(만화풍)이다');
  await ui.click(ui.all('[data-action="open-project"]')[0]);
  assert.equal(hidden('simplify'), false, 'merge가 0이면 값이 있는 첫 필터인 단순화를 보인다');
  assert.equal(hidden('merge'), true); assert.equal(hidden('cartoon'), true);
  assert.equal(ui.q('[data-filter="simplify"]').getAttribute('aria-pressed'), 'true');
  assert.equal(ui.q('[data-edit="cartoon"]').value, '20', '보이지 않는 필터 값도 그대로다');
});

const visible = node => { for (let item = node; item; item = item.parentElement) if (item.hidden) return false; return true; };

test('하단 바: 1단계는 다음만, 2~3단계는 이전·다음, 4단계는 전체 미리보기·게시하기', async () => {
  const ui = await mountStudio();
  const footer = ui.q('.ce-stage-footer');
  const shown = () => ['previous-step', 'replay', 'next-step', 'publish'].filter(name => { const button = footer.querySelector(`[data-action="${name}"]`); return button && !button.hidden; });
  assert.deepEqual(shown(), ['next-step']);
  await ui.act('next-step'); assert.deepEqual(shown(), ['previous-step', 'next-step']);
  await ui.act('next-step'); assert.deepEqual(shown(), ['previous-step', 'next-step']);
  // 규칙 R17: 4단계 하단 바는 전체 미리보기·게시하기만 둔다(명세 우선). 돌아가기는 단계 타일로 한다.
  await ui.act('next-step'); assert.deepEqual(shown(), ['replay', 'publish']);
  assert.equal(footer.querySelector('[data-action="publish"]').textContent, '게시하기');
  await ui.act('step', '3'); assert.deepEqual(shown(), ['previous-step', 'next-step'], '단계 타일로 돌아오면 다시 이전·다음');
});

test('초안 저장·게시 중지·삭제는 ⋯ 메뉴에만 있고 메뉴는 열고 닫힌다', async () => {
  const ui = await mountStudio();
  const menu = ui.q('.ce-menu'), toggle = ui.q('.ce-menu-button');
  for (const name of ['draft', 'unpublish', 'delete']) {
    assert.equal(ui.all(`[data-action="${name}"]`).length, 1, name);
    assert.ok(ui.q(`[data-action="${name}"]`).closest('.ce-menu'), name);
  }
  assert.equal(ui.all('[data-action="publish"]').length, 1);
  assert.equal(ui.q('.ce-publish'), null, '예전 게시 묶음은 없어졌다');
  assert.equal(menu.hidden, true); assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  await ui.click(toggle);
  assert.equal(menu.hidden, false); assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(toggle.getAttribute('aria-controls'), menu.id);
  await ui.act('step', '2');
  assert.equal(menu.hidden, true, '단계를 옮기면 메뉴가 닫힌다');
});

test('알림은 작업 영역에서는 하단 바 위, 스튜디오 홈에서는 홈 위에 있다', async () => {
  const ui = await mountStudio();
  const notice = ui.q('[data-view="notice"]');
  assert.ok(notice.closest('.ce-status-line'), '작업 영역의 알림 줄');
  assert.ok(ui.q('[data-view="save-state"]').closest('.ce-status-line'));
  await ui.act('home');
  assert.ok(notice.closest('[data-view="studio-home"]'), '홈으로 돌아오면 홈 위로');
  assert.equal(visible(notice), true);
});

test('미리보기는 등급·캔버스·재생/각도 줄만 펼치고 나머지는 미리보기 옵션에 접는다', async () => {
  const ui = await mountStudio();
  const preview = ui.q('.ce-preview');
  assert.ok(ui.q('[data-action="play"]').closest('.ce-preview-row'));
  assert.ok(ui.q('[data-control="angle"]').closest('.ce-preview-row'));
  assert.equal(ui.q('[data-action="play"]').getAttribute('aria-label'), '재생');
  const more = preview.querySelector('.ce-preview-more');
  assert.equal(more.open, false);
  for (const selector of ['[data-action="angle-reset"]', '[data-control="reduce-motion"]', '[data-view="preview-caption"]', '[data-view="greeting"]']) assert.ok(ui.q(selector).closest('.ce-preview-more'), selector);
  assert.ok(ui.q('[data-view="distribution"]').closest('details').querySelector('[data-control="campaign"]'), '배포 상태는 게시 정보 안');
});

test('칠한 점이 없는 살아 있는 그림이 있어 저장이 4단계로 돌려보내면 "살아 있는 그림"이 열려 있다', async () => {
  const ui = await mountStudio();
  const living = ui.q('[data-control="living-kind"]').closest('details');
  assert.equal(living.open, false, '처음에는 접혀 있다');
  await ui.act('living-add'); await ui.act('step', '1');
  assert.equal(ui.q('[data-view="workspace"]').dataset.step, '1');
  await ui.act('draft');
  assert.match(ui.q('[data-view="notice"]').textContent, /칠한 점이 없는/);
  assert.equal(ui.q('[data-view="workspace"]').dataset.step, '4', '저장 검증이 4단계로 돌려보낸다');
  assert.equal(living.open, true, '칠할 영역이 보이도록 살아 있는 그림이 열린다');
  assert.equal(ui.api.calls.filter(call => call.method === 'POST').length, 0, '서버로 저장 요청을 보내지 않는다');
});

test('알림 줄과 하단 바는 하나의 고정 하단 묶음 안에 알림 줄이 위, 하단 바가 아래로 있다', async () => {
  const ui = await mountStudio();
  const bottom = ui.q('.ce-stage-bottom'), status = ui.q('.ce-status-line'), footer = ui.q('.ce-stage-footer');
  assert.ok(bottom, '고정 하단 묶음');
  assert.equal(status.parentElement, bottom); assert.equal(footer.parentElement, bottom);
  assert.equal(status.nextElementSibling, footer, '알림 줄이 하단 바 바로 위');
  assert.equal(bottom.parentElement, ui.q('[data-view="workspace"]'));
  await ui.act('step', '3');
  assert.ok(ui.q('[data-view="notice"]').closest('.ce-stage-bottom'), '단계가 바뀌어도 알림은 하단 묶음 안');
  assert.ok(ui.q('[data-view="save-state"]').closest('.ce-stage-bottom'));
});

test('단계를 옮기면 스크롤 칸(작업 영역)을 맨 위로 되돌린다', async () => {
  const ui = await mountStudio();
  const workspace = ui.q('[data-view="workspace"]');
  workspace.scrollTop = 500;
  await ui.act('next-step');
  assert.equal(workspace.scrollTop, 0, '다음 단계');
  workspace.scrollTop = 500;
  await ui.act('step', '4');
  assert.equal(workspace.scrollTop, 0, '단계 타일');
  workspace.scrollTop = 500;
  await ui.act('previous-step');
  assert.equal(workspace.scrollTop, 0, '이전 단계');
});

test('⋯ 메뉴는 동작·홈·단계 이동·Esc로 닫히고 동작·Esc 뒤에만 초점이 ⋯로 돌아온다', async () => {
  const ui = await mountStudio();
  const menu = ui.q('.ce-menu'), toggle = ui.q('.ce-menu-button');
  const open = async () => { if (menu.hidden) await ui.click(toggle); assert.equal(menu.hidden, false); assert.equal(toggle.getAttribute('aria-expanded'), 'true'); };
  const closed = label => { assert.equal(menu.hidden, true, label); assert.equal(toggle.getAttribute('aria-expanded'), 'false', label); };
  await open(); await ui.act('draft'); closed('초안 저장 뒤'); assert.equal(document.activeElement, toggle, '동작 뒤 초점은 ⋯로');
  await open(); await ui.act('home'); closed('홈으로 간 뒤');
  await ui.act('resume'); await open(); toggle.focus(); toggle.dispatchEvent({ type: 'keydown', key: 'Escape', bubbles: true }); await settle();
  closed('Esc 뒤'); assert.equal(document.activeElement, toggle, 'Esc 뒤 초점은 ⋯로');
  await open(); await ui.act('next-step'); closed('단계 이동 뒤');
  assert.notEqual(document.activeElement, toggle, '단계 이동은 초점을 ⋯로 돌리지 않는다');
  assert.equal(ui.q('[data-view="workspace"]').dataset.step, '2');
  await open(); await ui.click(ui.q('[data-action="next-step"]')); closed('다음 단계 버튼 뒤');
  await open(); await ui.click(ui.q('.ce-step-title')); closed('메뉴 밖을 누른 뒤');
});

/** 기록 위치는 즉시 바꾸고 이벤트는 다음 마이크로태스크에 보낸다. */
function installHistory(entries = [null], index = entries.length - 1) {
  const pushes = [];
  let backs = 0, forwards = 0;
  const move = target => {
    if (target < 0 || target >= entries.length) return;
    index = target;
    const state = entries[index];
    queueMicrotask(() => dom.window.dispatch({ type: 'popstate', state }));
  };
  window.history = {
    get state() { return entries[index]; },
    pushState(state, title) {
      entries.splice(index + 1); entries.push(state); index++;
      pushes.push([state, title]);
    },
    back() { backs++; move(index - 1); },
    forward() { forwards++; move(index + 1); },
  };
  cleanups.push(() => { delete window.history; });
  return { entries, pushes, get index() { return index; }, get backs() { return backs; }, get forwards() { return forwards; } };
}

function assertHome(ui) {
  assert.equal(ui.q('[data-view="studio-home"]').hidden, false);
  assert.equal(ui.q('[data-view="workspace"]').hidden, true);
}

test('작업 영역을 열면 기록을 하나 넣고, 뒤로가기는 페이지를 떠나지 않고 홈으로 간다', async () => {
  const history = installHistory(), ui = await mountStudio();
  assert.equal(history.pushes.length, 1); assert.deepEqual(history.pushes[0][0], { collectibleWorkspace: true });
  await ui.act('next-step');
  assert.equal(history.pushes.length, 1, '단계 이동은 기록을 더 넣지 않는다');
  window.history.back(); await settle();
  assertHome(ui);
  assert.equal(history.backs, 1, '뒤로가기로 온 홈 이동은 history.back()을 다시 부르지 않는다');
  assert.equal(history.index, 0);
  await ui.act('resume');
  assert.equal(history.pushes.length, 2, '다시 들어가면 새 기록');
  await ui.act('home');
  assert.equal(history.backs, 2, '← 스튜디오 버튼은 넣었던 기록을 한 번 소비한다');
  assertHome(ui);
});

test('작업 영역 기록으로의 복귀는 편집을 유지하고 다른 객체 기록으로의 이동은 홈을 연다', async () => {
  const history = installHistory([{ other: 1 }, { collectibleWorkspace: true }], 0);
  const ui = await mountStudio();
  window.history.pushState({ collectibleWorkspace: true }, '');
  window.history.back(); await settle();
  assert.equal(ui.q('[data-view="workspace"]').hidden, false, '작업 영역 기록으로 돌아와도 편집을 유지한다');
  assert.equal(ui.q('[data-view="studio-home"]').hidden, true);
  window.history.back(); await settle();
  assertHome(ui);
  assert.deepEqual(window.history.state, { other: 1 });
  assert.equal(history.backs, 2, '다른 객체 기록에서도 back()을 다시 부르지 않는다');
});

test('홈 버튼 직후 다시 들어오면 늦은 뒤로가기 이벤트를 한 번 소비하고 다음 제스처는 홈으로 간다', async () => {
  const history = installHistory(), ui = await mountStudio();
  ui.q('[data-action="home"]').dispatchEvent({ type: 'click' });
  assert.equal(history.backs, 1);
  assertHome(ui);
  ui.q('[data-action="resume"]').dispatchEvent({ type: 'click' });
  assert.equal(history.pushes.length, 2, '기록 이동을 기다리지 않고 재진입한다');
  await settle();
  assert.equal(ui.q('[data-view="workspace"]').hidden, false, '늦은 이벤트는 새 작업 영역을 닫지 않는다');
  assert.equal(ui.q('[data-view="studio-home"]').hidden, true);
  window.history.back(); await settle();
  assertHome(ui);
  assert.equal(history.backs, 2, '다음 실제 제스처 한 번으로 홈에 오고 back()을 다시 부르지 않는다');
  assert.equal(history.index, 0);
});

test('홈에서 앞으로 간 작업 영역 기록을 재사용하면 뒤로가기 한 번으로 홈에 온다', async () => {
  const history = installHistory(), ui = await mountStudio();
  window.history.back(); await settle(); assertHome(ui);
  assert.equal(history.backs, 1);
  window.history.forward(); await settle(); assertHome(ui);
  assert.equal(history.forwards, 1);
  assert.deepEqual(window.history.state, { collectibleWorkspace: true });
  await ui.act('resume');
  assert.equal(ui.q('[data-view="workspace"]').hidden, false);
  assert.equal(history.pushes.length, 1, '앞으로 도착한 현재 항목을 재사용한다');
  assert.equal(history.entries.length, 2);
  window.history.back(); await settle(); assertHome(ui);
  assert.equal(history.backs, 2, '재진입 뒤 뒤로가기는 한 번이다');
  assert.equal(history.index, 0);
});

test('현재 작업 영역 기록에서 제작기를 다시 올리면 새 기록 없이 뒤로가기 한 번으로 홈에 온다', async () => {
  const history = installHistory(), previous = await mountStudio();
  previous.dispose();
  assert.deepEqual(window.history.state, { collectibleWorkspace: true });
  const ui = await mountStudio();
  assert.equal(ui.q('[data-view="workspace"]').hidden, false);
  assert.equal(history.pushes.length, 1, '다시 올린 제작기는 현재 항목을 재사용한다');
  assert.equal(history.entries.length, 2);
  window.history.back(); await settle(); assertHome(ui);
  assert.equal(history.backs, 1);
  assert.equal(history.index, 0);
});

test('history가 없는 환경에서도 열고 닫힌다', async () => {
  const ui = await mountStudio();
  await ui.act('home');
  assert.equal(ui.q('[data-view="studio-home"]').hidden, false);
});

test('저장한 초안을 열 때와 새 초안을 시작할 때도 이어서 편집하기처럼 기록을 하나씩만 넣는다', async () => {
  const history = installHistory(), ui = await mountStudio();
  assert.equal(history.pushes.length, 1, '새 초안으로 처음 들어온다');
  await ui.act('draft'); await ui.act('next-step');
  assert.equal(history.pushes.length, 1, '저장과 단계 이동은 기록을 더 넣지 않는다');
  await ui.act('home');
  assert.equal(history.backs, 1);
  assert.equal(ui.q('[data-view="workspace"]').hidden, true);
  await ui.click(ui.all('[data-action="open-project"]')[0]);
  assert.equal(ui.q('[data-view="workspace"]').hidden, false, '저장한 초안을 열면 작업 영역이다');
  assert.equal(history.pushes.length, 2, '저장한 초안 열기는 기록 하나');
  await ui.act('home');
  assert.equal(history.backs, 2);
  await ui.act('new');
  assert.equal(ui.q('[data-view="workspace"]').hidden, false, '새 초안을 시작하면 작업 영역이다');
  assert.equal(history.pushes.length, 3, '새 초안 시작은 기록 하나');
  assert.equal(ui.q('[data-view="workspace"]').dataset.step, '1');
  for (const [state] of history.pushes) assert.deepEqual(state, { collectibleWorkspace: true });
  window.history.back(); await settle();
  assert.equal(ui.q('[data-view="studio-home"]').hidden, false, '새 초안에서도 뒤로가기는 홈이다');
  assert.equal(history.backs, 3, '뒤로가기로 온 홈 이동은 back()을 부르지 않는다');
});

test('← 스튜디오 버튼 뒤에 따라오는 popstate는 홈 이동도 초점 이동도 다시 하지 않는다', async () => {
  const history = installHistory(), ui = await mountStudio();
  ui.q('[data-action="home"]').dispatchEvent({ type: 'click' });
  assert.equal(history.backs, 1);
  const heading = ui.q('[data-view="studio-home"] h3'); let scrolls = 0;
  heading.scrollIntoView = () => { scrolls++; };
  const marker = ui.q('[data-action="resume"]'); marker.focus();
  await settle();
  assert.ok(document.activeElement === marker, '이미 홈이면 초점을 머리글로 다시 옮기지 않는다');
  assert.equal(scrolls, 0, '홈 머리글로 다시 스크롤하지 않는다');
  assert.equal(history.backs, 1, 'history.back()을 한 번 더 부르지 않는다');
  assertHome(ui);
  assert.equal(history.pushes.length, 1);
});

test('작업 영역이 열린 채 제작기를 닫아도 history.back()을 부르지 않고 그 뒤 popstate도 무시한다', async () => {
  const history = installHistory(), ui = await mountStudio();
  assert.equal(ui.q('[data-view="workspace"]').hidden, false);
  assert.equal(history.pushes.length, 1);
  assert.doesNotThrow(() => ui.dispose());
  assert.equal(history.backs, 0, '제작기를 닫을 때 기록을 소비하지 않는다');
  assert.doesNotThrow(() => window.history.back());
  await settle();
  assert.equal(history.backs, 1, '닫힌 제작기는 뒤로가기 이벤트에 반응하지 않는다');
  assert.equal(history.pushes.length, 1);
});
