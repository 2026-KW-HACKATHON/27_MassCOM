import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProject } from '../../apps/production-web/assets/collectible-model.mjs';
import { processPhotoPixels, validateStory, collectibleMetalColors } from '../../apps/production-web/assets/collectible-renderer.mjs';
import { validatePublish } from '../../apps/production-web/assets/collectible-editor.mjs';

const pixels = (width, height, value = 90) => Uint8ClampedArray.from({ length: width * height * 4 }, (_, index) => index % 4 === 3 ? 255 : value);

test('untouched photo preserves source bytes and transparent pixels', () => {
  const original = Uint8ClampedArray.of(5, 12, 250, 0, 137, 99, 1, 255);
  const copy = new Uint8ClampedArray(original);
  const result = processPhotoPixels(original, 2, 1);
  assert.deepEqual(result, original); assert.deepEqual(original, copy); assert.notEqual(result, original);
});

test('erasing and restoring use original pixels without destructively editing the source', () => {
  const original = pixels(9, 9, 100), center = (4 * 9 + 4) * 4;
  const brush = { size: .2, color: '#ffffff', points: [{ x: .5, y: .5 }] };
  const erased = processPhotoPixels(original, 9, 9, { strokes: [{ ...brush, tool: 'erase' }] });
  assert.equal(erased[center + 3], 0); assert.equal(original[center + 3], 255); assert.equal(erased[3], 255);
  const restored = processPhotoPixels(original, 9, 9, { strokes: [{ ...brush, tool: 'erase' }, { ...brush, tool: 'restore' }] });
  assert.deepEqual(restored, original);
});

test('a region color brush changes only its selected area and keeps alpha', () => {
  const original = pixels(10, 10, 120);
  const result = processPhotoPixels(original, 10, 10, { strokes: [{ tool: 'color', size: .15, color: '#0044aa', points: [{ x: .5, y: .5 }] }] });
  const center = (5 * 10 + 5) * 4;
  assert.deepEqual(Array.from(result.slice(center, center + 4)), [0, 68, 170, 255]);
  assert.deepEqual(Array.from(result.slice(0, 4)), [120, 120, 120, 255]);
});

test('blemish cleaning samples a neighboring patch while retaining untouched areas', () => {
  const original = pixels(10, 10, 80); const center = (5 * 10 + 5) * 4;
  original[center] = original[center + 1] = original[center + 2] = 240;
  const result = processPhotoPixels(original, 10, 10, { strokes: [{ tool: 'clean', size: .1, points: [{ x: .5, y: .5 }] }] });
  assert.ok(result[center] < 240 && result[center] >= 80); assert.equal(result[0], 80); assert.equal(original[center], 240);
});

test('raised and incised have opposite directional relief on the same cropped subject', () => {
  const original = pixels(5, 5);
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) for (let channel = 0; channel < 3; channel++) original[(y * 5 + x) * 4 + channel] = 40 + x * 32;
  const raised = processPhotoPixels(original, 5, 5, {}, 'raised', '#c09050', 0, 55);
  const incised = processPhotoPixels(original, 5, 5, {}, 'incised', '#c09050', 0, 55);
  const index = (2 * 5 + 2) * 4;
  assert.notDeepEqual(raised, incised); assert.ok(raised[index] < incised[index]);
  assert.equal(raised[index + 3], 255); assert.equal(incised[index + 3], 255);
});

test('cartoon and color merge are deterministic and do not delete facial/image data', () => {
  const original = Uint8ClampedArray.of(61, 87, 112, 255, 132, 174, 191, 255, 201, 225, 247, 255);
  const edits = { merge: 50, cartoon: 70, simplify: 25 };
  const first = processPhotoPixels(original, 3, 1, edits), second = processPhotoPixels(original, 3, 1, edits);
  assert.deepEqual(first, second); assert.notDeepEqual(first, original);
  assert.equal(first.filter((_, index) => index % 4 === 3).every(value => value === 255), true);
});

test('story types disclose their source requirements and a single-photo zoom remains valid', () => {
  assert.equal(validateStory({ type: 'zoom', frames: [] }), '');
  assert.equal(validateStory({ type: 'wide', frames: [{ dataUrl: 'scene' }] }), '');
  assert.match(validateStory({ type: 'wide', frames: [] }), /자동으로 복원되지/);
  assert.match(validateStory({ type: 'follow', frames: [{}] }), /2장/);
  assert.match(validateStory({ type: 'event', frames: [{}, {}] }), /3장/);
  assert.equal(validateStory({ type: 'event', frames: [{}, {}, {}] }), '');
});

test('publication asks only for photo, name, campaign and explicit existing reward mapping', () => {
  const project = createProject({ name: '우리 가게 간판' });
  assert.match(validatePublish(project), /대표 사진/);
  project.photo = { originalDataUrl: 'data:image/png;base64,source', width: 100, height: 100 };
  assert.match(validatePublish(project), /캠페인/);
  project.campaignId = 'campaign'; assert.match(validatePublish(project), /방문 목표/);
  project.rewardGrades = { '1': 'bronze' }; assert.equal(validatePublish(project), '');
  assert.equal(project.effects.length, 0); assert.equal(project.audio, null);
  project.grades[0].enabled = false; assert.match(validatePublish(project), /방문 목표/);
});


test('metal edge aliases and stops agree with mobile grades', () => {
  assert.deepEqual(collectibleMetalColors('', '금등급'), ['#B9750C', '#FFE18A', '#FFFFFF', '#D99A1C']);
  assert.deepEqual(collectibleMetalColors('', '은색'), ['#D3E2EF', '#FFFFFF', '#8DACC8']);
  assert.deepEqual(collectibleMetalColors('gold', '특별'), ['#67E8F9', '#E8C5FF', '#FFFFFF']);
  assert.deepEqual(collectibleMetalColors('unknown'), ['#E3BB8B', '#FFF1DC', '#A9673F']);
});
