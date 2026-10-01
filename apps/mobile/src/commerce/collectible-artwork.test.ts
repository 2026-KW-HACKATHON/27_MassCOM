import assert from 'node:assert/strict';
import { test } from 'node:test';

import { grantedArtworkEntitlement, parseCollectibleArtwork, parsePublishedCollectible } from './collectible-artwork';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1sAAAAASUVORK5CYII=';
const artwork = { publicationId: 'publication-a', projectId: 'project-a', gradeId: 'winter', gradeName: '겨울 기념', name: '가게 우표', shape: 'stamp', theme: { name: '겨울방학' }, thumbnailDataUrl: png };
const detail = { ...artwork, imageDataUrl: png, thickness: 8, angle: 0, animation: 'rotate', greeting: '들러 주셔서 고마워요', audio: null, story: { type: 'zoom', frames: [], cartoon: 0, strength: 50 } };

test('도감 썸네일 계약은 원본 사진·점주 정보·다른 등급 데이터를 남기지 않는다', () => {
  const parsed = parseCollectibleArtwork({ ...artwork, photo: { originalDataUrl: png }, requestedByAccountId: 'owner', otherGrades: [png] });
  assert.deepEqual(parsed, artwork);
  assert.equal('photo' in parsed!, false);
  assert.equal('requestedByAccountId' in parsed!, false);
});

test('게시 상세는 선택 등급과 한 사진 확대를 받고 원본 편집 이력을 버린다', () => {
  const parsed = parsePublishedCollectible({ ...detail, photo: { originalDataUrl: png }, photoEdits: { strokes: [] }, effects: [{ type: 'hologram' }] });
  assert.deepEqual(parsed, detail);
  assert.equal('photoEdits' in parsed!, false);
  assert.equal(parsed!.story.frames.length, 0);
});

test('외부 주소·SVG·과대 썸네일은 도감 이미지로 받지 않는다', () => {
  for (const thumbnailDataUrl of ['https://example.test/private-photo.png', 'data:image/svg+xml;base64,PHN2Zz4=', `data:image/png;base64,${'A'.repeat(350_000)}`]) {
    assert.equal(parseCollectibleArtwork({ ...artwork, thumbnailDataUrl }), undefined);
  }
  assert.equal(parseCollectibleArtwork({ ...artwork, shape: 'flower' }), undefined);
});

test('상세의 각도·두께·장면 수치와 실제 자료 요구를 검증한다', () => {
  for (const extra of [{ angle: Infinity }, { angle: 181 }, { thickness: 0 }, { thickness: 25 }, { animation: 'unbounded-animation' }]) {
    assert.equal(parsePublishedCollectible({ ...detail, ...extra }), undefined);
  }
  const frame = { dataUrl: png, width: 512, height: 512 };
  for (const [type, count] of [['wide', 1], ['follow', 2], ['event', 3]] as const) {
    assert.ok(parsePublishedCollectible({ ...detail, story: { ...detail.story, type, frames: Array.from({ length: count }, () => frame) } }));
    assert.equal(parsePublishedCollectible({ ...detail, story: { ...detail.story, type, frames: Array.from({ length: count - 1 }, () => frame) } }), undefined);
  }
  for (const badFrame of [{ ...frame, width: 0 }, { ...frame, height: 4097 }, { ...frame, width: 1.5 }]) {
    assert.equal(parsePublishedCollectible({ ...detail, story: { ...detail.story, frames: [badFrame] } }), undefined);
  }
});

test('음성은 제한된 inline 형식과 동일 MIME·길이만 받는다', () => {
  const audio = { dataUrl: 'data:audio/mpeg;base64,SUQzBAAAAAAA', mimeType: 'audio/mpeg', durationSeconds: 3 };
  assert.deepEqual(parsePublishedCollectible({ ...detail, audio })!.audio, audio);
  for (const extra of [{ mimeType: 'audio/ogg' }, { durationSeconds: 31 }, { durationSeconds: Number.NaN }, { dataUrl: 'https://example.test/voice.mp3' }]) {
    assert.equal(parsePublishedCollectible({ ...detail, audio: { ...audio, ...extra } }), undefined);
  }
});

const angleFrames = { dataUrl: png, side: 256, count: 12, columns: 4, stepDegrees: 15 };
const living = { dataUrl: png, count: 8, columns: 4, cellWidth: 64, cellHeight: 64, periodMs: 2400, box: { x: 0, y: 0, w: .5, h: .5 } };
const motions = [{ type: 'rotate', playback: 'loop' }, { type: 'confetti', playback: 'once', particle: 'confetti' }];
const v2Extras = { backImageDataUrl: png, angleFrames, living, motions };

test('v2 필드(뒷면·각도 프레임·living·모션)가 유효하면 그대로 파싱된다', () => {
  const parsed = parsePublishedCollectible({ ...detail, ...v2Extras });
  assert.deepEqual(parsed, { ...detail, ...v2Extras });
});

test('v1 상세는 새 필드 없이 오늘과 똑같이 파싱된다(새 필드는 선택이며 폴백이 v1 모습이다)', () => {
  const parsed = parsePublishedCollectible(detail);
  assert.deepEqual(parsed, detail);
  assert.equal('backImageDataUrl' in parsed!, false);
  assert.equal('angleFrames' in parsed!, false);
  assert.equal('living' in parsed!, false);
  assert.equal('motions' in parsed!, false);
});

test('잘못된 새 필드 하나는 그 필드만 버리고 상세 전체는 거절하지 않는다', () => {
  const jpeg = png.replace('image/png', 'image/jpeg');
  for (const bad of [jpeg, 'https://example.test/back.png', 123]) {
    const parsed = parsePublishedCollectible({ ...detail, ...v2Extras, backImageDataUrl: bad });
    assert.deepEqual(parsed, { ...detail, angleFrames, living, motions });
  }
  for (const bad of [{ ...angleFrames, count: 11 }, { ...angleFrames, columns: 3 }, { ...angleFrames, stepDegrees: 10 }, { ...angleFrames, side: 100 }, { ...angleFrames, dataUrl: jpeg }]) {
    const parsed = parsePublishedCollectible({ ...detail, ...v2Extras, angleFrames: bad });
    assert.deepEqual(parsed, { ...detail, backImageDataUrl: png, living, motions });
  }
  for (const bad of [{ ...living, count: 7 }, { ...living, columns: 9 }, { ...living, box: { x: .6, y: 0, w: .5, h: .5 } }, { ...living, periodMs: 500 }]) {
    const parsed = parsePublishedCollectible({ ...detail, ...v2Extras, living: bad });
    assert.deepEqual(parsed, { ...detail, backImageDataUrl: png, angleFrames, motions });
  }
  for (const bad of [[{ type: 'unknown-motion', playback: 'loop' }], [{ type: 'rotate', playback: 'sometimes' }], [{ type: 'rotate', playback: 'loop', particle: 'snow' }]]) {
    const parsed = parsePublishedCollectible({ ...detail, ...v2Extras, motions: bad });
    assert.deepEqual(parsed, { ...detail, backImageDataUrl: png, angleFrames, living });
  }
});

test('빈 모션 목록은 "이 등급에 걸린 모션 없음"이라는 유효한 서버 응답이라 그대로 받는다(WP4 리뷰 8)', () => {
  const parsed = parsePublishedCollectible({ ...detail, ...v2Extras, motions: [] });
  assert.deepEqual(parsed, { ...detail, backImageDataUrl: png, angleFrames, living, motions: [] });
});

test('living.periodMs는 서버처럼 1000~4000 사이 소수도 받는다(정수 강제는 유효한 값을 버린다, WP4 리뷰 8)', () => {
  const fractional = { ...living, periodMs: 2399.5 };
  const parsed = parsePublishedCollectible({ ...detail, ...v2Extras, living: fractional });
  assert.deepEqual(parsed!.living, fractional);
  // 범위를 벗어난 값은 기존 규칙대로 living 필드만 버리고 상세 전체는 거절하지 않는다.
  for (const bad of [999.9, 4000.1, Number.NaN]) {
    const dropped = parsePublishedCollectible({ ...detail, ...v2Extras, living: { ...living, periodMs: bad } });
    assert.equal('living' in dropped!, false);
  }
});

test('애니메이션 enum은 v1과 똑같이 8종으로 엄격하다(모션 추가로 느슨해지지 않는다)', () => {
  assert.equal(parsePublishedCollectible({ ...detail, ...v2Extras, animation: 'new-animation-kind' }), undefined);
});

test('방문 수령으로 받은 보상 중 외형이 붙은 것만 "받은 수집품 보기" 대상이 된다', () => {
  const granted = [
    { entitlementId: 'goal-1', targetVisitCount: 1 }, { entitlementId: 'goal-3', targetVisitCount: 3 }, { entitlementId: 'goal-5', targetVisitCount: 5 },
  ];
  // 외형 없는 기존 보상만 받았으면 버튼 대상이 없다.
  assert.equal(grantedArtworkEntitlement(granted, [{ entitlementId: 'goal-1' }, { entitlementId: 'goal-3' }]), undefined);
  assert.equal(grantedArtworkEntitlement([], [{ entitlementId: 'goal-1', artwork }]), undefined);
  // 첫 번째 보상이 아니라 외형이 붙은 보상을 고른다.
  assert.equal(grantedArtworkEntitlement(granted, [{ entitlementId: 'goal-1' }, { entitlementId: 'goal-3', artwork }]), 'goal-3');
  // 1·3·5회가 함께 지급돼 여럿에 외형이 있으면 가장 높은 방문 목표를 고른다(응답 순서와 무관).
  assert.equal(grantedArtworkEntitlement([...granted].reverse(), granted.map((item) => ({ entitlementId: item.entitlementId, artwork }))), 'goal-5');
  // 이전 방문에서 받은 다른 수집품은 이번 지급분이 아니다.
  assert.equal(grantedArtworkEntitlement([granted[0]!], [{ entitlementId: 'older', artwork }, { entitlementId: 'goal-1' }]), undefined);
});
