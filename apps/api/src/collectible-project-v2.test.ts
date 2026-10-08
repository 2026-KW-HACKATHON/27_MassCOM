import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import type { CollectibleProject } from './collectible-project.js';
import { collectibleSnapshot, resolveGreeting, upgradeCollectibleProject, validateCollectibleProject } from './collectible-project-rules.js';
import { photoProject, tinyPng } from './collectible-project-test-support.js';

// Issue #284 WP1: v1→v2 업그레이드, v2 전용 검증 범위, 게시 준비, 인사말 우선순위, 노출 표면. 공유 픽스처는
// 웹 model.mjs 시험과 같은 파일을 읽어 서버·브라우저 두 구현이 같은 값을 내는지 맞춘다.
const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`../../../tests/fixtures/${name}`, import.meta.url), 'utf8'));

test('golden v1→v2 upgrade matches the shared fixture exactly and upgrading twice is idempotent', () => {
  const v1 = fixture('collectible-v1.json');
  const v2 = fixture('collectible-v2-upgraded.json');
  const upgraded = upgradeCollectibleProject(v1);
  assert.deepEqual(upgraded, v2);
  assert.deepEqual(upgradeCollectibleProject(upgraded), v2);
  // validateCollectibleProject accepts the same v1 payload (an old open editor tab) and produces the same v2 shape.
  assert.deepEqual(validateCollectibleProject(v1), v2);
  assert.throws(() => upgradeCollectibleProject({ ...(v1 as Record<string, unknown>), schemaVersion: 3 }), { code: 'COLLECTIBLE_INVALID_PROJECT' });
});

test('greeting priority vectors match the shared fixture: grade+theme > grade > theme > default, ties by array order', () => {
  const vectors = fixture('collectible-vectors.json') as { greeting: { description: string; project: Pick<CollectibleProject, 'theme' | 'greeting' | 'greetingOverrides'>; gradeId: string; expected: string }[] };
  for (const vector of vectors.greeting) {
    assert.equal(resolveGreeting(vector.project as CollectibleProject, vector.gradeId), vector.expected, vector.description);
  }
});

function sized(width: number, height: number): string {
  const png = Buffer.from(tinyPng.split(',')[1]!, 'base64'); png.writeUInt32BE(width, 16); png.writeUInt32BE(height, 20);
  return `data:image/png;base64,${png.toString('base64')}`;
}
function animatedWebpUrl(width: number, height: number): string {
  const vp8x = Buffer.alloc(10); vp8x[0] = 0x02; vp8x.writeUIntLE(width - 1, 4, 3); vp8x.writeUIntLE(height - 1, 7, 3);
  const chunk = Buffer.alloc(8 + vp8x.length); chunk.write('VP8X', 0); chunk.writeUInt32LE(vp8x.length, 4); vp8x.copy(chunk, 8);
  const header = Buffer.alloc(12); header.write('RIFF', 0); header.writeUInt32LE(4 + chunk.length, 4); header.write('WEBP', 8);
  return `data:image/webp;base64,${Buffer.concat([header, chunk]).toString('base64')}`;
}

// 모든 v2 신규 기능을 쓰는 "완전한" 프로젝트. publish=true까지 그대로 통과해야 하고, 각 시험은 이 기준에서 항목 하나만 어긋낸다.
function richProject(): CollectibleProject {
  const project = photoProject();
  // These schema tests exercise the generic v2 validation/snapshot contract, not the
  // Postgres standard-visit publish normalization. Keep a custom linked grade so
  // custom-scoped living/motion/effect requirements stay meaningful.
  project.rewardGrades = { '1': 'bronze', '3': 'custom' };
  project.stickers = [
    { id: 'face-1', kind: 'mascot', text: 'wave', x: .5, y: .3, size: 40, rotation: 0, color: '#ffffff', order: 0, align: 'center', layouts: { custom: { x: .4, y: .3, size: 50, rotation: 10 } } },
    { id: 'label-1', kind: 'text', text: '어서오세요', x: .3, y: .7, size: 30, rotation: 0, color: '#ffffff', order: 1, align: 'left', layouts: {} },
  ];
  project.back = { mode: 'custom', color: '#112233', stickers: [{ id: 'back-1', kind: 'text', text: '뒷면', x: .5, y: .5, size: 30, rotation: 0, color: '#ffffff', order: 0 }] };
  project.motion = [{ id: 'motion-confetti', type: 'confetti', gradeIds: ['custom'], playback: 'once', particle: 'snow' }];
  project.greetingOverrides = [{ id: 'greet-1', gradeIds: ['custom'], themeName: '', text: '특별 인사' }];
  // parallax는 등급을 가리지 않는 전역 설정이라 켜 두면 게시하는 모든 등급에 angleFrames가 필요해진다.
  // 기본 픽스처는 꺼 두고, 그 요구를 정확히 시험하는 곳에서만 켠다.
  project.parallax = { strength: 0, strokes: [] };
  project.living = { periodMs: 2000, items: [{ id: 'living-1', kind: 'sway', target: 'region', gradeIds: ['custom'], amplitude: 20, pivot: { x: .5, y: .5 }, strokes: [{ x: .4, y: .4 }, { x: .6, y: .6 }] }] };
  project.effects.push({ id: 'holo-1', type: 'hologram', target: 'surface', gradeIds: ['custom'], strength: 60, color: '#ffffff', roughness: 10 });
  project.derived.custom = {
    imageDataUrl: tinyPng, thumbnailDataUrl: tinyPng, backImageDataUrl: tinyPng,
    angleFrames: { dataUrl: sized(256 * 4, 256 * 3), side: 256, count: 12, columns: 4, stepDegrees: 15 },
    living: { dataUrl: sized(128, 64), count: 8, columns: 4, cellWidth: 32, cellHeight: 32, periodMs: 2000, box: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 } },
  };
  project.derived.bronze = { imageDataUrl: tinyPng, thumbnailDataUrl: tinyPng, backImageDataUrl: tinyPng };
  return project;
}

test('a fully featured v2 project (stickers with layouts/mascot, back, motion playback/particle, greeting overrides, parallax, living, angle frames) validates and publishes', () => {
  const saved = validateCollectibleProject(richProject(), true);
  assert.equal(saved.stickers[0]!.kind, 'mascot');
  assert.equal(saved.back.mode, 'custom');
  assert.equal(saved.motion[0]!.particle, 'snow');
  assert.equal(saved.derived.custom!.angleFrames!.count, 12);
});

test('one rejection per new v2 bound', () => {
  const mutations: Record<string, (p: CollectibleProject) => void> = {
    'non-finite': p => { p.living.items[0]!.amplitude = Infinity; },
    'over-range (angleFrames.side)': p => { p.derived.custom!.angleFrames!.side = 600; },
    'unknown key on back': p => { (p.back as unknown as Record<string, unknown>).extra = 1; },
    'dangling sticker layout grade ref': p => { p.stickers[0]!.layouts = { ghost: { x: .5, y: .5, size: 40, rotation: 0 } }; },
    'dangling living target ref': p => { p.living.items[0] = { id: 'living-1', kind: 'sway', target: 'ghost-sticker', gradeIds: ['custom'], amplitude: 20, pivot: { x: .5, y: .5 } }; },
    'duplicate id across front and back': p => { p.back.stickers[0]!.id = 'face-1'; },
    'sticker text carries \\r': p => { p.stickers[1]!.text = '가\r나'; },
    'sticker text over 4 lines': p => { p.stickers[1]!.text = '1\n2\n3\n4\n5'; },
    'unknown mascot pose': p => { p.stickers[0]!.text = 'not-a-real-pose'; },
    'blink on a non-mascot sticker': p => { p.living.items[0] = { id: 'living-1', kind: 'blink', target: 'label-1', gradeIds: ['custom'], amplitude: 10, pivot: { x: .5, y: .5 } }; },
    'particle set on a non-confetti motion': p => { p.motion[0] = { ...p.motion[0]!, type: 'rotate' }; },
    'angle frame sprite dimensions off': p => { p.derived.custom!.angleFrames!.dataUrl = sized(999, 999); },
    'living sprite box overflow': p => { p.derived.custom!.living!.box = { x: 0.8, y: 0.1, w: 0.3, h: 0.3 }; },
    'greeting override with no grade and no theme': p => { p.greetingOverrides = [{ id: 'wild', gradeIds: [], themeName: '', text: '아무거나' }]; },
  };
  for (const [label, mutate] of Object.entries(mutations)) {
    const project = richProject(); mutate(project);
    assert.throws(() => validateCollectibleProject(project), { code: 'COLLECTIBLE_INVALID_PROJECT' }, label);
  }
  // 이 둘은 미디어 크기 한도라 MEDIA_TOO_LARGE·구조 오류로 코드가 갈린다.
  const oversize = richProject(); oversize.derived.custom!.angleFrames!.dataUrl = `data:image/png;base64,${Buffer.alloc(1024 * 1024 + 16, 1).toString('base64')}`;
  assert.throws(() => validateCollectibleProject(oversize), { code: 'COLLECTIBLE_MEDIA_TOO_LARGE' }, 'over-size sprite');
  const animated = richProject(); animated.derived.custom!.angleFrames!.dataUrl = animatedWebpUrl(1024, 768);
  assert.throws(() => validateCollectibleProject(animated), { code: 'COLLECTIBLE_INVALID_PROJECT' }, 'animated WebP sprite');
});

test('publish readiness: backImageDataUrl stays optional (deploy-skew-safe fallback), angleFrames stays optional until WP3, living is required only when referenced', () => {
  // backImageDataUrl은 새 편집기가 항상 만들지만, 배포 스큐 동안 이미 열려 있던 구 편집기 탭이나 v1에서 올라온
  // 기존 프로젝트는 이 필드 없이 게시를 시도할 수 있어 필수로 두지 않는다(클라이언트는 없을 때 기존 모습으로 대체).
  const missingBack = richProject(); delete missingBack.derived.custom!.backImageDataUrl;
  validateCollectibleProject(missingBack, true);

  // angleFrames(각도 프레임)는 WP3 범위라 아직 선택이다.
  const missingAngleForEffect = richProject(); delete missingAngleForEffect.derived.custom!.angleFrames;
  validateCollectibleProject(missingAngleForEffect, true);

  const missingLiving = richProject(); delete missingLiving.derived.custom!.living;
  assert.throws(() => validateCollectibleProject(missingLiving, true), { code: 'COLLECTIBLE_NOT_READY' });

  // living 항목이 이 등급을 참조하지 않으면 living 스프라이트가 없어도 게시할 수 있다.
  const noLivingRef = richProject(); noLivingRef.living = { periodMs: 2000, items: [] };
  delete noLivingRef.derived.custom!.living;
  validateCollectibleProject(noLivingRef, true);
});

test('regression: a project shaped like the WP2 editor output (back image present, no angle frames, metallic/hologram enabled) is publish-ready', () => {
  // 현재 collectible-renderer.mjs의 serializeDerived가 실제로 만드는 모양: imageDataUrl·thumbnailDataUrl·
  // baseDataUrl·effectMasks·backImageDataUrl뿐이며 angleFrames·living은 아직 없다(WP3 범위).
  const project = photoProject();
  project.effects.push({ id: 'metal-1', type: 'metallic', target: 'surface', gradeIds: ['custom'], strength: 50, color: '#ffffff', roughness: 10 });
  project.derived.bronze = { imageDataUrl: tinyPng, thumbnailDataUrl: tinyPng, baseDataUrl: tinyPng, effectMasks: {}, backImageDataUrl: tinyPng };
  project.derived.custom = { imageDataUrl: tinyPng, thumbnailDataUrl: tinyPng, baseDataUrl: tinyPng, effectMasks: {}, backImageDataUrl: tinyPng };
  const saved = validateCollectibleProject(project, true);
  assert.equal(saved.derived.custom!.backImageDataUrl, tinyPng);
  assert.equal(saved.derived.custom!.angleFrames, undefined);
});

test('publish succeeds for a linked grade missing backImageDataUrl (old editor tab / v1-upgraded project during deploy skew), but validates it when present', () => {
  const project = photoProject();
  project.derived.bronze = { imageDataUrl: tinyPng, thumbnailDataUrl: tinyPng };
  project.derived.custom = { imageDataUrl: tinyPng, thumbnailDataUrl: tinyPng };
  const saved = validateCollectibleProject(project, true);
  assert.equal(saved.derived.custom!.backImageDataUrl, undefined);

  // 뒷면 이미지를 보냈다면(새 편집기 경로) 여전히 이미지로서 검증한다.
  const withBadBack = photoProject();
  withBadBack.derived.bronze = { imageDataUrl: tinyPng, thumbnailDataUrl: tinyPng, backImageDataUrl: 'not-a-data-url' };
  withBadBack.derived.custom = { imageDataUrl: tinyPng, thumbnailDataUrl: tinyPng, backImageDataUrl: 'not-a-data-url' };
  assert.throws(() => validateCollectibleProject(withBadBack, true), { code: 'COLLECTIBLE_INVALID_PROJECT' });
});

test('snapshot exposes only baked final assets: no strokes, no original photo, no parallax/living edit config, animation stays a v1 value', () => {
  const project = validateCollectibleProject(richProject(), true);
  const snapshot = collectibleSnapshot(project, 'project-id', 'publication-id', 'custom');
  const serialized = JSON.stringify(snapshot);
  for (const forbidden of ['strokes', 'originalDataUrl', '"parallax"', '"living":{"periodMs"']) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.deepEqual(snapshot.motions, [{ type: 'confetti', playback: 'once', particle: 'snow' }]);
  // v1 Android enum stays exactly these 8 values; a once-only confetti motion leaves no loop motion, so it falls back to 'still'.
  const v1Enum = ['still', 'rotate', 'shine', 'float', 'stamp', 'sparkle', 'pulse', 'confetti'];
  assert.ok(v1Enum.includes(snapshot.animation));
  assert.equal(snapshot.animation, 'still');
  const looping = validateCollectibleProject(richProject(), false);
  looping.motion[0]!.playback = 'loop';
  const loopingSnapshot = collectibleSnapshot(validateCollectibleProject(looping, true), 'p', 'pub', 'custom');
  assert.equal(loopingSnapshot.animation, 'confetti');
  assert.ok(v1Enum.includes(loopingSnapshot.animation));
});

test('a payload smuggling a huge array is rejected before any deep clone, not after (P2 DoS fix)', () => {
  // Codex 리뷰 지적(2026-10-01): 구조 복제(structuredClone)가 배열 길이 검사보다 먼저 일어나면, 5.4MB 정도의
  // 요청 안에 원소 수십만 개짜리 배열 하나만 심어도 그 복제 비용(약 434ms·+156MiB)을 그대로 치른다.
  // 이제는 값을 얕게 훑어 배열 길이부터 거절하므로, 원소를 하나도 복제하지 않고 곧장 실패해야 빠르다.
  const bigStrokes = new Array(300_000).fill(0).map(() => ({ x: 0, y: 0 }));
  const bomb = { schemaVersion: 2, photoEdits: { strokes: bigStrokes } };
  const started = performance.now();
  assert.throws(() => validateCollectibleProject(bomb), { code: 'COLLECTIBLE_INVALID_PROJECT' });
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 100, `array bomb rejection took ${elapsed.toFixed(1)}ms, expected a fast fail before any deep clone`);

  // 알려지지 않은 키 이름 아래 심어도(구조 키 검사 전에 이미 걸린다), 최상위 배열이어도 똑같이 빠르게 거절한다.
  const unknownKeyBomb = { schemaVersion: 1, stickers: new Array(300_000).fill(0) };
  const startedUnknown = performance.now();
  assert.throws(() => validateCollectibleProject(unknownKeyBomb), { code: 'COLLECTIBLE_INVALID_PROJECT' });
  assert.ok(performance.now() - startedUnknown < 100);
});

test('the pre-clone shape budget still admits the largest legitimate brush work (100 strokes x 1,000 points)', () => {
  const project = richProject();
  project.photoEdits.strokes = Array.from({ length: 100 }, () => ({
    tool: 'clean' as const, size: 0.05, color: '#000000',
    points: Array.from({ length: 1000 }, (_, index) => ({ x: (index % 100) / 100, y: 0.5 })),
  }));
  assert.doesNotThrow(() => validateCollectibleProject(project, false));
});

test('a deeply nested payload is rejected as an invalid project, not a stack overflow (HTTP 500)', () => {
  let nested: unknown = [];
  for (let level = 0; level < 50_000; level += 1) nested = [nested];
  assert.throws(() => validateCollectibleProject({ schemaVersion: 2, stickers: nested }), { code: 'COLLECTIBLE_INVALID_PROJECT' });
  validateCollectibleProject(richProject());
});

test('sprite fields (backImageDataUrl, angleFrames, living) accept only PNG/WebP, never JPEG (EXIF Orientation could rotate a pixel-sliced sprite)', () => {
  // 각 필드의 PNG와 같은 크기를 선언한 JPEG(SOI + SOF0 + EOI)로 바꾼다. 크기 검사는 통과하므로 MIME 제한만이 거절 이유다.
  const jpegLike = (pngUrl: string) => {
    const png = Buffer.from(pngUrl.split(',')[1]!, 'base64');
    const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
    const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]);
    return `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.from([0xff, 0xd9])]).toString('base64')}`;
  };
  const back = richProject(); back.derived.custom!.backImageDataUrl = jpegLike(back.derived.custom!.backImageDataUrl!);
  assert.throws(() => validateCollectibleProject(back), { code: 'COLLECTIBLE_INVALID_PROJECT' });
  const angle = richProject(); angle.derived.custom!.angleFrames!.dataUrl = jpegLike(angle.derived.custom!.angleFrames!.dataUrl);
  assert.throws(() => validateCollectibleProject(angle), { code: 'COLLECTIBLE_INVALID_PROJECT' });
  const living = richProject(); living.derived.custom!.living!.dataUrl = jpegLike(living.derived.custom!.living!.dataUrl);
  assert.throws(() => validateCollectibleProject(living), { code: 'COLLECTIBLE_INVALID_PROJECT' });
  // PNG는 그대로 통과한다(위 richProject() 기본값이 이미 PNG로 검증됨).
  validateCollectibleProject(richProject());
});
