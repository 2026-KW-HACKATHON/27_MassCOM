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

test('publish readiness: backImageDataUrl always required, angleFrames required for metallic/hologram/pearl or parallax, living required when referenced', () => {
  const missingBack = richProject(); delete missingBack.derived.custom!.backImageDataUrl;
  assert.throws(() => validateCollectibleProject(missingBack, true), { code: 'COLLECTIBLE_NOT_READY' });

  const missingAngleForEffect = richProject(); delete missingAngleForEffect.derived.custom!.angleFrames;
  assert.throws(() => validateCollectibleProject(missingAngleForEffect, true), { code: 'COLLECTIBLE_NOT_READY' });

  // 홀로그램 효과를 빼면 앵글 프레임 없이도 게시할 수 있다(패럴랙스도 꺼져 있으면).
  const noHologram = richProject(); noHologram.effects = noHologram.effects.filter(e => e.type !== 'hologram');
  noHologram.parallax = { strength: 0, strokes: [] };
  delete noHologram.derived.custom!.angleFrames;
  validateCollectibleProject(noHologram, true);

  // 패럴랙스가 켜져 있으면(획이 있으면) 홀로그램이 없어도, 모든 게시 등급에 앵글 프레임이 필요하다(등급을 가리지 않는 전역 설정).
  const parallaxNeedsAngle = richProject(); parallaxNeedsAngle.effects = parallaxNeedsAngle.effects.filter(e => e.type !== 'hologram');
  parallaxNeedsAngle.parallax = { strength: 40, strokes: [{ tool: 'fg', size: 0.05, points: [{ x: .5, y: .5 }] }] };
  assert.throws(() => validateCollectibleProject(parallaxNeedsAngle, true), { code: 'COLLECTIBLE_NOT_READY' });

  const missingLiving = richProject(); delete missingLiving.derived.custom!.living;
  assert.throws(() => validateCollectibleProject(missingLiving, true), { code: 'COLLECTIBLE_NOT_READY' });

  // living 항목이 이 등급을 참조하지 않으면 living 스프라이트가 없어도 게시할 수 있다.
  const noLivingRef = richProject(); noLivingRef.living = { periodMs: 2000, items: [] };
  delete noLivingRef.derived.custom!.living;
  validateCollectibleProject(noLivingRef, true);
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
