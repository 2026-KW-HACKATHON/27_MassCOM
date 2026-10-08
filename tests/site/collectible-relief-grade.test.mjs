import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installMiniDom } from '../fixtures/mini-dom.mjs';
import { createProject, createGrade } from '../../apps/production-web/assets/collectible-model.mjs';
import {
  clearCollectibleRenderCache, collectibleReliefTint, processPhotoPixels, serializeDerived,
} from '../../apps/production-web/assets/collectible-renderer.mjs';

const sourcePixels = (width = 4, height = 4) => {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = (y * width + x) * 4;
    pixels[index] = 40 + x * 35; pixels[index + 1] = 70 + y * 25; pixels[index + 2] = 110 + (x + y) * 12; pixels[index + 3] = 255;
  }
  return pixels;
};

const pixelAt = (pixels, width, x, y) => Array.from(pixels.slice((y * width + x) * 4, (y * width + x) * 4 + 4));
const reliefSample = (gradeId, style = 'raised') => processPhotoPixels(sourcePixels(), 4, 4, {}, style, collectibleReliefTint(createProject(), gradeId), 0, 55);
const brushSample = (gradeId, stroke) => processPhotoPixels(sourcePixels(), 4, 4, { strokes: [stroke] }, 'raised', collectibleReliefTint(createProject(), gradeId), 0, 55);

function installPixelCanvas(dom) {
  const originalCreate = dom.document.createElement.bind(dom.document);
  const source = sourcePixels();
  const ensure = canvas => {
    const length = canvas.width * canvas.height * 4;
    if (!canvas._pixels || canvas._pixels.length !== length) canvas._pixels = new Uint8ClampedArray(length);
    return canvas._pixels;
  };
  const parseColor = color => {
    const match = String(color || '').match(/^#([0-9a-f]{6})$/i);
    return match ? [1, 3, 5].map(index => parseInt(match[1].slice(index - 1, index + 1), 16)) : [0, 0, 0];
  };
  const copyPixels = (target, from, sw, sh, dx = 0, dy = 0, dw = target.width, dh = target.height) => {
    const out = ensure(target);
    for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
      const tx = Math.round(dx + x), ty = Math.round(dy + y);
      if (tx < 0 || ty < 0 || tx >= target.width || ty >= target.height) continue;
      const sx = Math.min(sw - 1, Math.max(0, Math.floor(x * sw / Math.max(1, dw))));
      const sy = Math.min(sh - 1, Math.max(0, Math.floor(y * sh / Math.max(1, dh))));
      out.set(from.slice((sy * sw + sx) * 4, (sy * sw + sx) * 4 + 4), (ty * target.width + tx) * 4);
    }
  };
  dom.document.createElement = tag => {
    const canvas = originalCreate(tag);
    if (tag !== 'canvas') return canvas;
    canvas.getContext = () => canvas._context ??= {
      canvas,
      fillStyle: '#000000',
      drawImage(image, ...args) {
        const from = image._pixels ?? source;
        const sw = image.width || image.naturalWidth || 4, sh = image.height || image.naturalHeight || 4;
        const [dx = 0, dy = 0, dw = canvas.width, dh = canvas.height] = args.length >= 4 ? args.slice(-4) : args;
        copyPixels(canvas, from, sw, sh, Math.round(dx), Math.round(dy), Math.round(dw || canvas.width), Math.round(dh || canvas.height));
      },
      fillRect(x, y, w, h) {
        const out = ensure(canvas), [r, g, b] = parseColor(this.fillStyle);
        for (let yy = Math.max(0, Math.floor(y)); yy < Math.min(canvas.height, Math.ceil(y + h)); yy++) {
          for (let xx = Math.max(0, Math.floor(x)); xx < Math.min(canvas.width, Math.ceil(x + w)); xx++) out.set([r, g, b, 255], (yy * canvas.width + xx) * 4);
        }
      },
      getImageData(x, y, width = canvas.width, height = canvas.height) {
        const data = new Uint8ClampedArray(width * height * 4), from = ensure(canvas);
        for (let yy = 0; yy < height; yy++) for (let xx = 0; xx < width; xx++) {
          const sx = Math.min(canvas.width - 1, Math.max(0, x + xx)), sy = Math.min(canvas.height - 1, Math.max(0, y + yy));
          data.set(from.slice((sy * canvas.width + sx) * 4, (sy * canvas.width + sx) * 4 + 4), (yy * width + xx) * 4);
        }
        return { data, width, height };
      },
      putImageData(image) { canvas._pixels = new Uint8ClampedArray(image.data); },
      createImageData(width, height) { return { data: new Uint8ClampedArray(width * height * 4), width, height }; },
      createLinearGradient: () => ({ addColorStop() {} }),
      createRadialGradient: () => ({ addColorStop() {} }),
      createPattern: () => ({}),
      measureText: () => ({ width: 10 }),
      beginPath() {}, rect() {}, moveTo() {}, lineTo() {}, closePath() {}, clip() {}, save() {}, restore() {}, translate() {}, scale() {}, rotate() {}, stroke() {}, clearRect() {},
    };
    canvas.toDataURL = (type = 'image/png') => {
      const pixels = ensure(canvas);
      let hash = 2166136261;
      for (const value of pixels) hash = Math.imul(hash ^ value, 16777619) >>> 0;
      return `data:${type};base64,${Buffer.from(`${canvas.width}x${canvas.height}:${hash.toString(16)}`).toString('base64')}`;
    };
    return canvas;
  };
  const Image = globalThis.Image;
  globalThis.Image = class extends Image {
    set src(value) {
      this._src = value; this.width = this.naturalWidth = 4; this.height = this.naturalHeight = 4; this._pixels = source;
      setTimeout(() => this.onload?.(), 0);
    }
    get src() { return this._src; }
  };
}

test('canonical grade relief tints are distinct and follow each metal family', () => {
  const grades = Object.fromEntries(['bronze', 'silver', 'gold', 'prism'].map(grade => [grade, pixelAt(reliefSample(grade), 4, 2, 2)]));
  assert.equal(new Set(Object.values(grades).map(pixel => pixel.slice(0, 3).join(','))).size, 4);
  assert.ok(Math.abs(grades.silver[0] - grades.silver[1]) <= 1 && Math.abs(grades.silver[1] - grades.silver[2]) <= 1, `silver stays neutral: ${grades.silver}`);
  assert.ok(grades.gold[0] > grades.gold[2] && grades.gold[1] > grades.gold[2], `gold keeps a warm gold tint: ${grades.gold}`);

  const raised = reliefSample('gold', 'raised'), incised = reliefSample('gold', 'incised');
  assert.ok(pixelAt(raised, 4, 2, 2)[0] < pixelAt(incised, 4, 2, 2)[0]);
});

test('custom grade relief tint uses the same alias and fallback behavior as front material', () => {
  const project = createProject();
  project.grades.push(createGrade('VIP 금색', { id: 'vip', kind: 'special' }));
  assert.equal(collectibleReliefTint(project, 'vip'), '#FFE18A');
  project.grades.push(createGrade('로컬 등급', { id: 'local', kind: 'special' }));
  assert.equal(collectibleReliefTint(project, 'local'), '#FFF1DC');
});

test('relief styles tint ordinary color and clean brush RGB through the selected grade', () => {
  const colorStroke = { tool: 'color', size: .25, color: '#0044aa', points: [{ x: .5, y: .5 }] };
  const cleanStroke = { tool: 'clean', size: .25, points: [{ x: .5, y: .5 }] };
  const silverColor = pixelAt(brushSample('silver', colorStroke), 4, 2, 2);
  const silverClean = pixelAt(brushSample('silver', cleanStroke), 4, 2, 2);
  assert.ok(Math.abs(silverColor[0] - silverColor[1]) <= 1 && Math.abs(silverColor[1] - silverColor[2]) <= 1, `painted silver relief must stay neutral: ${silverColor}`);
  assert.ok(Math.abs(silverClean[0] - silverClean[1]) <= 1 && Math.abs(silverClean[1] - silverClean[2]) <= 1, `cleaned silver relief must stay neutral: ${silverClean}`);

  const goldColor = pixelAt(brushSample('gold', colorStroke), 4, 2, 2);
  const prismColor = pixelAt(brushSample('prism', colorStroke), 4, 2, 2);
  assert.ok(goldColor[0] > goldColor[2] && goldColor[1] > goldColor[2], `painted gold relief must keep gold palette: ${goldColor}`);
  assert.ok(prismColor[2] > prismColor[1] && prismColor[0] > prismColor[1], `painted prism relief must keep prism palette: ${prismColor}`);
});

test('relief erase and restore preserve alpha and never mutate the original pixels', () => {
  const original = sourcePixels();
  const center = (2 * 4 + 2) * 4;
  original[center + 3] = 123;
  const copy = new Uint8ClampedArray(original);
  const brush = { size: .25, color: '#0044aa', points: [{ x: .5, y: .5 }] };
  const erased = processPhotoPixels(original, 4, 4, { strokes: [{ ...brush, tool: 'erase' }] }, 'raised', collectibleReliefTint(createProject(), 'gold'), 0, 55);
  assert.equal(erased[center + 3], 0);
  const restored = processPhotoPixels(original, 4, 4, { strokes: [{ ...brush, tool: 'erase' }, { ...brush, tool: 'restore' }] }, 'raised', collectibleReliefTint(createProject(), 'gold'), 0, 55);
  assert.equal(restored[center + 3], 123);
  assert.deepEqual(original, copy);
});

test('published front processing and photo cache are separated by grade tint', async () => {
  const dom = installMiniDom();
  clearCollectibleRenderCache();
  try {
    installPixelCanvas(dom);
    const project = createProject();
    project.photo = { originalDataUrl: 'data:image/png;base64,source', width: 4, height: 4 };
    project.style = 'raised'; project.photoColor = 0; project.relief = 55; project.baseColor = '#004400';
    project.rewardGrades = { 1: 'bronze', 3: 'silver', 5: 'gold', 7: 'prism' };
    const derived = await serializeDerived(project);
    const fronts = ['bronze', 'silver', 'gold', 'prism'].map(grade => derived[grade].imageDataUrl);
    const bases = ['bronze', 'silver', 'gold', 'prism'].map(grade => derived[grade].baseDataUrl);
    assert.equal(new Set(fronts).size, 4, 'published imageDataUrl bakes each grade relief tint instead of reusing the first cached photo');
    assert.equal(new Set(bases).size, 4, 'published baseDataUrl shares the same grade-aware front processing without effects');
  } finally { clearCollectibleRenderCache(); dom.restore(); }
});
