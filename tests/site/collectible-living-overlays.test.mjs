import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installMiniDom } from '../fixtures/mini-dom.mjs';
import { createProject, livingBoundingBox, shapePoints } from '../../apps/production-web/assets/collectible-model.mjs';
import { livingOverlayFor, renderCollectible, serializeDerived } from '../../apps/production-web/assets/collectible-renderer.mjs';

test('steam sprite box contains the full rising plume, including its pivot away from painted strokes', () => {
  const project = createProject();
  project.photo = { originalDataUrl: '', width: 512, height: 512 };
  project.living.items.push({ id: 'steam', kind: 'steam', target: 'region', gradeIds: ['bronze'], amplitude: 0,
    pivot: { x: .65, y: .55 }, strokes: [{ x: .2, y: .8 }] });
  const box = livingBoundingBox(project, 'bronze', 0);
  assert.ok(box.x <= .65 - .03 && box.x + box.w >= .65 + .03, 'plume width surrounds its pivot');
  assert.ok(box.y <= .55 - .22 - .03 && box.y + box.h >= .55 + .03, 'plume rise and radius fit');
});

function recordCanvas() {
  const canvases = [];
  const create = document.createElement.bind(document);
  document.createElement = (tag) => {
    const canvas = create(tag);
    if (tag === 'canvas') {
      const calls = [];
      const getContext = canvas.getContext.bind(canvas);
      canvas.getContext = (...args) => {
        const context = getContext(...args);
        for (const name of ['fillText', 'fillRect', 'drawImage', 'moveTo', 'lineTo', 'clip']) {
          if (!Object.hasOwn(context, name)) context[name] = (...values) => calls.push({ name, values, composite: context.globalCompositeOperation });
        }
        return context;
      };
      canvas.calls = calls;
      canvases.push(canvas);
    }
    return canvas;
  };
  return { canvases, restore: () => { document.createElement = create; } };
}

function livingStickerProject() {
  const project = createProject();
  project.shape = 'stamp';
  project.stickers.push({ id: 'label', kind: 'text', text: 'LIVE', x: .95, y: .5, size: 80, rotation: 0, color: '#fff', order: 0, align: 'center', layouts: {} });
  project.living.items.push({ id: 'moving-label', kind: 'bob', target: 'label', gradeIds: ['bronze'], amplitude: 40, pivot: { x: .5, y: .5 } });
  return project;
}

test('living sticker retains its grade and target material effect', async () => {
  const dom = installMiniDom(), recorder = recordCanvas();
  try {
    const project = livingStickerProject();
    project.effects.push({ id: 'material', type: 'enamel', target: 'label', gradeIds: ['bronze'], strength: 80, color: '#e4b954' });
    await livingOverlayFor(project, 'bronze', 256, .25);
    assert.ok(recorder.canvases.some((canvas) => canvas.calls.some((call) => call.name === 'fillText') &&
      recorder.canvases.some((painted) => painted.calls.some((call) => call.name === 'drawImage' && call.values[0] === canvas) &&
        painted.calls.some((call) => call.name === 'fillRect' && call.composite === 'overlay'))),
    'enamel must be painted onto the living sticker layer');
  } finally { recorder.restore(); dom.restore(); }
});

test('living overlay clips to the project shape before painting an edge sticker', async () => {
  const dom = installMiniDom(), recorder = recordCanvas();
  try {
    const overlay = await livingOverlayFor(livingStickerProject(), 'bronze', 256, .25);
    const calls = overlay.calls.map((call) => call.name);
    assert.ok(calls.includes('clip'), 'the overlay must use the project shape as a clip');
    assert.ok(calls.indexOf('clip') < calls.indexOf('drawImage'), 'the clip must precede the sticker draw');
    assert.deepEqual(overlay.calls.find((call) => call.name === 'moveTo')?.values,
      [shapePoints('stamp', 256, 256)[0].x, shapePoints('stamp', 256, 256)[0].y], 'the clip traces the stamp path');
  } finally { recorder.restore(); dom.restore(); }
});

test('preview and published sprite both draw the clipped material living layer', async () => {
  const dom = installMiniDom(), recorder = recordCanvas();
  try {
    const project = livingStickerProject();
    project.rewardGrades = { 1: 'bronze' };
    project.effects.push({ id: 'material', type: 'enamel', target: 'label', gradeIds: ['bronze'], strength: 80, color: '#e4b954' });
    const matchingOverlays = () => recorder.canvases.filter((canvas) => {
      const clip = canvas.calls.findIndex((call) => call.name === 'clip');
      return clip >= 0 && canvas.calls.slice(clip + 1).some((call) => {
        const layer = call.name === 'drawImage' && call.values[0];
        return layer?.calls?.some((paint) => paint.name === 'fillText') &&
          recorder.canvases.some((painted) => painted.calls.some((paint) => paint.name === 'drawImage' && paint.values[0] === layer) &&
            painted.calls.some((paint) => paint.name === 'fillRect' && paint.composite === 'overlay'));
      });
    }).length;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    await renderCollectible(canvas, project, 'bronze', { textureSize: 256, staticFrame: true });
    assert.ok(matchingOverlays() >= 1, 'preview draws the living layer');
    const beforePublish = matchingOverlays();
    const derived = await serializeDerived(project, { angleSide: 256 });
    assert.ok(derived.bronze.living, 'published output includes a living sprite');
    assert.ok(matchingOverlays() > beforePublish, 'published sprite also draws the living layer');
  } finally { recorder.restore(); dom.restore(); }
});
