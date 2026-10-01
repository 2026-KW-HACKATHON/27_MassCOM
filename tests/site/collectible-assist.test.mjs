import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cropTransform, createProject } from '../../apps/production-web/assets/collectible-model.mjs';
import {
  applyDraftEdits, centerFillCrop, clearCollectibleDrafts, draftEditsOnly, draftStorageKey, faceFitCrop,
  findMaterialConflict, findMaterialConflicts, materialConflictQuestion, SAFE_AREA_RATIO,
} from '../../apps/production-web/assets/collectible-assist.mjs';

test('저장 키는 점포·계정마다 다르고 같은 입력에는 항상 같은 값이다(Issue #282 A1)', () => {
  const a = draftStorageKey('m1', 'account-a');
  const b = draftStorageKey('m1', 'account-b');
  const c = draftStorageKey('m2', 'account-a');
  assert.notEqual(a, b);
  assert.notEqual(a, c);
  assert.equal(draftStorageKey('m1', 'account-a'), a);
  assert.match(a, /^masscom:collectible-draft:m1:/);
});

test('기기 보관용 편집 값에는 사진·음성·이야기 장면·파생 이미지 같은 미디어를 절대 담지 않는다(Issue #282 단순화)', () => {
  const project = createProject({ name: '미디어 있는 편집' });
  project.photo = { originalDataUrl: `data:image/png;base64,${'A'.repeat(1000)}`, width: 10, height: 10 };
  project.story = { type: 'wide', frames: [{ dataUrl: `data:image/png;base64,${'B'.repeat(1000)}` }], cartoon: 0 };
  project.audio = { dataUrl: 'data:audio/mpeg;base64,CCCC', mimeType: 'audio/mpeg', durationSeconds: 5 };
  project.derived = { bronze: { imageDataUrl: `data:image/png;base64,${'D'.repeat(1000)}` } };

  const edits = draftEditsOnly(project);
  assert.equal(JSON.stringify(edits).includes('data:'), false, '어떤 data: URL도 저장 값에 남지 않는다');
  assert.equal('photo' in edits, false);
  assert.equal('audio' in edits, false);
  assert.equal('derived' in edits, false);
  assert.deepEqual(edits.story.frames, []);
  assert.equal(edits.name, '미디어 있는 편집', '미디어 아닌 편집 내용은 그대로 남는다');
  assert.equal(project.photo.originalDataUrl.length > 0, true, '원본 project는 바꾸지 않는다');
});

test('applyDraftEdits는 서버의 최신 사진·음성·이야기 장면·파생 이미지를 지키고 편집 값만 겹친다', () => {
  const server = createProject({ name: '서버 버전' });
  server.photo = { originalDataUrl: 'data:image/png;base64,SERVER', width: 20, height: 20 };
  server.audio = { dataUrl: 'data:audio/mpeg;base64,SERVER', mimeType: 'audio/mpeg', durationSeconds: 3 };
  server.story = { type: 'event', frames: [{ dataUrl: 'data:image/png;base64,FRAME' }], cartoon: 10, strength: 50 };
  server.derived = { bronze: { imageDataUrl: 'data:image/png;base64,DERIVED' } };

  const edited = createProject({ name: '기기에 남긴 편집' });
  edited.theme.name = '여름축제';
  const edits = draftEditsOnly(edited);
  const merged = applyDraftEdits(server, edits);

  assert.equal(merged.name, '기기에 남긴 편집', '편집 값은 기기 보관본을 따른다');
  assert.equal(merged.theme.name, '여름축제');
  assert.deepEqual(merged.photo, server.photo, '사진은 서버의 최신본을 지킨다');
  assert.deepEqual(merged.audio, server.audio, '음성은 서버의 최신본을 지킨다');
  assert.deepEqual(merged.story.frames, server.story.frames, '이야기 장면 자료는 서버의 최신본을 지킨다');
  assert.deepEqual(merged.derived, server.derived, '파생 이미지는 서버의 최신본을 지킨다');
});

test('무광·에나멜·유리만 서로 충돌하고, 자기 자신·다른 대상·다른 등급·다른 재질군은 걸리지 않는다(A8)', () => {
  const effects = [
    { id: 'e1', type: 'enamel', target: 'surface', gradeIds: ['bronze'] },
    { id: 'e2', type: 'metallic', target: 'surface', gradeIds: ['bronze'] },
    { id: 'e3', type: 'matte', target: 'photo', gradeIds: ['bronze'] },
  ];
  assert.equal(findMaterialConflict(effects, 'surface', 'bronze', 'matte')?.id, 'e1');
  assert.equal(findMaterialConflict(effects, 'surface', 'silver', 'matte'), null, '다른 등급은 충돌 아님');
  assert.equal(findMaterialConflict(effects, 'photo', 'bronze', 'matte'), null, '다른 대상은 충돌 아님');
  assert.equal(findMaterialConflict(effects, 'surface', 'bronze', 'metallic'), null, '메탈릭·펄·홀로그램·발광은 배타 재질이 아니다');
  assert.equal(findMaterialConflict(effects, 'surface', 'bronze', 'matte', 'e1'), null, '자기 자신은 제외한다');
});

test('중복 등록된 배타 재질도 전부 찾아내 하나도 놓치지 않는다(#289 리뷰 지적)', () => {
  const effects = [
    { id: 'e1', type: 'matte', target: 'surface', gradeIds: ['bronze'] },
    { id: 'e2', type: 'matte', target: 'surface', gradeIds: ['bronze'] },
    { id: 'e3', type: 'enamel', target: 'surface', gradeIds: ['silver'] },
  ];
  const conflicts = findMaterialConflicts(effects, 'surface', 'bronze', 'glass');
  assert.deepEqual(conflicts.map(item => item.id).sort(), ['e1', 'e2'], '같은 등급의 무광 두 개를 모두 찾아야 한다');
  assert.equal(findMaterialConflict(effects, 'surface', 'bronze', 'glass')?.id, 'e1', '단일 조회는 여전히 첫 번째만 돌려준다');
  assert.deepEqual(findMaterialConflicts(effects, 'surface', 'gold', 'glass'), [], '적용 안 된 등급은 충돌 없음');
});

test('재질 충돌 확인 문구는 기존 재질을 끄고 새 재질을 켤지 예/아니오로 묻는다', () => {
  assert.equal(materialConflictQuestion('enamel', 'matte'), '무광과 에나멜은 같은 곳에 함께 쓸 수 없어요. 에나멜을 끄고 무광을 켤까요?');
  assert.equal(materialConflictQuestion('matte', 'glass'), '유리와 무광은 같은 곳에 함께 쓸 수 없어요. 무광을 끄고 유리를 켤까요?');
});

/** cropTransform을 거꾸로 돌려 얼굴 중심이 실제로 프레임 중앙에 오는지 확인한다(자체 왕복 검증). */
function centeredFaceOffset(photoWidth, photoHeight, face) {
  const crop = faceFitCrop(photoWidth, photoHeight, face);
  const project = createProject();
  project.photo = { originalDataUrl: 'x', width: photoWidth, height: photoHeight };
  project.crop = { x: crop.x, y: crop.y, zoom: crop.zoom };
  const box = cropTransform(project, 512, 512);
  const scale = box.width / photoWidth;
  return {
    crop,
    centerX: box.x + (face.x + face.width / 2) * scale,
    centerY: box.y + (face.y + face.height / 2) * scale,
    faceSize: Math.max(face.width, face.height) * scale,
  };
}

test('얼굴을 프레임 중앙, 세이프 영역의 45% 크기로 맞춘다(A4, 합성 얼굴 상자)', () => {
  const centered = centeredFaceOffset(1000, 1000, { x: 400, y: 400, width: 200, height: 200 });
  assert.equal(centered.crop.method, 'face');
  assert.ok(Math.abs(centered.centerX - 256) < 1);
  assert.ok(Math.abs(centered.centerY - 256) < 1);
  assert.ok(Math.abs(centered.faceSize - 512 * SAFE_AREA_RATIO * 0.45) < 1);

  const offCenter = centeredFaceOffset(1000, 1000, { x: 550, y: 350, width: 120, height: 120 });
  assert.ok(Math.abs(offCenter.centerX - 256) < 1, '가로 오프셋 얼굴도 중앙에 온다');
  assert.ok(Math.abs(offCenter.centerY - 256) < 1, '세로 오프셋 얼굴도 중앙에 온다');
  assert.ok(offCenter.crop.x < 0 && offCenter.crop.y > 0, '왼쪽·아래로 치우친 얼굴은 반대 방향으로 이동한다');
});

test('구석에 가까운 얼굴은 crop·zoom을 -1..1·1..8 안으로 접어 넣고 계산이 깨지지 않는다', () => {
  const crop = faceFitCrop(1200, 800, { x: 60, y: 500, width: 150, height: 180 });
  assert.ok(crop.x >= -1 && crop.x <= 1);
  assert.ok(crop.y >= -1 && crop.y <= 1);
  assert.ok(crop.zoom >= 1 && crop.zoom <= 8);
  assert.ok(Object.values(crop).every(value => typeof value !== 'number' || Number.isFinite(value)));
});

test('아주 작은 얼굴은 확대를 8배까지만, 이미 큰 얼굴은 축소 없이 1배로 남긴다', () => {
  const tiny = faceFitCrop(4000, 4000, { x: 2000, y: 2000, width: 5, height: 5 });
  assert.equal(tiny.zoom, 8);
  const huge = faceFitCrop(500, 500, { x: 50, y: 50, width: 400, height: 400 });
  assert.equal(huge.zoom, 1);
});

test('사진이나 얼굴 상자가 없으면 얼굴 맞춤은 null을 돌려주고, 가운데 맞춤은 항상 같은 값이다', () => {
  assert.equal(faceFitCrop(0, 0, { x: 0, y: 0, width: 10, height: 10 }), null);
  assert.equal(faceFitCrop(100, 100, null), null);
  assert.equal(faceFitCrop(100, 100, { x: 0, y: 0, width: 0, height: 0 }), null);
  assert.deepEqual(centerFillCrop(), { x: 0, y: 0, zoom: 1, method: 'center' });
});

/** 표준 Storage(length·key(i))만 흉내 낸 최소 대역. localStorage 자체를 대신하지 않는다. */
function fakeStorage() {
  const map = new Map();
  return {
    getItem: key => map.has(key) ? map.get(key) : null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key),
    key: index => [...map.keys()][index] ?? null,
    get length() { return map.size; },
  };
}

test('로그아웃·계정 전환은 그 계정의 모든 점포 기기 보관본을 지우고 다른 계정·점포는 건드리지 않는다(#289 리뷰 지적)', () => {
  const storage = fakeStorage();
  storage.setItem(draftStorageKey('m1', 'account-a'), '{"project":"a1"}');
  storage.setItem(draftStorageKey('m2', 'account-a'), '{"project":"a2"}');
  storage.setItem(draftStorageKey('m1', 'account-b'), '{"project":"b1"}');
  clearCollectibleDrafts(storage, 'account-a');
  assert.equal(storage.getItem(draftStorageKey('m1', 'account-a')), null);
  assert.equal(storage.getItem(draftStorageKey('m2', 'account-a')), null, '같은 계정의 다른 점포 보관본도 지운다');
  assert.equal(storage.getItem(draftStorageKey('m1', 'account-b')), '{"project":"b1"}', '다른 계정은 그대로 둔다');
  assert.doesNotThrow(() => clearCollectibleDrafts(null, 'account-a'), 'storage가 없어도 조용히 넘어간다');
});
