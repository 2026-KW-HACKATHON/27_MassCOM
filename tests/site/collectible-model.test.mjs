import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  angleFrameIndex, cloneProject, createGrade, createProject, cropTransform, effectsForGrade, motionForGrade,
  particleAt, resolveGreeting, resolveSticker, shapePath, shapePoints, stickerLineOffsets, stickerLines, toggleEffectGrade, upgradeProject,
} from '../../apps/production-web/assets/collectible-model.mjs';

// Issue #284 WP1: 공유 픽스처(tests/fixtures)는 apps/api의 같은 시험이 읽는 파일 그대로다. 서버(rules.ts)와
// 브라우저(model.mjs)의 업그레이드·인사말·파티클·각도 계산이 같은 값을 내는지 이 파일들로 맞춘다.
const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));

test('사진 제작 초안은 보상 규칙·등급 효과를 자동으로 설정하지 않는다', () => {
  const first = createProject({ campaignId: 'campaign-a' });
  const second = createProject();
  assert.deepEqual(first.rewardGrades, {});
  assert.deepEqual(first.effects, []);
  assert.deepEqual(first.motion, []);
  assert.equal(first.campaignId, 'campaign-a');
  assert.deepEqual(first.grades.map((grade) => grade.id), ['bronze', 'silver', 'gold', 'prism']);
  first.grades[0].name = '구리 기념품';
  first.photoEdits.strokes.push({ tool: 'erase', points: [{ x: 0.5, y: 0.5 }], size: 0.05, color: '#ffffff' });
  assert.equal(first.grades[0].id, 'bronze');
  assert.equal(second.grades[0].name, '브론즈');
  assert.equal(second.photoEdits.strokes.length, 0);
});

test('새 시즌·특수등급을 추가해도 기존 효과와 보상 연결은 변하지 않는다', () => {
  const project = createProject();
  project.effects.push({ id: 'holo', type: 'hologram', target: 'surface', gradeIds: ['bronze'], strength: 50 });
  project.rewardGrades['1'] = 'bronze';
  const special = createGrade('겨울 기념', { id: 'winter-special' });
  project.grades.push(special);
  project.theme.name = '겨울방학';
  assert.equal(special.kind, 'special');
  assert.deepEqual(project.effects[0].gradeIds, ['bronze']);
  assert.deepEqual(project.rewardGrades, { '1': 'bronze' });
  assert.deepEqual(effectsForGrade(project, special.id), []);
  assert.equal(effectsForGrade(project, 'bronze')[0].type, 'hologram');
  assert.deepEqual(effectsForGrade(project, 'prism'), []);
});

test('복수 등급 효과 토글과 미리보기 선택을 독립적으로 처리한다', () => {
  const effect = { id: 'holo', type: 'hologram', target: 'surface', gradeIds: ['bronze'] };
  const gold = toggleEffectGrade(effect, 'gold');
  assert.deepEqual(gold.gradeIds, ['bronze', 'gold']);
  assert.deepEqual(effect.gradeIds, ['bronze']);
  const off = toggleEffectGrade(toggleEffectGrade(gold, 'bronze'), 'gold');
  assert.deepEqual(off.gradeIds, []);
  const project = createProject();
  project.effects = [gold];
  effectsForGrade(project, 'silver');
  assert.deepEqual(gold.gradeIds, ['bronze', 'gold']);
});

test('개별 스티커·테두리 효과와 등급별 동작은 대상을 넘어서 적용되지 않는다', () => {
  const project = createProject();
  project.effects = [
    { id: 'text-effect', type: 'pearl', target: 'sticker-text', gradeIds: ['silver'] },
    { id: 'rim-effect', type: 'metallic', target: 'border', gradeIds: ['silver', 'gold'] },
  ];
  project.motion = [{ id: 'light', type: 'shine', gradeIds: ['silver'] }];
  assert.deepEqual(effectsForGrade(project, 'silver', 'sticker-text').map((effect) => effect.id), ['text-effect']);
  assert.deepEqual(effectsForGrade(project, 'gold', 'sticker-text'), []);
  assert.deepEqual(effectsForGrade(project, 'silver', 'surface'), []);
  assert.deepEqual(motionForGrade(project, 'gold'), []);
  assert.equal(motionForGrade(project, 'silver')[0].type, 'shine');
  project.grades.find((grade) => grade.id === 'silver').enabled = false;
  assert.deepEqual(effectsForGrade(project, 'silver'), []);
  assert.deepEqual(motionForGrade(project, 'silver'), []);
});

test('톱니 외곽은 24개의 날카로운 돌기가 연결된 폐곡선이다', () => {
  const points = shapePoints('serrated', 512, 512);
  const radii = points.map((point) => Math.hypot(point.x - 256, point.y - 256));
  assert.equal(points.length, 48);
  assert.equal(radii.filter((radius) => radius > 230).length, 24);
  assert.equal(radii.filter((radius) => radius < 190).length, 24);
  assert.equal((shapePath('serrated').match(/M/g) ?? []).length, 1);
  assert.match(shapePath('serrated'), / Z$/);
  assert.throws(() => shapePoints('flower'), /모양/);
});

test('우표 외곽은 직사각형 가장자리 안쪽에 구멍을 내고 화면 밖으로 나가지 않는다', () => {
  const points = shapePoints('stamp', 400, 600);
  assert.ok(points.every((point) => point.x >= 36 && point.x <= 364 && point.y >= 24 && point.y <= 576));
  assert.ok(points.some((point) => point.y === 24));
  assert.ok(points.some((point) => point.x === 364));
  assert.ok(points.some((point) => point.x > 36 && point.x < 364 && point.y > 24 && point.y < 32));
  assert.match(shapePath('stamp', 400, 600), / Z$/);
  assert.throws(() => shapePoints('circle', Number.NaN), /유한/);
});

test('원본 fit-cover 자르기는 모든 위치에서 틀을 채우며 원본을 변경하지 않는다', () => {
  const project = createProject();
  project.photo = { originalDataUrl: 'data:image/png;base64,original', width: 1600, height: 900 };
  const original = cloneProject(project);
  for (const zoom of [1, 2, 8]) {
    for (const position of [-1, 0, 1]) {
      project.crop = { x: position, y: -position, zoom };
      const box = cropTransform(project, 512, 512);
      assert.ok(box.x <= 0 && box.y <= 0);
      assert.ok(box.x + box.width >= 512 && box.y + box.height >= 512);
    }
  }
  assert.deepEqual(project.photo, original.photo);
  assert.deepEqual(original.crop, { x: 0, y: 0, zoom: 1 });
});

test('잘못된 조절값은 유한 자르기 결과로 제한하고 재편집 복사는 독립적이다', () => {
  const project = createProject();
  project.photo = { originalDataUrl: 'data:image/png;base64,original', width: 1200, height: 1600 };
  project.crop = { x: Number.NaN, y: Infinity, zoom: -5 };
  const box = cropTransform(project);
  assert.ok(Object.values(box).every(Number.isFinite));
  const copy = cloneProject(project);
  copy.photo.originalDataUrl = 'replacement';
  assert.equal(project.photo.originalDataUrl, 'data:image/png;base64,original');
  assert.throws(() => cropTransform(project, 0), /유한/);
});

test('golden v1→v2 upgrade matches the shared fixture the server also checks, and upgrading twice is idempotent', () => {
  const v1 = fixture('collectible-v1.json');
  const v2 = fixture('collectible-v2-upgraded.json');
  const upgraded = upgradeProject(v1);
  assert.deepEqual(upgraded, v2);
  assert.deepEqual(upgradeProject(upgraded), v2);
  assert.throws(() => upgradeProject({ ...v1, schemaVersion: 3 }), /버전/);
  assert.throws(() => upgradeProject(null), /객체/);
});

test('resolveSticker applies a grade-specific layout override and leaves stickers without one untouched', () => {
  const sticker = { id: 's1', x: .5, y: .5, size: 40, rotation: 0, layouts: { gold: { x: .2, y: .3, size: 60, rotation: 15 } } };
  assert.deepEqual(resolveSticker(sticker, 'gold'), { ...sticker, x: .2, y: .3, size: 60, rotation: 15 });
  assert.deepEqual(resolveSticker(sticker, 'silver'), sticker);
  const partial = { id: 's2', x: .1, y: .1, size: 20, rotation: 0, layouts: { gold: { x: .9 } } };
  assert.deepEqual(resolveSticker(partial, 'gold'), { ...partial, x: .9, y: .1, size: 20, rotation: 0 });
});

test('resolveGreeting priority vectors match the shared fixture the server also checks: grade+theme > grade > theme > default, ties by array order', () => {
  const vectors = fixture('collectible-vectors.json');
  for (const vector of vectors.greeting) {
    assert.equal(resolveGreeting(vector.project, vector.gradeId), vector.expected, vector.description);
  }
});

test('particleAt vectors match the shared fixture the server also checks and reject unknown kinds', () => {
  const vectors = fixture('collectible-vectors.json');
  for (const vector of vectors.particleAt) assert.deepEqual(particleAt(vector.kind, vector.i, vector.phase), vector.expected, `${vector.kind}#${vector.i}@${vector.phase}`);
  assert.throws(() => particleAt('fireworks', 0, 0), /파티클/);
});

test('stickerLines splits on \\n and keeps at most 4 lines(server rules.ts 상한과 맞춘다)', () => {
  assert.deepEqual(stickerLines('어서오세요'), ['어서오세요']);
  assert.deepEqual(stickerLines('첫째\n둘째\n셋째\n넷째'), ['첫째', '둘째', '셋째', '넷째']);
  assert.deepEqual(stickerLines('1\n2\n3\n4\n5'), ['1', '2', '3', '4'], '5번째 줄은 잘려서 렌더링된다(서버는 이를 거절한다)');
  assert.deepEqual(stickerLines(''), ['']);
  assert.deepEqual(stickerLines(undefined), ['']);
});

const closeToAll = (actual, expected) => actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-9, `${value} ~= ${expected[index]}`));
test('stickerLineOffsets centers the whole block vertically with 1.2x line height', () => {
  assert.deepEqual(stickerLineOffsets(1), [0]);
  closeToAll(stickerLineOffsets(2), [-0.6, 0.6]);
  closeToAll(stickerLineOffsets(3), [-1.2, 0, 1.2]);
  closeToAll(stickerLineOffsets(4), [-1.8, -0.6, 0.6, 1.8]);
  // 블록 중앙(모든 오프셋의 평균)은 항상 0이다.
  for (const count of [1, 2, 3, 4]) {
    const offsets = stickerLineOffsets(count);
    assert.ok(Math.abs(offsets.reduce((sum, value) => sum + value, 0) / count) < 1e-9);
  }
  assert.throws(() => stickerLineOffsets(0), TypeError);
  assert.throws(() => stickerLineOffsets(1.5), TypeError);
});

test('angleFrameIndex vectors match the shared fixture the server also checks: front range clamps to the edge cell, beyond ±90 is the back', () => {
  const vectors = fixture('collectible-vectors.json');
  for (const vector of vectors.angleFrameIndex) assert.deepEqual(angleFrameIndex(vector.angle), vector.expected, `angle ${vector.angle}`);
  // 360도 넘겨 계속 도는 회전 애니메이션도 같은 규칙으로 접힌다.
  assert.deepEqual(angleFrameIndex(360), angleFrameIndex(0));
  assert.deepEqual(angleFrameIndex(-360 - 82.5), angleFrameIndex(-82.5));
});
