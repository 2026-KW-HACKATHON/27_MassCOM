import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flameAuraEffects, flameFrame } from '../../apps/production-web/assets/collectible-aura.mjs';
import { createProject, strokeAlpha } from '../../apps/production-web/assets/collectible-model.mjs';
import { processPhotoPixels, renderCollectible, renderPublishedCollectible } from '../../apps/production-web/assets/collectible-renderer.mjs';
import { installMiniDom } from '../fixtures/mini-dom.mjs';

const pixel = (r, g, b, a = 255) => new Uint8ClampedArray([r, g, b, a]);
const rgbaAt = (pixels, width, x, y) => [...pixels.slice((y * width + x) * 4, (y * width + x) * 4 + 4)];

test('monochrome style grays pixels without relief height projection', () => {
  const source = new Uint8ClampedArray([...pixel(255, 0, 0), ...pixel(0, 255, 0)]);
  const result = processPhotoPixels(source, 2, 1, {}, 'monochrome', '#ffffff', 100, 100, 60);
  assert.equal(result[0], result[1]);
  assert.equal(result[1], result[2]);
  assert.equal(result[4], result[5]);
  assert.equal(result[5], result[6]);
  assert.deepEqual(Array.from(result).filter((_, index) => index % 4 === 3), [255, 255]);
});

test('monochrome style keeps photo edit brightness before graying', () => {
  const source = pixel(40, 80, 120);
  const normal = processPhotoPixels(source, 1, 1, {}, 'monochrome', '#ffffff', 100, 100, 60);
  const bright = processPhotoPixels(source, 1, 1, { brightness: 40 }, 'monochrome', '#ffffff', 100, 100, 60);
  assert.equal(normal[0], normal[1]);
  assert.equal(bright[0], bright[1]);
  assert.ok(bright[0] > normal[0], `brightness must affect monochrome output: ${bright[0]} <= ${normal[0]}`);
});

test('photo brush hardness feathers erase, restore, color, and clean tools', () => {
  const width = 9, height = 9, source = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let index = 0; index < source.length; index += 4) { source[index] = 80; source[index + 1] = 120; source[index + 2] = 160; }
  const baseStroke = { size: .9, hardness: 0, points: [{ x: .5, y: .5 }] };
  const hardErase = processPhotoPixels(source, width, height, { strokes: [{ ...baseStroke, hardness: 100, tool: 'erase' }] });
  const softErase = processPhotoPixels(source, width, height, { strokes: [{ ...baseStroke, tool: 'erase' }] });
  assert.equal(rgbaAt(hardErase, width, 1, 4)[3], 0);
  assert.ok(rgbaAt(softErase, width, 1, 4)[3] > 0 && rgbaAt(softErase, width, 1, 4)[3] < 255);

  const erasedThenSoftRestore = processPhotoPixels(source, width, height, { strokes: [
    { ...baseStroke, hardness: 100, tool: 'erase' },
    { ...baseStroke, tool: 'restore' },
  ] });
  assert.ok(rgbaAt(erasedThenSoftRestore, width, 1, 4)[3] > 0 && rgbaAt(erasedThenSoftRestore, width, 1, 4)[3] < 255);

  const softColor = processPhotoPixels(source, width, height, { strokes: [{ ...baseStroke, tool: 'color', color: '#0044aa' }] });
  assert.ok(rgbaAt(softColor, width, 1, 4)[2] > 160 && rgbaAt(softColor, width, 1, 4)[2] < 170);

  const noisy = new Uint8ClampedArray(source);
  noisy[(4 * width + 1) * 4] = 250;
  const softClean = processPhotoPixels(noisy, width, height, { strokes: [{ ...baseStroke, tool: 'clean' }] });
  assert.ok(rgbaAt(softClean, width, 1, 4)[0] < 250 && rgbaAt(softClean, width, 1, 4)[0] > 80);
});

test('shared stroke alpha keeps old hard strokes exact and feathers soft hardness', () => {
  const hard = strokeAlpha([{ tool: 'fg', size: .2, points: [{ x: .5, y: .5 }] }], 9, 9);
  const soft = strokeAlpha([{ tool: 'fg', size: .2, hardness: 0, points: [{ x: .5, y: .5 }] }], 9, 9);
  assert.equal(hard[4 * 9 + 4], 255);
  assert.ok(soft[4 * 9 + 4] > 0 && soft[4 * 9 + 4] < 255);
});

test('flame aura selects at most four active effects in saved order without mutating metadata', () => {
  const flame = { type: 'flame', target: 'aura', strength: 50, color: '#5dd8ff' };
  const active = Array.from({ length: 64 }, (_, index) => ({ ...flame, speed: .25 + index / 64 }));
  const effects = [{ ...flame, strength: 0 }, { ...flame, target: 'base' }, { ...flame, type: 'glow' }, ...active];
  const original = structuredClone(effects);
  assert.deepEqual(flameAuraEffects(effects), active.slice(0, 4));
  assert.deepEqual(flameAuraEffects(Array(64).fill(flame)), Array(4).fill(flame));
  assert.deepEqual(flameAuraEffects(active.slice(0, 2)), active.slice(0, 2));
  assert.deepEqual(flameAuraEffects(), []);
  assert.deepEqual(flameAuraEffects(effects.slice(0, 3)), []);
  assert.deepEqual(effects, original);
});

test('flame aura geometry is strength gated and moves upward over time', () => {
  assert.deepEqual(flameFrame('stamp', 256, 0, 0, 1, 0), []);
  const first = flameFrame('stamp', 256, 35, 0, 1, 100);
  const later = flameFrame('stamp', 256, 35, 600, 1, 100);
  assert.ok(first.length > 12);
  assert.ok(first.every(tongue => tongue.tipY < tongue.y), 'flame tongues rise above their outline base');
  assert.deepEqual(first.map(({ slot, x, y }) => [slot, Math.round(x), Math.round(y)]), later.map(({ slot, x, y }) => [slot, Math.round(x), Math.round(y)]), 'outline anchors stay fixed; only the flame wave changes');
  assert.notDeepEqual(first.map(({ slot, tipY }) => [slot, Math.round(tipY)]), later.map(({ slot, tipY }) => [slot, Math.round(tipY)]));
});

test('published renderer paints runtime flame aura and angle-dependent back glint without new assets', async () => {
  const dom = installMiniDom(), operations = [];
  const createElement = dom.document.createElement.bind(dom.document);
  dom.document.createElement = tag => {
    const element = createElement(tag);
    if (tag !== 'canvas') return element;
    let context;
    element.getContext = () => context ??= new Proxy({ canvas: element }, {
      get(target, key) {
        if (key in target) return target[key];
        if (key === 'createLinearGradient') return (...args) => {
          operations.push({ method: 'createLinearGradient', args });
          return { addColorStop(offset, color) { operations.push({ method: 'addColorStop', offset, color }); } };
        };
        if (key === 'getImageData' || key === 'createImageData') return (x, y, width = element.width, height = element.height) => ({ data: new Uint8ClampedArray(width * height * 4), width, height });
        return (...args) => operations.push({ method: key, composite: target.globalCompositeOperation, alpha: target.globalAlpha, shadowColor: target.shadowColor, args });
      },
      set(target, key, value) { target[key] = value; return true; },
    });
    return element;
  };
  try {
    const snapshot = { shape: 'stamp', gradeId: 'prism', gradeName: '프리즘', thickness: 18, imageDataUrl: 'data:image/png;base64,front', backImageDataUrl: 'data:image/png;base64,back',
      effects: [{ type: 'flame', target: 'aura', gradeIds: ['prism'], strength: 100, color: '#5dd8ff', speed: 1 }] };
    const canvas = dom.document.createElement('canvas'); canvas.width = canvas.height = 256;
    await renderPublishedCollectible(canvas, snapshot, { angle: 135, time: 600 });
    assert.ok(operations.some(operation => operation.method === 'fill' && operation.shadowColor === '#5dd8ff'), 'flame aura paints outside the coin at runtime');
    assert.ok(operations.some(operation => operation.method === 'addColorStop' && operation.color === '#FF2DB8'), 'prism back glint reuses vivid grade foil colors');
  } finally { dom.restore(); }
});

test('flame aura render keeps gradient work bounded per frame', async () => {
  const dom = installMiniDom();
  let gradients = 0, tongueCurves = 0;
  const createElement = dom.document.createElement.bind(dom.document);
  dom.document.createElement = tag => {
    const element = createElement(tag);
    if (tag !== 'canvas') return element;
    let context;
    element.getContext = () => context ??= new Proxy({ canvas: element }, {
      get(target, key) {
        if (key in target) return target[key];
        if (key === 'createLinearGradient') return () => { gradients += 1; return { addColorStop() {} }; };
        if (key === 'quadraticCurveTo') return () => { tongueCurves += 1; };
        return () => undefined;
      },
      set(target, key, value) { target[key] = value; return true; },
    });
    return element;
  };
  try {
    const snapshot = { shape: 'stamp', gradeId: 'prism', thickness: 18, imageDataUrl: 'data:image/png;base64,front', backImageDataUrl: 'data:image/png;base64,back',
      effects: [{ type: 'flame', target: 'aura', gradeIds: ['prism'], strength: 100, color: '#5dd8ff', speed: 1 }] };
    const canvas = dom.document.createElement('canvas'); canvas.width = canvas.height = 256;
    const tongues = flameFrame('stamp', 256 * .78, 35, 600, 1, 100);
    await renderPublishedCollectible(canvas, snapshot, { angle: 35, time: 600 });
    assert.ok(tongues.length > 12);
    assert.ok(gradients <= 4, `flame should not allocate one gradient per tongue: ${gradients}`);
    assert.equal(tongueCurves, tongues.length * 2);
    for (const count of [4, 64]) {
      tongueCurves = 0;
      snapshot.effects = Array.from({ length: count }, () => ({ ...snapshot.effects[0] }));
      await renderPublishedCollectible(canvas, snapshot, { angle: 35, time: 600 });
      assert.equal(tongueCurves, tongues.length * 2 * 4, `${count} saved effects render only four flame layers`);
    }
  } finally { dom.restore(); }
});

test('edge reed layer is reused for repeated identical volume frames', async () => {
  const dom = installMiniDom(), operations = [];
  const createElement = dom.document.createElement.bind(dom.document);
  dom.document.createElement = tag => {
    const element = createElement(tag);
    if (tag !== 'canvas') return element;
    let context;
    element.getContext = () => context ??= new Proxy({ canvas: element }, {
      get(target, key) {
        if (key in target) return target[key];
        if (key === 'createLinearGradient') return () => ({ addColorStop() {} });
        return (...args) => operations.push({ method: key, strokeStyle: target.strokeStyle, args });
      },
      set(target, key, value) { target[key] = value; return true; },
    });
    return element;
  };
  try {
    const snapshot = { shape: 'serrated', gradeId: 'gold', thickness: 48, imageDataUrl: 'data:image/png;base64,front', backImageDataUrl: 'data:image/png;base64,back' };
    const canvas = dom.document.createElement('canvas'); canvas.width = canvas.height = 256;
    await renderPublishedCollectible(canvas, snapshot, { angle: 70, time: 0 });
    const firstStrokes = operations.filter(operation => operation.method === 'stroke' && typeof operation.strokeStyle === 'string' && operation.strokeStyle.startsWith('rgba(10,17,32,')).length;
    await renderPublishedCollectible(canvas, snapshot, { angle: 70, time: 33 });
    const totalStrokes = operations.filter(operation => operation.method === 'stroke' && typeof operation.strokeStyle === 'string' && operation.strokeStyle.startsWith('rgba(10,17,32,')).length;
    assert.ok(firstStrokes > 12);
    assert.equal(totalStrokes, firstStrokes, 'same edge frame should reuse the cached reed layer instead of restroking grooves');
  } finally { dom.restore(); }
});

test('vertical thick side volume is connected through the middle instead of two caps', async () => {
  const width = 400, height = 400, pixels = new Uint8ClampedArray(width * height * 4);
  const dom = installMiniDom();
  const createElement = dom.document.createElement.bind(dom.document);
  const windingAt = (paths, x, y) => {
    let winding = 0;
    for (const path of paths) for (let index = 0; index < path.length; index++) {
      const a = path[index], b = path[(index + 1) % path.length];
      if (a.y <= y) {
        if (b.y > y && (b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y) > 0) winding++;
      } else if (b.y <= y && (b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y) < 0) winding--;
    }
    return winding;
  };
  const paint = (x, y) => {
    x = Math.max(0, Math.min(width - 1, Math.round(x)));
    y = Math.max(0, Math.min(height - 1, Math.round(y)));
    const index = (y * width + x) * 4;
    pixels[index] = pixels[index + 1] = pixels[index + 2] = pixels[index + 3] = 255;
  };
  dom.document.createElement = tag => {
    const element = createElement(tag);
    if (tag !== 'canvas') return element;
    element.width = width; element.height = height;
    let tx = 0, ty = 0, paths = [], current = [];
    let context;
    element.getContext = () => context ??= new Proxy({ canvas: element }, {
      get(target, key) {
        if (key in target) return target[key];
        if (key === 'createLinearGradient') return () => ({ addColorStop() {} });
        if (key === 'clearRect') return () => pixels.fill(0);
        if (key === 'translate') return (x, y) => { tx += x; ty += y; };
        if (key === 'beginPath') return () => { paths = []; current = []; };
        if (key === 'moveTo') return (x, y) => { if (current.length) paths.push(current); current = [{ x: x + tx, y: y + ty }]; };
        if (key === 'lineTo') return (x, y) => { current.push({ x: x + tx, y: y + ty }); };
        if (key === 'closePath') return () => { if (current.length) { paths.push(current); current = []; } };
        if (key === 'fill') return () => {
          if (current.length) { paths.push(current); current = []; }
          if (windingAt(paths, width / 2, height / 2) !== 0) paint(width / 2, height / 2);
        };
        if (key === 'drawImage') return () => undefined;
        if (key === 'getImageData') return () => ({ data: pixels, width, height });
        if (key === 'createImageData') return (x, y, w = width, h = height) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
        return () => undefined;
      },
      set(target, key, value) { target[key] = value; return true; },
    });
    return element;
  };
  try {
    const canvas = dom.document.createElement('canvas'); canvas.width = canvas.height = 400;
    await renderPublishedCollectible(canvas, { shape: 'circle', gradeId: 'silver', thickness: 48, imageDataUrl: 'data:image/png;base64,front', backImageDataUrl: 'data:image/png;base64,back' }, { angle: 90 });
    const centerAlpha = pixels[(200 * width + 200) * 4 + 3];
    assert.ok(centerAlpha > 0, '90-degree thick side should fill the center bridge between front and back caps');
  } finally { dom.restore(); }
});

test('static and reduced motion renders keep aura and back foil time stable unless effectTime is explicit', async () => {
  const dom = installMiniDom(), snapshots = [];
  const createElement = dom.document.createElement.bind(dom.document);
  const capture = (target) => snapshots.push({ method: target.method, args: target.args?.map(value => Math.round(Number(value) || 0)), stops: target.stops?.slice() });
  dom.document.createElement = tag => {
    const element = createElement(tag);
    if (tag !== 'canvas') return element;
    let context;
    element.getContext = () => context ??= new Proxy({ canvas: element }, {
      get(target, key) {
        if (key in target) return target[key];
        if (key === 'createLinearGradient') return (...args) => {
          const gradient = { method: 'gradient', args, stops: [], addColorStop(offset, color) { this.stops.push([offset, color]); } };
          capture(gradient);
          return gradient;
        };
        if (key === 'quadraticCurveTo') return (...args) => capture({ method: 'quadraticCurveTo', args });
        if (key === 'getImageData' || key === 'createImageData') return (x, y, width = element.width, height = element.height) => ({ data: new Uint8ClampedArray(width * height * 4), width, height });
        return () => undefined;
      },
      set(target, key, value) { target[key] = value; return true; },
    });
    return element;
  };
  const renderSignature = async (options) => {
    snapshots.length = 0;
    const snapshot = { shape: 'stamp', gradeId: 'prism', gradeName: '프리즘', thickness: 18, imageDataUrl: 'data:image/png;base64,front', backImageDataUrl: 'data:image/png;base64,back',
      effects: [{ type: 'flame', target: 'aura', gradeIds: ['prism'], strength: 100, color: '#5dd8ff', speed: 1 }] };
    const canvas = dom.document.createElement('canvas'); canvas.width = canvas.height = 256;
    await renderPublishedCollectible(canvas, snapshot, { angle: 135, ...options });
    return JSON.stringify(snapshots);
  };
  try {
    assert.equal(await renderSignature({ staticFrame: true, time: 0 }), await renderSignature({ staticFrame: true, time: 600 }));
    assert.equal(await renderSignature({ reducedMotion: true, time: 0 }), await renderSignature({ reducedMotion: true, time: 600 }));
    assert.notEqual(await renderSignature({ staticFrame: true, time: 600 }), await renderSignature({ staticFrame: true, time: 600, effectTime: 600 }));
  } finally { dom.restore(); }
});

test('live renderer uses grade metal gradient for non-prism borders', async () => {
  const dom = installMiniDom(), strokes = [];
  const createElement = dom.document.createElement.bind(dom.document);
  dom.document.createElement = tag => {
    const element = createElement(tag);
    if (tag !== 'canvas') return element;
    let context;
    element.getContext = () => context ??= new Proxy({ canvas: element }, {
      get(target, key) {
        if (key in target) return target[key];
        if (key === 'createLinearGradient') return () => {
          const gradient = { stops: [], addColorStop(offset, color) { this.stops.push([offset, color]); } };
          return gradient;
        };
        if (key === 'getImageData' || key === 'createImageData') return (x, y, width = element.width, height = element.height) => ({ data: new Uint8ClampedArray(width * height * 4), width, height });
        if (key === 'stroke') return (...args) => strokes.push({ lineWidth: target.lineWidth, strokeStyle: target.strokeStyle, args });
        return () => undefined;
      },
      set(target, key, value) { target[key] = value; return true; },
    });
    return element;
  };
  try {
    const project = createProject();
    const canvas = dom.document.createElement('canvas'); canvas.width = canvas.height = 160;
    await renderCollectible(canvas, project, 'silver', { textureSize: 128, staticFrame: true });
    const border = strokes.find(stroke => stroke.lineWidth > 4 && stroke.strokeStyle?.stops?.some(([, color]) => color === '#8DACC8'));
    assert.ok(border, 'silver border should use the silver metal gradient instead of the bronze baseColor');
    assert.equal(border.strokeStyle.stops.some(([, color]) => color === project.baseColor), false);
  } finally { dom.restore(); }
});

test('new projects accept flame aura effects without mutating grade rewards', () => {
  const project = createProject();
  project.effects.push({ id: 'flame', type: 'flame', target: 'aura', gradeIds: ['prism'], strength: 80, color: '#5dd8ff', roughness: 25, speed: 1 });
  assert.equal(project.effects[0].target, 'aura');
  assert.equal(project.rewardGrades[5], undefined);
});
