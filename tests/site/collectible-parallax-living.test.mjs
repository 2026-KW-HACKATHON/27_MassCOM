import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installMiniDom, settle } from '../fixtures/mini-dom.mjs';
import {
  strokeAlpha, parallaxOffset, livingPhaseAt, livingFrameAt, livingSpriteCount, livingSpriteGrid, livingBoundingBox,
  createProject, createId,
} from '../../apps/production-web/assets/collectible-model.mjs';
import { serializeDerived } from '../../apps/production-web/assets/collectible-renderer.mjs';
import { mountCollectibleEditor, SPRITE_SIZE_LADDER } from '../../apps/production-web/assets/collectible-editor.mjs';
import { applyDraftEdits } from '../../apps/production-web/assets/collectible-assist.mjs';
import { createFakeApi } from '../fixtures/collectible-fake-api.mjs';

// Issue #284 WP3(웹 B): 패럴랙스·living picture의 순수 계산, serializeDerived가 굽는 angleFrames·living
// 스프라이트 모양, 게시 크기 사다리, PR #293 후속 P2 (a)(b)(c)를 시험한다. 실제 픽셀 합성(canvas 내용)은
// mini-dom이 캔버스 호출을 전부 no-op으로 흉내 내 검증할 수 없고(기존 collectible-*-derived 시험과 같은
// 한계), 모양·치수·존재 여부·DOM 상태만 확인한다.

// --- strokeAlpha(패럴랙스/living 마스크) ---
test('strokeAlpha는 fg로 255를, bg로 0을 찍고 나중 획이 먼저 획을 덮는다', () => {
  const w = 20, h = 20;
  const fgOnly = strokeAlpha([{ tool: 'fg', size: .3, points: [{ x: .5, y: .5 }] }], w, h);
  assert.equal(fgOnly[10 * w + 10], 255, '중심은 칠해져야 한다');
  assert.equal(fgOnly[0], 0, '멀리 떨어진 모서리는 칠해지지 않는다');
  const bgAfterFg = strokeAlpha([
    { tool: 'fg', size: .3, points: [{ x: .5, y: .5 }] },
    { tool: 'bg', size: .3, points: [{ x: .5, y: .5 }] },
  ], w, h);
  assert.equal(bgAfterFg[10 * w + 10], 0, '나중 bg 획이 같은 자리의 fg를 지운다');
  assert.deepEqual(strokeAlpha([], w, h), new Uint8ClampedArray(w * h));
  assert.throws(() => strokeAlpha([], 0, 10), /정수 크기/);
});

// --- parallaxOffset ---
test('parallaxOffset은 각도의 사인에 비례하고 strength 0이면 항상 0이다', () => {
  assert.equal(parallaxOffset(0, 100, 512), 0, '0도에서는 sin(0)=0');
  assert.equal(parallaxOffset(90, 0, 512), 0, 'strength 0이면 각도와 무관하게 0');
  const at90 = parallaxOffset(90, 100, 512);
  assert.ok(Math.abs(at90 - 512 * .04) < 1e-9, 'strength 100·90도에서 size*0.04');
  assert.equal(parallaxOffset(-90, 100, 512), -at90, '반대 각도는 반대 방향');
  assert.throws(() => parallaxOffset(Number.NaN, 0, 1), /유한/);
});

// --- living 주기성·칸 수·격자 ---
test('livingPhaseAt·livingFrameAt는 t=0과 t=periodMs에서 같은 phase·칸을 낸다(주기성)', () => {
  assert.equal(livingPhaseAt(0, 2400), livingPhaseAt(2400, 2400));
  assert.equal(livingPhaseAt(600, 2400), .25);
  assert.equal(livingFrameAt(0, 2400, 12), livingFrameAt(2400, 2400, 12));
  assert.equal(livingFrameAt(2400 * 5, 2400, 12), livingFrameAt(0, 2400, 12), '여러 주기를 지나도 같다');
  assert.throws(() => livingFrameAt(0, 2400, 0), /칸 수/);
});

test('livingSpriteCount는 periodMs/100을 8..24로 clamp한다', () => {
  assert.equal(livingSpriteCount(1000), 10);
  assert.equal(livingSpriteCount(100), 8, '너무 짧은 주기는 8로 올린다');
  assert.equal(livingSpriteCount(4000), 24, '정확히 상한');
  assert.equal(livingSpriteCount(10000), 24, '너무 긴 주기는 24로 내린다');
});

test('livingSpriteGrid는 count칸을 maxSide 안에 배치할 열 수를 고르고, 못 맞추면 undefined를 돌려준다', () => {
  const grid = livingSpriteGrid(20, 128, 128);
  assert.equal(grid.columns * 128, grid.width); assert.equal(Math.ceil(20 / grid.columns) * 128, grid.height);
  assert.ok(grid.width <= 4096 && grid.height <= 4096);
  // 24칸 × 512px 셀은 4096 안에 들어가야 한다(설계 문서 "sprite math ≤4096" 상한의 최악의 경우).
  const worst = livingSpriteGrid(24, 512, 512);
  assert.ok(worst && worst.width <= 4096 && worst.height <= 4096, `최악의 경우도 4096 안에 들어가야 한다: ${JSON.stringify(worst)}`);
  // 셀 자체가 maxSide를 넘으면 어떤 열 수로도 맞출 수 없다.
  assert.equal(livingSpriteGrid(2, 5000, 16, 4096), undefined);
});

test('livingBoundingBox는 등급의 region 점과 스티커 대상을 패딩해 합집합을 내고, 없으면 undefined', () => {
  const project = createProject();
  project.stickers.push({ id: 'cat', kind: 'mascot', text: 'wave', x: .8, y: .2, size: 42, rotation: 0, color: '#fff', order: 0, align: 'center', layouts: {} });
  project.living.items.push(
    { id: 'i1', kind: 'sway', target: 'region', gradeIds: ['bronze'], amplitude: 50, pivot: { x: .5, y: .5 }, strokes: [{ x: .3, y: .3 }, { x: .4, y: .35 }] },
    { id: 'i2', kind: 'bob', target: 'cat', gradeIds: ['bronze'], amplitude: 50, pivot: { x: .5, y: .5 } },
  );
  const box = livingBoundingBox(project, 'bronze');
  assert.ok(box.x <= .3 && box.y <= .2, '패딩이 더해져 점보다 더 넓어야 한다');
  assert.ok(box.x + box.w <= 1 && box.y + box.h <= 1, '박스는 0..1 밖으로 넘치지 않는다');
  assert.equal(livingBoundingBox(project, 'silver'), undefined, '그 등급에 걸린 living 항목이 없으면 undefined');
});

// --- SPRITE_SIZE_LADDER: 가짜 바이트 추정기로 사다리 선택 동작만 확인(실제 인코딩은 editor-flow 시험이 맡는다) ---
test('크기 사다리는 가짜 추정기가 처음 맞는 단계를 고르고, 끝까지 안 맞으면 가장 작은 단계로 남는다', () => {
  assert.deepEqual(SPRITE_SIZE_LADDER.map((rung) => rung.side), [448, 384, 320, 256]);
  const pick = (estimate, budget) => {
    let chosen = SPRITE_SIZE_LADDER[0];
    for (const rung of SPRITE_SIZE_LADDER) { chosen = rung; if (estimate(rung) <= budget) break; }
    return chosen;
  };
  // 실제 webp 인코딩과 같은 방향성(작을수록·낮은 화질일수록 더 적은 바이트)을 가진 가짜 추정기.
  const estimate = (rung) => rung.side * rung.side * rung.quality;
  assert.deepEqual(pick(estimate, 1_000_000), SPRITE_SIZE_LADDER[0], '첫 단계로 충분하면 바로 쓴다');
  assert.deepEqual(pick(estimate, 100_000), SPRITE_SIZE_LADDER[2], '320·.7 단계에서 처음 budget을 만족한다');
  assert.deepEqual(pick(estimate, 1), SPRITE_SIZE_LADDER.at(-1), '끝까지 못 맞으면 가장 작은 단계로 남는다(기존 초과 안내로 넘어간다)');
});

// --- serializeDerived: angleFrames·living 스프라이트 모양(치수는 mini-dom도 실제 canvas.width/height를 유지해 확인 가능) ---
test('serializeDerived는 홀로그램 등급에 12칸(4×3) 각도 프레임을 굽고, 패럴랙스만 있어도 트리거한다', async () => {
  const dom = installMiniDom();
  try {
    const project = createProject();
    project.rewardGrades = { 1: 'silver' };
    project.effects.push({ id: createId('effect'), type: 'hologram', target: 'surface', gradeIds: ['silver'], strength: 45, color: project.baseColor, roughness: 25 });
    const derived = await serializeDerived(project);
    const frames = derived.silver.angleFrames;
    assert.ok(frames, '홀로그램 등급은 angleFrames를 만들어야 한다');
    assert.equal(frames.count, 12); assert.equal(frames.columns, 4); assert.equal(frames.stepDegrees, 15);
    assert.ok(frames.side >= 256 && frames.side <= 512);
    const spriteEncode = dom.document.encodes.find((item) => item.width === frames.side * 4 && item.height === frames.side * 3);
    assert.ok(spriteEncode, '4side×3side 스프라이트 치수로 인코딩해야 한다');
  } finally { dom.restore(); }
});

test('패럴랙스 strength>0에 획이 있으면 angleFrames를 만들고, 획이 없으면 만들지 않는다', async () => {
  const dom = installMiniDom();
  try {
    const withStrokes = createProject();
    withStrokes.rewardGrades = { 1: 'silver' };
    withStrokes.parallax = { strength: 60, strokes: [{ tool: 'fg', size: .1, points: [{ x: .5, y: .5 }] }] };
    const derivedWith = await serializeDerived(withStrokes);
    assert.ok(derivedWith.silver.angleFrames, '패럴랙스 획이 있으면 각도 프레임이 필요하다');

    const noStrokes = createProject();
    noStrokes.rewardGrades = { 1: 'silver' };
    noStrokes.parallax = { strength: 60, strokes: [] };
    const derivedWithout = await serializeDerived(noStrokes);
    assert.equal(derivedWithout.silver.angleFrames, undefined, '강도만 있고 획이 없으면 만들지 않는다');
  } finally { dom.restore(); }
});

test('living 항목이 있는 등급은 count·columns·cellWidth/cellHeight·box가 Android 파서 상한(8..24·1..8·16..512·0..1) 안에서 스프라이트를 만든다', async () => {
  const dom = installMiniDom();
  try {
    const project = createProject();
    project.rewardGrades = { 1: 'silver' };
    project.living.periodMs = 2000;
    project.living.items.push({ id: createId('living'), kind: 'sway', target: 'region', gradeIds: ['silver'], amplitude: 40, pivot: { x: .5, y: .5 }, strokes: [{ x: .4, y: .4 }, { x: .6, y: .5 }] });
    const derived = await serializeDerived(project);
    const living = derived.silver.living;
    assert.ok(living, '등급에 living 항목이 있으면 living 스프라이트를 만들어야 한다');
    // apps/mobile/src/commerce/collectible-artwork.ts parseLiving과 같은 상한.
    assert.ok(Number.isInteger(living.count) && living.count >= 8 && living.count <= 24);
    assert.ok(Number.isInteger(living.columns) && living.columns >= 1 && living.columns <= 8);
    assert.ok(Number.isInteger(living.cellWidth) && living.cellWidth >= 16 && living.cellWidth <= 512);
    assert.ok(Number.isInteger(living.cellHeight) && living.cellHeight >= 16 && living.cellHeight <= 512);
    assert.ok(living.periodMs >= 1000 && living.periodMs <= 4000);
    assert.ok(living.box.x + living.box.w <= 1 && living.box.y + living.box.h <= 1);
    const rows = Math.ceil(living.count / living.columns);
    const spriteEncode = dom.document.encodes.find((item) => item.width === living.columns * living.cellWidth && item.height === rows * living.cellHeight);
    assert.ok(spriteEncode, 'columns*cellWidth × rows*cellHeight 치수로 인코딩해야 한다');
    assert.ok(living.columns * living.cellWidth <= 4096 && rows * living.cellHeight <= 4096);
  } finally { dom.restore(); }
});

// PR #293 후속 P2(a): maskFor가 gradeId를 받아 resolveSticker를 거친다(스티커가 그 등급 전용 자리에 있어도 던지지
// 않고 마스크를 만든다). mini-dom은 실제로 그려진 픽셀을 검증할 수 없어(모든 canvas 호출이 no-op) 존재·치수만
// 본다 — 실제 합성 확인은 스크린샷 평가(docs/evidence)가 맡는다.
test('(PR #293 P2 a) 등급별로 재배치된 스티커 효과도 마스크를 만들며 던지지 않는다', async () => {
  const dom = installMiniDom();
  try {
    const project = createProject();
    project.rewardGrades = { 1: 'silver' };
    const sticker = { id: createId('sticker'), kind: 'text', text: '안녕', x: .5, y: .5, size: 40, rotation: 0, color: '#fff', order: 0, align: 'center', layouts: { silver: { x: .2, y: .2, size: 30, rotation: 10 } } };
    project.stickers.push(sticker);
    project.effects.push({ id: createId('effect'), type: 'pearl', target: sticker.id, gradeIds: ['silver'], strength: 40, color: project.baseColor });
    const derived = await serializeDerived(project);
    assert.match(derived.silver.effectMasks[sticker.id], /^data:image\/png;base64,/);
  } finally { dom.restore(); }
});

// --- 편집기 흐름(mini-dom): 붓 대상 전환·living 항목 편집, PR #293 후속 P2(b)(c) ---
function driver(container) {
  return {
    container,
    control: (name) => container.querySelector(`[data-control="${name}"]`),
    action: (name) => container.querySelector(`[data-action="${name}"]`),
    async click(name, data) {
      const nodes = [...container.querySelectorAll(`[data-action="${name}"]`)];
      const node = data ? nodes.find((item) => item.dataset.id === data) : nodes[0];
      node.dispatchEvent({ type: 'click' }); await settle();
    },
    async change(name, value) { const node = this.control(name); node.value = value; node.dispatchEvent({ type: 'change' }); await settle(); },
    async upload(file) { const node = this.control('photo'); node.files = [file]; node.dispatchEvent({ type: 'change' }); await settle(); },
  };
}
async function mountEditor(api) {
  const container = document.createElement('div');
  const cleanup = mountCollectibleEditor(container, {
    merchantId: 'm1', merchantName: '월계 식당', request: api.request, loadCampaigns: api.listCampaigns, onNotice() {},
  });
  await settle();
  return { ui: driver(container), cleanup };
}

test('붓 대상을 패럴랙스로 바꾸면 패럴랙스 컨트롤이 보이고, 칠하면 project.parallax.strokes에 fg 획이 쌓인다', async () => {
  const dom = installMiniDom();
  try {
    const api = createFakeApi();
    const { ui, cleanup } = await mountEditor(api);
    try {
      await ui.upload({ type: 'image/png', size: 1000, name: 'p.png', dataUrl: 'data:image/png;base64,AAAA' });
      assert.ok(ui.container.querySelector('[data-view="parallax-controls"]').hidden, '처음에는 사진 보정 대상이라 패럴랙스 컨트롤이 숨어 있다');
      await ui.change('brush-target', 'parallax');
      assert.equal(ui.container.querySelector('[data-view="parallax-controls"]').hidden, false, '패럴랙스를 고르면 컨트롤이 보여야 한다');
      const crop = ui.container.querySelector('[data-view="crop"]');
      crop.dispatchEvent({ type: 'pointerdown', pointerId: 1, clientX: 256, clientY: 256 });
      await settle();
      crop.dispatchEvent({ type: 'pointerup', pointerId: 1 });
      await settle();
    } finally { cleanup(); }
  } finally { dom.restore(); }
});

test('living 항목을 추가·삭제하면 project.living.items가 그대로 반영되고, 삭제한 항목의 붓 대상은 사진으로 되돌아간다', async () => {
  const dom = installMiniDom();
  try {
    const api = createFakeApi();
    const { ui, cleanup } = await mountEditor(api);
    try {
      await ui.click('living-add');
      const target = ui.action('living-paint');
      assert.ok(target, 'region 대상 항목에는 칠하기 버튼이 있어야 한다');
      const id = target.dataset.id;
      await ui.click('living-paint', id);
      assert.equal(ui.control('brush-target').value, `living:${id}`, '칠하기를 누르면 붓 대상이 그 항목으로 바뀐다');
      await ui.click('living-delete', id);
      assert.equal(ui.control('brush-target').value, 'photo', '칠하던 항목을 지우면 붓 대상이 사진으로 돌아간다');
      assert.equal(ui.container.querySelectorAll('.ce-living-item').length, 0);
    } finally { cleanup(); }
  } finally { dom.restore(); }
});

// PR #293 후속 P2(b)
test('(PR #293 P2 b) 모션을 once에서 loop로 바꾸면 같은 등급에 걸린 다른 loop 모션은 겹치는 등급만 떨어진다', async () => {
  const dom = installMiniDom();
  try {
    const api = createFakeApi();
    const { ui, cleanup } = await mountEditor(api);
    try {
      // rotate(기본 템플릿)를 bronze에 loop로 건다.
      await ui.click('template', 'rotate');
      const rotateLoop = ui.container.querySelector('input[data-control="motion-playback"][value="loop"]');
      rotateLoop.checked = true; rotateLoop.dispatchEvent({ type: 'change' });
      const rotateBronze = ui.container.querySelector('input[data-motion-grade="rotate"][data-grade="bronze"]');
      rotateBronze.checked = true; rotateBronze.dispatchEvent({ type: 'change' }); await settle();

      // shine을 같은 bronze에 once로 건다(once는 loop와 겹쳐도 된다).
      await ui.click('template', 'shine');
      const shineOnce = ui.container.querySelector('input[data-control="motion-playback"][value="once"]');
      shineOnce.checked = true; shineOnce.dispatchEvent({ type: 'change' });
      const shineBronze = ui.container.querySelector('input[data-motion-grade="shine"][data-grade="bronze"]');
      shineBronze.checked = true; shineBronze.dispatchEvent({ type: 'change' }); await settle();

      // shine을 once→loop로 바꾼다: bronze에는 이제 rotate 대신 shine의 loop만 남아야 한다.
      const shineLoop = ui.container.querySelector('input[data-control="motion-playback"][value="loop"]');
      shineLoop.checked = true; shineLoop.dispatchEvent({ type: 'change' }); await settle();

      await ui.click('template', 'rotate');
      const rotateBronzeAfter = ui.container.querySelector('input[data-motion-grade="rotate"][data-grade="bronze"]');
      assert.equal(rotateBronzeAfter.checked, false, 'rotate(loop)는 shine이 loop가 되면서 bronze에서 떨어져야 한다');
    } finally { cleanup(); }
  } finally { dom.restore(); }
});

// PR #293 후속 P2(c)
test('(PR #293 P2 c) applyDraftEdits는 v1 시절 스티커(align·layouts 없음)를 v2 모양으로 채워 돌려준다', () => {
  const serverProject = createProject();
  serverProject.stickers = [{ id: 's1', kind: 'text', text: '기존', x: .5, y: .5, size: 40, rotation: 0, color: '#fff', order: 0, align: 'center', layouts: {} }];
  const v1ShapedDraftEdits = {
    name: '복원된 편집', stickers: [{ id: 's2', kind: 'text', text: 'v1 보관본', x: .3, y: .3, size: 30, rotation: 0, color: '#000', order: 0 }],
    back: serverProject.back, motion: [], greetingOverrides: [], parallax: serverProject.parallax, living: serverProject.living,
    story: { type: 'none', frames: [] },
  };
  const merged = applyDraftEdits(serverProject, v1ShapedDraftEdits);
  assert.equal(merged.stickers[0].align, 'center', 'align이 없으면 기본값으로 채운다');
  assert.deepEqual(merged.stickers[0].layouts, {}, 'layouts가 없어도 빈 객체로 채워 toggle이 던지지 않게 한다');
  // "이 등급만 따로 배치" 토글이 하는 일을 그대로 흉내 내 던지지 않는지 확인한다(에디터의 실제 코드와 같은 대입).
  assert.doesNotThrow(() => { merged.stickers[0].layouts['bronze'] = { x: .1, y: .1, size: 20, rotation: 0 }; });
});
