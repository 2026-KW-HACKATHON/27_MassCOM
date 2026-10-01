import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installMiniDom } from '../fixtures/mini-dom.mjs';
import { backFor, serializeDerived } from '../../apps/production-web/assets/collectible-renderer.mjs';
import { createProject, createId } from '../../apps/production-web/assets/collectible-model.mjs';

// Issue #284 WP2: backFor(뒷면)와 serializeDerived(연결된 등급만 굽기)는 canvas가 필요해 mini-dom으로 시험한다.
test('backFor returns a canvas sized to the request for both default and custom back modes', async () => {
  const dom = installMiniDom();
  try {
    const project = createProject({ name: '월계 수집품' });
    const defaultBack = await backFor(project, 'bronze', 256, '월계 식당');
    assert.equal(defaultBack.width, 256);
    assert.equal(defaultBack.height, 256);

    project.back = {
      mode: 'custom', color: '#112233',
      stickers: [{ id: 'back-1', kind: 'text', text: '뒷면', x: .5, y: .5, size: 30, rotation: 0, color: '#ffffff', order: 0 }],
    };
    const customBack = await backFor(project, 'bronze', 128, '');
    assert.equal(customBack.width, 128);
    assert.equal(customBack.height, 128);
  } finally { dom.restore(); }
});

test('backFor draws a mascot stamp sticker on the custom back without throwing', async () => {
  const dom = installMiniDom();
  try {
    const project = createProject();
    project.back = {
      mode: 'custom', color: '#445566',
      stickers: [{ id: 'mascot-1', kind: 'mascot', text: 'wave', x: .5, y: .5, size: 40, rotation: 0, color: '#ffffff', order: 0 }],
    };
    const canvas = await backFor(project, 'bronze', 64, '');
    assert.equal(canvas.width, 64);
  } finally { dom.restore(); }
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
