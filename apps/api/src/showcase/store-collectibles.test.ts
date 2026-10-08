import assert from 'node:assert/strict';
import { test } from 'node:test';

import { collectibleSnapshot, validateCollectibleProject } from '../collectible-project-rules.js';
import { storeCollectibleArt } from './store-collectible-art.js';
import { WOLGYE_PRISM_STORE } from './wolgye-seed.js';
import {
  STORE_COLLECTIBLE_GRADE_IDS,
  STORE_COLLECTIBLE_REWARD_GRADES,
  storeCollectibleProject,
} from './store-collectibles.js';

const target = { merchantId: 'showcase-wolgye-default', campaignId: 'showcase-wolgye-default-campaign', storeName: '월계 공공데이터 가게', art: 'a' } as const;

// #333(R-333a): 시연 수집품은 목표 1·3·5회가 서로 다른 세 등급이어야 시연에서 은·금 수집품을 볼 수 있다.
test('goals 1, 3 and 5 map to three distinct grades: bronze, silver, gold', () => {
  assert.deepEqual(STORE_COLLECTIBLE_REWARD_GRADES, { 1: 'bronze', 3: 'silver', 5: 'gold' });
  assert.deepEqual(STORE_COLLECTIBLE_GRADE_IDS, ['bronze', 'silver', 'gold']);
  const project = storeCollectibleProject(target);
  assert.deepEqual(project.rewardGrades, { 1: 'bronze', 3: 'silver', 5: 'gold' });
  assert.deepEqual(project.grades.map((grade) => [grade.id, grade.name, grade.kind, grade.enabled]), [
    ['bronze', '브론즈', 'basic', true],
    ['silver', '실버', 'special', true],
    ['gold', '골드', 'special', true],
  ]);
  assert.deepEqual(Object.keys(project.derived), ['bronze', 'silver', 'gold']);
});

test('other real-data stores keep the default gold project unchanged', () => {
  for (const art of ['a', 'b'] as const) {
    const storeTarget = { ...target, art };
    const project = storeCollectibleProject(storeTarget);
    assert.deepEqual(project, storeCollectibleProject({ ...storeTarget, topGrade: 'gold' }));
    assert.deepEqual(project.grades.map((grade) => grade.id), ['bronze', 'silver', 'gold']);
    assert.deepEqual(project.rewardGrades, { 1: 'bronze', 3: 'silver', 5: 'gold' });
    assert.deepEqual(Object.keys(project.derived), ['bronze', 'silver', 'gold']);
  }
});

test('the nearest Wolgye store explicitly selects prism for five visits with its own validated snapshot', () => {
  const project = validateCollectibleProject(storeCollectibleProject({
    merchantId: WOLGYE_PRISM_STORE.id, campaignId: `${WOLGYE_PRISM_STORE.id}-campaign`,
    storeName: WOLGYE_PRISM_STORE.name, art: 'b', topGrade: 'prism',
  }), true);
  assert.deepEqual(project.grades.map((grade) => [grade.id, grade.name, grade.kind, grade.enabled]), [
    ['bronze', '브론즈', 'basic', true],
    ['silver', '실버', 'special', true],
    ['prism', '프리즘', 'special', true],
  ]);
  assert.deepEqual(project.rewardGrades, { 1: 'bronze', 3: 'silver', 5: 'prism' });
  assert.deepEqual(Object.keys(project.derived), ['bronze', 'silver', 'prism']);
  assert.ok(project.motion.filter((motion) => motion.gradeIds.includes('prism'))
    .every((motion) => motion.id.startsWith('motion-prism-')));
  const snapshot = collectibleSnapshot(project, 'project-c', 'publication-c', 'prism');
  assert.equal(snapshot.gradeId, 'prism');
  assert.equal(snapshot.gradeName, '프리즘');
  assert.equal(snapshot.animation, 'sparkle');
  assert.deepEqual(snapshot.motions, [
    { type: 'sparkle', playback: 'loop' },
    { type: 'pulse', playback: 'loop' },
    { type: 'confetti', playback: 'once', particle: 'sparkles' },
  ]);
  assert.equal(snapshot.greeting, '프리즘 수집품: 다섯 번째 방문까지 모두 채웠어요! 실제 가게 정보를 바탕으로 만든 시연용 가상 방문 수집품입니다.');
  for (const grade of project.grades) {
    const gradeSnapshot = collectibleSnapshot(project, 'project-c', 'publication-c', grade.id);
    assert.equal(gradeSnapshot.imageDataUrl, storeCollectibleArt.b.image);
    assert.equal(gradeSnapshot.thumbnailDataUrl, storeCollectibleArt.b.thumbnail);
    assert.deepEqual(gradeSnapshot.effects, []);
    assert.equal('effectMasks' in gradeSnapshot, false);
  }
  assert.equal(collectibleSnapshot(project, 'project-c', 'publication-c', 'bronze').animation, 'still');
  assert.equal(collectibleSnapshot(project, 'project-c', 'publication-c', 'silver').animation, 'shine');
});

test('the three-grade seed project passes the same publish validation the owner editor uses', () => {
  for (const art of ['a', 'b', 'c'] as const) {
    const validated = validateCollectibleProject(storeCollectibleProject({ ...target, art }), true);
    assert.deepEqual(validated.rewardGrades, { 1: 'bronze', 3: 'silver', 5: 'gold' });
  }
});

// 앱(모바일)은 발행 스냅샷의 등급 이름·동작(animation·motions)·인사말을 그대로 그린다. 재질 효과(effects)는 효과 마스크 이미지가 있어야
// 칠해지고 모바일 앱은 아예 읽지 않으므로(parsePublishedCollectible), 새 그림 자료 없이 등급마다 달라지는 이 세 가지로 눈에 띄게 가른다.
test('each grade snapshot differs in what the customer renderers show: grade name, motion and greeting', () => {
  const project = validateCollectibleProject(storeCollectibleProject(target), true);
  const snapshots = Object.fromEntries(
    STORE_COLLECTIBLE_GRADE_IDS.map((gradeId) => [gradeId, collectibleSnapshot(project, 'project-1', 'publication-1', gradeId)]),
  );
  assert.deepEqual(STORE_COLLECTIBLE_GRADE_IDS.map((gradeId) => snapshots[gradeId]!.gradeName), ['브론즈', '실버', '골드']);
  assert.deepEqual(STORE_COLLECTIBLE_GRADE_IDS.map((gradeId) => snapshots[gradeId]!.animation), ['still', 'shine', 'sparkle']);
  assert.deepEqual(snapshots.bronze!.motions, []);
  assert.deepEqual(snapshots.silver!.motions, [{ type: 'shine', playback: 'loop' }]);
  assert.deepEqual(snapshots.gold!.motions, [
    { type: 'sparkle', playback: 'loop' },
    { type: 'confetti', playback: 'once', particle: 'sparkles' },
  ]);
  const greetings = STORE_COLLECTIBLE_GRADE_IDS.map((gradeId) => snapshots[gradeId]!.greeting);
  assert.equal(new Set(greetings).size, 3);
  assert.match(greetings[0]!, /브론즈/);
  assert.match(greetings[1]!, /실버/);
  assert.match(greetings[2]!, /골드/);
  assert.ok(greetings.every((greeting) => greeting.includes('시연용 가상 방문')));
});

test('no new image asset: every grade reuses the store art that already ships, and no effect needs a mask image', () => {
  const project = validateCollectibleProject(storeCollectibleProject(target), true);
  for (const gradeId of STORE_COLLECTIBLE_GRADE_IDS) {
    const snapshot = collectibleSnapshot(project, 'project-1', 'publication-1', gradeId);
    assert.equal(snapshot.imageDataUrl, storeCollectibleArt.a.image);
    assert.equal(snapshot.thumbnailDataUrl, storeCollectibleArt.a.thumbnail);
    assert.deepEqual(snapshot.effects, []);
    assert.equal('effectMasks' in snapshot, false);
  }
});
