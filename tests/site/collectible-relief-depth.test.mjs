import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installMiniDom } from '../fixtures/mini-dom.mjs';
import { createProject } from '../../apps/production-web/assets/collectible-model.mjs';
import { clearCollectibleRenderCache, processPhotoPixels, renderPublishedCollectible, serializeDerived } from '../../apps/production-web/assets/collectible-renderer.mjs';

const logoPixels = (width = 21, height = 9) => {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = (y * width + x) * 4;
    const value = x >= 9 && x <= 11 && y >= 2 && y <= 6 ? 0 : 255;
    pixels[index] = pixels[index + 1] = pixels[index + 2] = value; pixels[index + 3] = 255;
  }
  return pixels;
};
const scaledLogoPixels = (width = 209, height = 89) => {
  const pixels = new Uint8ClampedArray(width * height * 4);
  const left = Math.floor(width * .43), right = Math.ceil(width * .57), top = Math.floor(height * .22), bottom = Math.ceil(height * .78);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = (y * width + x) * 4;
    const value = x >= left && x <= right && y >= top && y <= bottom ? 0 : 255;
    pixels[index] = pixels[index + 1] = pixels[index + 2] = value; pixels[index + 3] = 255;
  }
  return pixels;
};
const rampPixels = (width = 21, height = 9) => {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = (y * width + x) * 4, value = Math.round(x / (width - 1) * 255);
    pixels[index] = pixels[index + 1] = pixels[index + 2] = value; pixels[index + 3] = 255;
  }
  return pixels;
};
const ridgePixels = (width = 21, height = 9) => {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = (y * width + x) * 4, value = x >= 9 && x <= 11 && y >= 2 && y <= 6 ? 255 : 0;
    pixels[index] = pixels[index + 1] = pixels[index + 2] = value; pixels[index + 3] = 255;
  }
  return pixels;
};
const red = (pixels, width, x, y) => pixels[(y * width + x) * 4];
const darkCenter = (pixels, width = 21, y = 4) => {
  const dark = [];
  for (let x = 0; x < width; x++) if (red(pixels, width, x, y) < 96) dark.push(x);
  return dark.reduce((sum, x) => sum + x, 0) / dark.length;
};
const brightCenter = (pixels, width = 21, y = 4) => {
  const bright = [];
  for (let x = 0; x < width; x++) if (red(pixels, width, x, y) > 192) bright.push(x);
  return bright.reduce((sum, x) => sum + x, 0) / bright.length;
};
const render = (style, angle, relief = 80, source = logoPixels()) => processPhotoPixels(source, 21, 9, {}, style, '#ffffff', 100, relief, angle);

test('raised relief moves logo contour and lighting to opposite sides as angle changes', () => {
  const positive = render('raised', 60, 100);
  const negative = render('raised', -60, 100);
  assert.ok(darkCenter(positive) > darkCenter(negative), `+angle should project the dark logo contour right: ${darkCenter(positive)} vs ${darkCenter(negative)}`);
  assert.ok(red(positive, 21, 8, 4) > red(positive, 21, 12, 4), `+angle should light the left logo edge: ${red(positive, 21, 8, 4)} vs ${red(positive, 21, 12, 4)}`);
  assert.ok(red(negative, 21, 8, 4) < red(negative, 21, 12, 4), `-angle should light the right logo edge: ${red(negative, 21, 8, 4)} vs ${red(negative, 21, 12, 4)}`);
});

test('incised relief reverses raised contour projection and lighting at the same angle', () => {
  const raised = render('raised', 60, 100);
  const incised = render('incised', 60, 100);
  assert.ok(darkCenter(raised) > 10, `raised +angle should push the contour right: ${darkCenter(raised)}`);
  assert.ok(darkCenter(incised) < 10, `incised +angle should pull the recessed contour left: ${darkCenter(incised)}`);
  assert.ok(red(raised, 21, 8, 4) > red(raised, 21, 12, 4), 'raised +angle should read as a protruding left edge');
  assert.ok(red(incised, 21, 8, 4) < red(incised, 21, 12, 4), 'incised +angle should read as a recessed left edge');
});

test('raised and incised use opposite signed depth for the same opaque linear ramp', () => {
  const source = rampPixels();
  const raisedPositive = render('raised', 60, 100, source), raisedNegative = render('raised', -60, 100, source);
  const incisedPositive = render('incised', 60, 100, source), incisedNegative = render('incised', -60, 100, source);
  const delta = (pixels, x) => red(pixels, 21, x, 4) - red(source, 21, x, 4);
  assert.ok(delta(raisedPositive, 10) < 0 && delta(incisedPositive, 10) > 0, `+angle ramp light must oppose: raised ${delta(raisedPositive, 10)}, incised ${delta(incisedPositive, 10)}`);
  assert.ok(delta(raisedNegative, 10) > 0 && delta(incisedNegative, 10) < 0, `-angle ramp light must oppose: raised ${delta(raisedNegative, 10)}, incised ${delta(incisedNegative, 10)}`);
});

test('raised and incised project a bright opaque ridge in opposite parallel directions', () => {
  const source = ridgePixels();
  const raised = render('raised', 60, 100, source);
  const incised = render('incised', 60, 100, source);
  assert.ok(brightCenter(raised) > brightCenter(source), `raised +angle should push the ridge right: ${brightCenter(raised)} vs ${brightCenter(source)}`);
  assert.ok(brightCenter(incised) < brightCenter(source), `incised +angle should pull the ridge left: ${brightCenter(incised)} vs ${brightCenter(source)}`);
});

test('preview-scale relief keeps strong edge contrast at shallow angles', () => {
  const width = 209, height = 89, source = scaledLogoPixels(width, height);
  const raised = processPhotoPixels(source, width, height, {}, 'raised', '#ffffff', 100, 80, 35);
  const midY = Math.floor(height / 2), leftEdge = Math.floor(width * .43) - 1, rightEdge = Math.ceil(width * .57) + 1;
  assert.ok(red(raised, width, leftEdge, midY) - red(raised, width, rightEdge, midY) > 60, `208px preview relief should show a visible light/shadow split: ${red(raised, width, leftEdge, midY)} vs ${red(raised, width, rightEdge, midY)}`);
});

test('zero-angle incised relief keeps a visible dark cavity rim instead of flattening to gray', () => {
  const width = 209, height = 89, source = scaledLogoPixels(width, height);
  const incised = processPhotoPixels(source, width, height, {}, 'incised', '#ffffff', 100, 80, 0);
  const midY = Math.floor(height / 2), leftRim = Math.floor(width * .43) - 1, flatBackground = Math.floor(width * .32);
  const contrast = red(incised, width, flatBackground, midY) - red(incised, width, leftRim, midY);
  assert.ok(contrast > 70, `incised zero-angle cavity rim should stay darker than the flat field: ${red(incised, width, flatBackground, midY)} vs ${red(incised, width, leftRim, midY)}`);
});

test('zero relief and original style stay angle-neutral while preserving source and alpha', () => {
  const source = logoPixels();
  source[3] = 0;
  const before = new Uint8ClampedArray(source);
  assert.deepEqual(render('raised', 60, 0, source), render('raised', -60, 0, source));
  assert.deepEqual(render('original', 60, 80, source), source);
  assert.equal(render('raised', 60, 80, source)[3], 0);
  assert.deepEqual(source, before);
});

test('zero relief color brush does not invoke height relief and preserves source alpha', () => {
  for (const style of ['raised', 'incised']) {
    const source = logoPixels();
    const center = (4 * 21 + 10) * 4;
    source[center + 3] = 123;
    const before = new Uint8ClampedArray(source);
    const result = processPhotoPixels(source, 21, 9, { strokes: [{ tool: 'color', size: .2, color: '#0044aa', points: [{ x: .5, y: .5 }] }] }, style, '#ffffff', 100, 0, 60);
    assert.deepEqual([...result.slice(center, center + 4)], [0, 68, 170, 123], `${style} relief0 color brush should paint RGB without changing source alpha`);
    assert.deepEqual(source, before, `${style} relief0 color brush must not mutate source pixels`);
  }
});

test('relief-only published assets include angle frames for rotating depth', async () => {
  const dom = installMiniDom();
  clearCollectibleRenderCache();
  try {
    const project = createProject();
    project.photo = { originalDataUrl: 'data:image/png;base64,source', width: 21, height: 9 };
    project.style = 'raised'; project.relief = 80; project.rewardGrades = { 1: 'bronze' };
    const derived = await serializeDerived(project);
    assert.equal(derived.bronze.angleFrames?.count, 12);
    assert.equal(derived.bronze.angleFrames?.stepDegrees, 15);
  } finally { clearCollectibleRenderCache(); dom.restore(); }
});

const recordingCanvasDom = () => {
  const dom = installMiniDom();
  const draws = [], calls = [];
  const originalCreateElement = dom.document.createElement.bind(dom.document);
  dom.document.createElement = (tag) => {
    const element = originalCreateElement(tag);
    if (String(tag).toLowerCase() !== 'canvas') return element;
    let context;
    element.getContext = () => context ??= new Proxy({ canvas: element }, {
      get(target, key) {
        if (key in target) return target[key];
        if (key === 'drawImage') return (...args) => { draws.push(args); calls.push(['drawImage', args]); };
        if (key === 'translate') return (...args) => { calls.push(['translate', args]); };
        if (key === 'beginPath' || key === 'closePath') return () => { calls.push([key]); };
        if (key === 'moveTo' || key === 'lineTo') return (...args) => { calls.push([key, args]); };
        if (key === 'getImageData' || key === 'createImageData') return (x, y, width = element.width, height = element.height) => ({ data: new Uint8ClampedArray(width * height * 4), width, height });
        if (key === 'createLinearGradient' || key === 'createRadialGradient' || key === 'createPattern') return () => ({ addColorStop() {} });
        if (key === 'measureText') return () => ({ width: 10 });
        return () => undefined;
      },
      set(target, key, value) { target[key] = value; return true; },
    });
    return element;
  };
  return { ...dom, draws, calls };
};

const recordedPaths = (calls) => {
  const paths = [];
  let path = [];
  for (const [method, args] of calls) {
    if (method === 'beginPath') path = [];
    if (method === 'moveTo' || method === 'lineTo') path.push(args);
    if (method === 'closePath') { paths.push(path); path = []; }
  }
  return paths;
};

test('published renderer samples angle frames with the same effective animation used for volume', async () => {
  const dom = recordingCanvasDom();
  try {
    const dataUrl = 'data:image/png;base64,angleframes';
    const snapshot = { shape: 'circle', gradeId: 'bronze', animation: 'still', angleFrames: { dataUrl, side: 1, count: 12, stepDegrees: 15 }, backImageDataUrl: 'data:image/png;base64,back' };
    const canvas = dom.document.createElement('canvas');
    await renderPublishedCollectible(canvas, snapshot, { animation: 'rotate', time: 1125, angle: 0 });
    const frameDraws = dom.draws.filter(args => args[0]?._src === dataUrl && args.length >= 9);
    assert.equal(frameDraws[0]?.[1] + frameDraws[0]?.[2] * 4, 6, 'rotate override at t=1125ms should sample the 15° cell, not the snapshot still 0° cell');

    dom.draws.length = 0;
    await renderPublishedCollectible(canvas, snapshot, { animation: 'rotate', staticFrame: true, time: 1125, angle: 0 });
    const staticFrameDraws = dom.draws.filter(args => args[0]?._src === dataUrl && args.length >= 9);
    assert.equal(staticFrameDraws[0]?.[1] + staticFrameDraws[0]?.[2] * 4, 5, 'staticFrame should keep the same 0° sample even when an animation override is passed');
  } finally { dom.restore(); }
});

test('web volume side slices offset to opposite sides for positive and negative angles', async () => {
  const dom = recordingCanvasDom();
  try {
    const snapshot = { shape: 'circle', gradeId: 'bronze', animation: 'still', imageDataUrl: 'data:image/png;base64,front', backImageDataUrl: 'data:image/png;base64,back', thickness: 24 };
    const canvas = dom.document.createElement('canvas');
    canvas.width = canvas.height = 208;
    await renderPublishedCollectible(canvas, snapshot, { angle: 35 });
    const positivePaths = recordedPaths(dom.calls);
    const positiveQuads = positivePaths.filter(path => path.length === 4);
    const positiveSpans = positiveQuads.map(path => Math.abs(path[0][0] - path[3][0]));
    const positiveOffsets = dom.calls.filter(([method, args]) => method === 'translate' && args[1] === 0).map(([, args]) => args[0]);
    assert.ok(positiveOffsets.at(-1) < 0, `positive angle face offset should be negative: ${positiveOffsets.at(-1)}`);
    assert.ok(dom.calls.filter(([method]) => method === 'lineTo' || method === 'moveTo').length > 40, 'positive angle should still draw a swept side outline');
    assert.ok(positiveSpans.length > 0 && positiveSpans.every(span => span > .5), `positive angle should draw nonzero side depth: ${positiveSpans.join(',')}`);
    positiveQuads.forEach((path, index) => assert.ok(Math.abs(positiveSpans[index] - Math.abs(path[1][0] - path[2][0])) < 1e-6, `positive side quad ${index} should have equal depth at both ends`));

    dom.calls.length = 0;
    await renderPublishedCollectible(canvas, snapshot, { angle: -35 });
    const negativePaths = recordedPaths(dom.calls);
    const negativeQuads = negativePaths.filter(path => path.length === 4);
    const negativeSpans = negativeQuads.map(path => Math.abs(path[0][0] - path[3][0]));
    const negativeOffsets = dom.calls.filter(([method, args]) => method === 'translate' && args[1] === 0).map(([, args]) => args[0]);
    assert.ok(negativeOffsets.at(-1) > 0, `negative angle face offset should be positive: ${negativeOffsets.at(-1)}`);
    assert.ok(dom.calls.filter(([method]) => method === 'lineTo' || method === 'moveTo').length > 40, 'negative angle should still draw a swept side outline');
    assert.equal(negativeSpans.length, positiveSpans.length, 'opposite angles should draw the same number of side quads');
    negativeQuads.forEach((path, index) => assert.ok(Math.abs(negativeSpans[index] - Math.abs(path[1][0] - path[2][0])) < 1e-6, `negative side quad ${index} should have equal depth at both ends`));
    positiveSpans.forEach((span, index) => assert.ok(Math.abs(span - negativeSpans[index]) < 1e-6, `side quad ${index} should keep equal depth: ${span} vs ${negativeSpans[index]}`));
    // Path 0 is the blurred fill cap; path 1 is the swept volume's back cap.
    const positiveCap = positivePaths[1], negativeCap = negativePaths[1];
    assert.equal(positiveCap.length, negativeCap.length);
    positiveCap.forEach(([x], index) => assert.ok(Math.abs(x - negativeCap[index][0] - positiveSpans[0]) < 1e-6, `back cap ${index} should mirror by the side depth`));
    assert.ok(Math.abs(positiveCap[0][0] - Math.max(positiveQuads[0][0][0], positiveQuads[0][3][0])) < 1e-6, 'positive back cap should join the first side quad');
    assert.ok(Math.abs(negativeCap[0][0] - Math.min(negativeQuads[0][0][0], negativeQuads[0][3][0])) < 1e-6, 'negative back cap should join the first side quad');
  } finally { dom.restore(); }
});
