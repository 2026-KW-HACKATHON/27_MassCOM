import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installMiniDom } from '../fixtures/mini-dom.mjs';
import { backFor, serializeDerived } from '../../apps/production-web/assets/collectible-renderer.mjs';
import { createProject } from '../../apps/production-web/assets/collectible-model.mjs';

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

test('serializeDerived only bakes grades linked in rewardGrades, plus an optional preview grade, and no longer produces base/effectMasks', async () => {
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
      assert.equal(asset.baseDataUrl, undefined, 'WP2부터 base는 더 만들지 않는다');
      assert.equal(asset.effectMasks, undefined, 'WP2부터 effectMasks는 더 만들지 않는다');
    }

    const withPreview = await serializeDerived(project, { extraGradeId: 'gold' });
    assert.deepEqual(Object.keys(withPreview).sort(), ['gold', 'silver']);

    const disabledPreview = await serializeDerived(project, { extraGradeId: 'nonexistent-grade' });
    assert.deepEqual(Object.keys(disabledPreview), ['silver'], '존재하지 않는 미리보기 등급은 조용히 무시한다');
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
