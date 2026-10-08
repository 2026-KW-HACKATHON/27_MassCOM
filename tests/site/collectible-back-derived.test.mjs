import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installMiniDom } from '../fixtures/mini-dom.mjs';
import { backFor, serializeDerived, renderPublishedCollectible, clearCollectibleRenderCache } from '../../apps/production-web/assets/collectible-renderer.mjs';
import { createProject, createId, shapePoints } from '../../apps/production-web/assets/collectible-model.mjs';
import { COLLECTIBLE_BACK_SHAPES, COLLECTIBLE_BACK_GRADES, fixedCollectibleBack } from '../../apps/production-web/assets/collectible-back-assets.mjs';

// Issue #284 WP2: backFor(뒷면)와 serializeDerived(연결된 등급만 굽기)는 canvas가 필요해 mini-dom으로 시험한다.
function trackCanvas(document) {
  const calls = [], create = document.createElement.bind(document);
  document.createElement = tag => {
    const node = create(tag);
    if (tag === 'canvas') {
      const context = node.getContext('2d');
      for (const method of ['moveTo', 'lineTo', 'clip', 'drawImage', 'fillText', 'fillRect', 'stroke']) {
        const original = context[method];
        context[method] = (...args) => { calls.push({ canvas: node, method, args }); return original(...args); };
      }
    }
    return node;
  };
  return calls;
}

test('all twelve fixed backs use the exact front outline and ignore legacy color, names, photos and stickers', async () => {
  const dom = installMiniDom();
  clearCollectibleRenderCache();
  try {
    const calls = trackCanvas(dom.document);
    const project = createProject({ name: '월계 수집품' });
    project.photo.originalDataUrl = 'data:image/png;base64,merchant-photo';
    project.back = {
      mode: 'custom', color: '#112233',
      stickers: [{ id: 'back-1', kind: 'text', text: '뒷면', x: .5, y: .5, size: 30, rotation: 0, color: '#ffffff', order: 0 }],
    };
    const legacyBack = structuredClone(project.back);
    for (const shape of COLLECTIBLE_BACK_SHAPES) for (const grade of COLLECTIBLE_BACK_GRADES) {
      project.shape = shape;
      const canvas = await backFor(project, grade, 256, '월계 식당');
      assert.equal(canvas.width, 256); assert.equal(canvas.height, 256);
      const rendered = calls.filter(call => call.canvas === canvas);
      assert.deepEqual(rendered.filter(call => ['moveTo', 'lineTo'].includes(call.method)).map(call => ({ x: call.args[0], y: call.args[1] })), shapePoints(shape, 256, 256));
      assert.equal(rendered.filter(call => call.method === 'clip').length, 1);
      const drawings = rendered.filter(call => call.method === 'drawImage');
      assert.equal(drawings.length, 1, '공용 이미지 한 장만 그리고 사용자 스티커를 얹지 않는다');
      assert.equal(drawings[0].args[0].src, fixedCollectibleBack(shape, grade).path);
      assert.deepEqual(drawings[0].args.slice(1), [0, 0, 256, 256]);
      assert.equal(rendered.some(call => ['fillText', 'fillRect', 'stroke'].includes(call.method)), false, '옛 이름·바탕색·테두리 덧그리기를 하지 않는다');
    }
    assert.deepEqual(project.back, legacyBack, '옛 저장 형식은 지우거나 고치지 않는다');
  } finally { clearCollectibleRenderCache(); dom.restore(); }
});

test('custom grade and unsupported shape use the deterministic circle bronze back', async () => {
  const dom = installMiniDom();
  clearCollectibleRenderCache();
  try {
    const calls = trackCanvas(dom.document);
    const project = createProject();
    project.shape = 'unsupported';
    const canvas = await backFor(project, 'festival-gold', 64);
    assert.equal(canvas.width, 64);
    assert.equal(calls.find(call => call.method === 'drawImage').args[0].src, fixedCollectibleBack('circle', 'bronze').path);
  } finally { clearCollectibleRenderCache(); dom.restore(); }
});

test('fixed back loading errors reject instead of drawing a cardboard fallback and can be retried', async () => {
  const dom = installMiniDom();
  clearCollectibleRenderCache();
  const Image = globalThis.Image;
  try {
    const calls = trackCanvas(dom.document);
    globalThis.Image = class { set src(value) { setTimeout(() => this.onerror?.(), 0); } };
    await assert.rejects(backFor(createProject(), 'bronze', 128), /정해진 뒷면 이미지를 불러오지 못했어요/);
    assert.equal(calls.length, 0, '불러오기 실패 시 낡은 바탕을 그리지 않는다');
    globalThis.Image = Image;
    assert.equal((await backFor(createProject(), 'bronze', 128)).width, 128, '실패한 캐시는 지워 재시도할 수 있다');
  } finally { globalThis.Image = Image; clearCollectibleRenderCache(); dom.restore(); }
});

test('published back images remain authoritative and a missing old back uses the same fixed asset', async () => {
  const dom = installMiniDom();
  clearCollectibleRenderCache();
  const Image = globalThis.Image, requested = [];
  try {
    globalThis.Image = class extends Image { set src(value) { requested.push(value); super.src = value; } get src() { return super.src; } };
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    const snapshot = { shape: 'stamp', gradeId: 'silver', name: '이미 받은 수집품', imageDataUrl: 'data:image/webp;base64,front', backImageDataUrl: 'data:image/webp;base64,published-back', angle: 180 };
    const before = structuredClone(snapshot);
    await renderPublishedCollectible(canvas, snapshot, { staticFrame: true });
    assert.deepEqual(snapshot, before);
    assert.ok(requested.includes(snapshot.backImageDataUrl));
    assert.equal(requested.some(source => source.includes('collectible-backs/')), false, '이미 받은 뒷면을 새로운 공용 이미지로 교체하지 않는다');
    requested.length = 0;
    await renderPublishedCollectible(canvas, { ...snapshot, backImageDataUrl: undefined }, { staticFrame: true });
    assert.deepEqual(requested, [fixedCollectibleBack('stamp', 'silver').path]);
    requested.length = 0;
    const mobileAlias = { ...snapshot, shape: 'gear', backImageDataUrl: undefined };
    await renderPublishedCollectible(canvas, mobileAlias, { staticFrame: true });
    assert.deepEqual(requested, [fixedCollectibleBack('serrated', 'silver').path]);
    assert.equal(mobileAlias.shape, 'gear', '모바일 구 발행본 윤곽을 읽어도 발행 snapshot을 바꾸지 않는다');
  } finally { globalThis.Image = Image; clearCollectibleRenderCache(); dom.restore(); }
});

test('serializeDerived only bakes grades linked in rewardGrades, plus an optional preview grade, and still produces base/effectMasks for effect compositing(PR #293 P2)', async () => {
  const dom = installMiniDom();
  try {
    const project = createProject();
    project.rewardGrades = { 1: 'silver' };
    const derived = await serializeDerived(project);
    assert.deepEqual(Object.keys(derived), ['silver']);
    for (const asset of Object.values(derived)) {
      assert.match(asset.imageDataUrl, /^data:image\//);
      assert.match(asset.thumbnailDataUrl, /^data:image\//);
      assert.match(asset.backImageDataUrl, /^data:image\//);
      assert.match(asset.baseDataUrl, /^data:image\//, '뷰어가 각도별로 효과를 다시 합성하려면 base가 있어야 한다');
      assert.deepEqual(asset.effectMasks, {}, '효과가 없는 등급은 mask도 비어 있다');
    }

    const withPreview = await serializeDerived(project, { extraGradeId: 'gold' });
    assert.deepEqual(Object.keys(withPreview).sort(), ['gold', 'silver']);

    const disabledPreview = await serializeDerived(project, { extraGradeId: 'nonexistent-grade' });
    assert.deepEqual(Object.keys(disabledPreview), ['silver'], '존재하지 않는 미리보기 등급은 조용히 무시한다');
  } finally { dom.restore(); }
});

test('serializeDerived bakes base + a mask for a linked grade with a hologram effect(PR #293 P2)', async () => {
  const dom = installMiniDom();
  try {
    const project = createProject();
    project.rewardGrades = { 1: 'silver' };
    project.effects.push({ id: createId('effect'), type: 'hologram', target: 'surface', gradeIds: ['silver'], strength: 45, color: project.baseColor, roughness: 25 });
    const derived = await serializeDerived(project);
    const silver = derived.silver;
    assert.match(silver.baseDataUrl, /^data:image\//);
    assert.match(silver.effectMasks.surface, /^data:image\/png;base64,/, '마스크는 투명도를 지키는 PNG로 만든다');
    assert.equal(Object.keys(silver.effectMasks).length, 1, '등급에 걸린 효과 대상(surface)만 마스크를 만든다');
  } finally { dom.restore(); }
});

test('serializeDerived skips a disabled grade even if it is linked or the preview grade', async () => {
  const dom = installMiniDom();
  try {
    const project = createProject();
    project.grades.find((grade) => grade.id === 'silver').enabled = false;
    project.rewardGrades = { 1: 'silver' };
    const derived = await serializeDerived(project, { extraGradeId: 'silver' });
    assert.deepEqual(Object.keys(derived), []);
  } finally { dom.restore(); }
});
