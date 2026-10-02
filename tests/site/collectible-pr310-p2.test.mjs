import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installMiniDom, settle } from '../fixtures/mini-dom.mjs';
import { createProject, createId, cropTransform, livingBoundingBox } from '../../apps/production-web/assets/collectible-model.mjs';
import { renderCollectible, renderPublishedCollectible, serializeDerived, clearCollectibleRenderCache } from '../../apps/production-web/assets/collectible-renderer.mjs';

// PR #310 리뷰 P2(3~10): mini-dom은 canvas 호출을 전부 no-op으로 흉내 내 보통은 실제로 그려진 내용을 볼 수
// 없다. 여기서는 document.createElement를 한 번 더 감싸 canvas의 drawImage/putImageData 호출 인자를 직접
// 기록해(이 파일 전용 계측, 운영 코드는 건드리지 않음) 패럴랙스/living 마스크가 실제로 crop 변환을 받는지, 마스크
// 캐시가 제대로 맞는지까지 확인한다.
function recordCanvasDraws() {
  const calls = [];
  const maskCanvases = new WeakSet();
  let maskBuildCount = 0;
  const originalCreateElement = document.createElement.bind(document);
  document.createElement = (tag) => {
    const element = originalCreateElement(tag);
    if (tag === 'canvas') {
      const originalGetContext = element.getContext.bind(element);
      let patched = false;
      element.getContext = (type) => {
        const context = originalGetContext(type);
        if (!patched) {
          patched = true;
          context.drawImage = (...args) => { calls.push({ source: args[0], rest: args.slice(1), isMask: maskCanvases.has(args[0]) }); };
          // strokeMaskFor는 createImageData(w,h)로 직접 알파를 채운 뒤 putImageData한다. photoFor의 사진 보정은
          // getImageData(기존 내용 읽기)만 쓰므로, createImageData 호출만 "진짜 마스크" 신호로 쓴다(photo 캔버스도
          // putImageData는 호출하므로 그걸로는 구분이 안 된다).
          context.createImageData = (width, height) => { if (!maskCanvases.has(element)) maskBuildCount++; maskCanvases.add(element); return { data: new Uint8ClampedArray(width * height * 4), width, height }; };
        }
        return context;
      };
    }
    return element;
  };
  return { calls, get maskBuildCount() { return maskBuildCount; }, restore: () => { document.createElement = originalCreateElement; } };
}

const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';

test('(PR #310 P2 #3) 패럴랙스 마스크는 사진과 같은 cropTransform으로 얹힌다(비정사각·확대·이동 사진에서도 칠한 자리=움직이는 자리)', async () => {
  const dom = installMiniDom();
  clearCollectibleRenderCache();
  const recorder = recordCanvasDraws();
  try {
    const project = createProject({ name: '비정사각 패럴랙스 시험' });
    // 2:1 비정사각 사진 + 확대 2배 + 가로 이동. photoFor()는 선언된 치수 비율로 리사이즈하므로(가짜 디코드
    // 내용과 무관), 960×480(2:1) 캔버스가 나온다.
    project.photo = { originalDataUrl: tinyPng, width: 2000, height: 1000 };
    project.crop = { x: .6, y: 0, zoom: 2 };
    project.parallax = { strength: 80, strokes: [{ tool: 'fg', size: .1, points: [{ x: .5, y: .5 }] }] };
    const size = 512;
    const expected = cropTransform(project, size, size);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
    // angle 45도(0이 아님)라야 s≠0이라 패럴랙스 분기가 실제로 돈다.
    await renderCollectible(canvas, project, 'bronze', { angle: 45, textureSize: size });

    const maskDraws = recorder.calls.filter((call) => call.isMask && call.rest.length === 4);
    assert.ok(maskDraws.length > 0, '마스크를 (dx,dy,dw,dh) 4인자로 그린 호출이 있어야 한다(0,0 두 인자짜리 옛 호출이면 안 됨)');
    assert.ok(maskDraws.some((call) => Math.abs(call.rest[0] - expected.x) < 1e-6 && Math.abs(call.rest[1] - expected.y) < 1e-6
      && Math.abs(call.rest[2] - expected.width) < 1e-6 && Math.abs(call.rest[3] - expected.height) < 1e-6),
      `마스크가 사진과 같은 cropTransform(x=${expected.x},y=${expected.y},w=${expected.width},h=${expected.height})으로 얹혀야 한다. 실제: ${JSON.stringify(maskDraws.map((call) => call.rest))}`);
  } finally { recorder.restore(); dom.restore(); }
});

test('(PR #310 P2 #10) 패럴랙스 마스크는 획이 같으면 다시 안 만들고(캐시 적중), living 항목의 합성 마스크와 서로 밀어내지 않는다', async () => {
  const dom = installMiniDom();
  clearCollectibleRenderCache();
  const recorder = recordCanvasDraws();
  try {
    const project = createProject({ name: '마스크 캐시 시험' });
    project.photo = { originalDataUrl: tinyPng, width: 512, height: 512 };
    project.rewardGrades = { 1: 'bronze' };
    project.effects.push({ id: createId('effect'), type: 'hologram', target: 'surface', gradeIds: ['bronze'], strength: 45, color: project.baseColor });
    project.parallax = { strength: 60, strokes: [{ tool: 'fg', size: .1, points: [{ x: .5, y: .5 }] }] };
    // living 항목 두 개(서로 다른 획)를 같은 등급에 걸어, living 스프라이트의 매 칸(phase)마다 두 항목이
    // 번갈아 합성 마스크를 요청하게 한다 — 한 슬롯짜리 캐시라면 매번 서로를 밀어내 거의 매 호출이 다시 만든다.
    project.living.items.push(
      { id: createId('living'), kind: 'sway', target: 'region', gradeIds: ['bronze'], amplitude: 40, pivot: { x: .5, y: .5 }, strokes: [{ x: .3, y: .3 }] },
      { id: createId('living'), kind: 'bob', target: 'region', gradeIds: ['bronze'], amplitude: 40, pivot: { x: .7, y: .7 }, strokes: [{ x: .8, y: .8 }] },
    );
    // 홀로그램이 있어 각도 프레임 12칸을 굽는다 — 패럴랙스 마스크는 12번 다 같은 획이라 한 번만 만들어야 한다.
    await serializeDerived(project, { angleSide: 256 });
    // 패럴랙스 마스크 1개 + living 두 항목 각각 1개 = 최대 몇 개 수준이어야 한다(등급별로 한 번씩 다시 만들
    // 여지를 둬 넉넉히 6으로 잡는다). 고치기 전에는 한 슬롯을 공유해 매 living 칸(최대 24칸)마다 두 항목이
    // 서로 밀어내 수십 번 다시 만들었다.
    assert.ok(recorder.maskBuildCount <= 6, `마스크를 너무 많이 다시 만들었다(캐시가 안 맞음): ${recorder.maskBuildCount}개`);
  } finally { recorder.restore(); dom.restore(); }
});

test('(PR #310 P2 #4) 편집기 미리보기(renderCollectible)도 living 오버레이를 합성한다(재생 중이 아니어도)', async () => {
  const dom = installMiniDom();
  clearCollectibleRenderCache();
  const recorder = recordCanvasDraws();
  try {
    const project = createProject({ name: 'living 미리보기 시험' });
    project.photo = { originalDataUrl: tinyPng, width: 512, height: 512 };
    project.living.items.push({ id: createId('living'), kind: 'sway', target: 'region', gradeIds: ['bronze'], amplitude: 50, pivot: { x: .5, y: .5 }, strokes: [{ x: .5, y: .5 }] });
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
    // staticFrame:true(카드 전체 동작은 재생 중이 아님)이어도 reducedMotion이 아니면 living은 계속 그려야 한다.
    await renderCollectible(canvas, project, 'bronze', { textureSize: 512, livingTime: 500, reducedMotion: false, staticFrame: true });
    assert.ok(recorder.maskBuildCount > 0, 'living 오버레이용 획 마스크를 만들어야 한다(편집기 미리보기도 living을 보여줘야 함)');
  } finally { recorder.restore(); dom.restore(); }
});

test('(PR #310 P2 #5) living 스티커만 있고 재질·패럴랙스가 없는 등급도 각도 프레임을 만든다(유령 이중 노출 방지)', async () => {
  const dom = installMiniDom();
  clearCollectibleRenderCache();
  try {
    const project = createProject({ name: '스티커 전용 living 시험' });
    project.photo = { originalDataUrl: tinyPng, width: 512, height: 512 };
    project.rewardGrades = { 1: 'bronze' };
    const sticker = { id: createId('sticker'), kind: 'mascot', text: 'wave', x: .5, y: .3, size: 42, rotation: 0, color: '#fff', order: 0, align: 'center', layouts: {} };
    project.stickers.push(sticker);
    project.living.items.push({ id: createId('living'), kind: 'bob', target: sticker.id, gradeIds: ['bronze'], amplitude: 40, pivot: { x: .5, y: .5 } });
    const derived = await serializeDerived(project);
    assert.ok(derived.bronze.angleFrames, '재질·패럴랙스가 없어도 living 스티커가 있으면 각도 프레임을 만들어야 한다');
  } finally { dom.restore(); }
});

test('(PR #310 P2 #6) living 스티커 박스는 글자 길이·정렬·회전·sway 진폭까지 반영해 정지 상자보다 넓어진다', () => {
  const base = createProject();
  const longText = { id: 'long', kind: 'text', text: '아주 길게 쓴 안내 문구입니다', x: .5, y: .5, size: 42, rotation: 0, color: '#fff', order: 0, align: 'center', layouts: {} };
  const shortText = { id: 'short', kind: 'text', text: '짧음', x: .5, y: .5, size: 42, rotation: 0, color: '#fff', order: 0, align: 'center', layouts: {} };

  const longProject = { ...base, stickers: [longText], living: { periodMs: 2400, items: [{ id: 'i1', kind: 'sway', target: 'long', gradeIds: ['bronze'], amplitude: 100, pivot: { x: .5, y: .5 } }] } };
  const shortProject = { ...base, stickers: [shortText], living: { periodMs: 2400, items: [{ id: 'i1', kind: 'sway', target: 'short', gradeIds: ['bronze'], amplitude: 0, pivot: { x: .5, y: .5 } }] } };

  const longBox = livingBoundingBox(longProject, 'bronze');
  const shortBox = livingBoundingBox(shortProject, 'bronze');
  assert.ok(longBox.w > shortBox.w, `긴 글자+sway 진폭 상자(${longBox.w})가 짧은 글자 상자(${shortBox.w})보다 넓어야 한다`);

  // align이 x를 기준으로 한쪽으로만 뻗는 것도 반영한다: left 정렬은 가운데 정렬보다 상자 왼쪽 끝(x)이 더
  // 오른쪽에 있어야 한다(글자가 x에서 오른쪽으로만 뻗으므로 왼쪽으로 덜 나간다).
  const centerAligned = { ...base, stickers: [longText], living: { periodMs: 2400, items: [{ id: 'i1', kind: 'bob', target: 'long', gradeIds: ['bronze'], amplitude: 0, pivot: { x: .5, y: .5 } }] } };
  const leftAligned = { ...base, stickers: [{ ...longText, align: 'left' }], living: { periodMs: 2400, items: [{ id: 'i1', kind: 'bob', target: 'long', gradeIds: ['bronze'], amplitude: 0, pivot: { x: .5, y: .5 } }] } };
  const centerBox = livingBoundingBox(centerAligned, 'bronze');
  const leftBox = livingBoundingBox(leftAligned, 'bronze');
  assert.ok(leftBox.x > centerBox.x, `left 정렬 상자(x=${leftBox.x})가 가운데 정렬 상자(x=${centerBox.x})보다 오른쪽에서 시작해야 한다`);
});

test('(PR #310 P2 #7) living-only(animation: still) 등급도 자동재생하고(rAF 루프가 스스로 돈다), 재생을 멈춰도 living 루프는 다시 돈다', async () => {
  const dom = installMiniDom();
  clearCollectibleRenderCache();
  // mini-dom의 requestAnimationFrame은 콜백을 실제로 돌리지 않는 상수 스텁이라, 호출 "여부"를 스파이로 센다
  // (카드 전체 동작이 없어도 living이 있으면 rAF 루프가 자동으로 걸려야 한다는 것을 이렇게 확인한다).
  let rafCalls = 0;
  const originalRaf = dom.document.defaultView.requestAnimationFrame;
  dom.document.defaultView.requestAnimationFrame = (...args) => { rafCalls++; return originalRaf(...args); };
  try {
    const { openCollectible } = await import('../../apps/production-web/assets/collectible-viewer.mjs');
    const snapshot = {
      publicationId: 'pub-1', name: '시험', gradeName: '브론즈', shape: 'circle', theme: { name: '기본' },
      imageDataUrl: tinyPng, thumbnailDataUrl: tinyPng, angle: 0, greeting: '', story: { type: 'none' }, audio: null,
      animation: 'still', motions: [],
      living: { dataUrl: tinyPng, count: 8, columns: 4, cellWidth: 32, cellHeight: 32, periodMs: 1000, box: { x: .3, y: .3, w: .4, h: .4 } },
    };
    const item = { artwork: { publicationId: 'pub-1', gradeId: 'bronze', name: '시험', gradeName: '브론즈', thumbnailDataUrl: tinyPng, theme: { name: '기본' } }, entitlementId: 'e1', merchantName: '가게' };
    const opener = document.createElement('button');
    await openCollectible(document, item, async () => ({ ok: true, json: async () => ({ collectible: snapshot }) }), opener);
    await settle(3);
    assert.ok(rafCalls > 0, '카드 전체 동작(animation:\'still\', 모션 없음)이 없어도 living이 있으면 rAF 루프가 걸려야 한다(자동재생)');

    const dialog = document.body.children.find((node) => node.tagName?.toLowerCase() === 'dialog');
    const playButton = [...dialog.querySelectorAll('button')].find((node) => node.textContent === '동작 재생' || node.textContent === '동작 정지');
    assert.equal(playButton.textContent, '동작 재생', '모션이 없으면 "동작 재생" 상태를 유지한다(카드 전체 회전이 자동재생되는 건 아님)');

    // "동작 재생"을 눌렀다가 "동작 정지"를 눌러도(pause) living용 rAF 루프는 다시 걸려야 한다.
    rafCalls = 0;
    playButton.dispatchEvent({ type: 'click' }); await settle(1);
    playButton.dispatchEvent({ type: 'click' }); await settle(1); // 재생→정지
    assert.ok(rafCalls > 0, '카드 동작을 정지해도 living이 있으면 rAF 루프가 다시 걸려야 한다');
  } finally { dom.restore(); }
});

test('(PR #310 P2 #8) 뷰어에서 기울임 활성 중 동작 줄이기를 켜면 기울임 토글이 꺼지고 다시 못 켠다', async () => {
  const dom = installMiniDom();
  clearCollectibleRenderCache();
  class FakeOrientation { static requestPermission() { return Promise.resolve('granted'); } }
  dom.document.defaultView.DeviceOrientationEvent = FakeOrientation;
  try {
    const { openCollectible } = await import('../../apps/production-web/assets/collectible-viewer.mjs');
    const snapshot = {
      publicationId: 'pub-1', name: '시험', gradeName: '브론즈', shape: 'circle', theme: { name: '기본' },
      imageDataUrl: tinyPng, thumbnailDataUrl: tinyPng, angle: 0, greeting: '', story: { type: 'none' }, audio: null, animation: 'still', motions: [],
    };
    const item = { artwork: { publicationId: 'pub-1', gradeId: 'bronze', name: '시험', gradeName: '브론즈', thumbnailDataUrl: tinyPng, theme: { name: '기본' } }, entitlementId: 'e1', merchantName: '가게' };
    const opener = document.createElement('button');
    await openCollectible(document, item, async () => ({ ok: true, json: async () => ({ collectible: snapshot }) }), opener);
    await settle(3);
    const dialog = document.body.children.find((node) => node.tagName?.toLowerCase() === 'dialog');
    const tiltToggle = [...dialog.querySelectorAll('button')].find((node) => node.textContent.includes('기울여서 보기') || node.textContent.includes('기울임 끄기'));
    assert.ok(tiltToggle, '기울임 토글이 있어야 한다');
    tiltToggle.dispatchEvent({ type: 'click' });
    await settle(3);
    assert.equal(tiltToggle.textContent, '기울임 끄기', '토글을 누르면 기울임이 켜져야 한다');

    const reduceCheckbox = [...dialog.querySelectorAll('input')].find((node) => node.parentElement?.textContent?.includes('움직임 줄이기'));
    assert.ok(reduceCheckbox, '동작 줄이기 체크박스를 찾아야 한다');
    reduceCheckbox.checked = true; reduceCheckbox.dispatchEvent({ type: 'change' });
    await settle(3);
    assert.equal(tiltToggle.textContent, '기울여서 보기', '동작 줄이기를 켜면 기울임도 꺼져야 한다');
    assert.equal(tiltToggle.disabled, true, '동작 줄이기 중에는 토글을 다시 못 누르게 막아야 한다');
  } finally { dom.restore(); }
});

test('(PR #310 P2 #9) iOS 권한 창이 열린 사이 뷰어가 닫히면, 뒤늦게 허용이 와도 죽은 세션에 리스너를 달지 않는다', async () => {
  const dom = installMiniDom();
  clearCollectibleRenderCache();
  let resolvePermission;
  class FakeOrientation { static requestPermission() { return new Promise((resolve) => { resolvePermission = resolve; }); } }
  dom.document.defaultView.DeviceOrientationEvent = FakeOrientation;
  const addedListeners = [];
  const originalAdd = dom.document.defaultView.addEventListener.bind(dom.document.defaultView);
  dom.document.defaultView.addEventListener = (type, handler) => { if (type === 'deviceorientation') addedListeners.push(handler); return originalAdd(type, handler); };
  try {
    const { openCollectible } = await import('../../apps/production-web/assets/collectible-viewer.mjs');
    const snapshot = {
      publicationId: 'pub-1', name: '시험', gradeName: '브론즈', shape: 'circle', theme: { name: '기본' },
      imageDataUrl: tinyPng, thumbnailDataUrl: tinyPng, angle: 0, greeting: '', story: { type: 'none' }, audio: null, animation: 'still', motions: [],
    };
    const item = { artwork: { publicationId: 'pub-1', gradeId: 'bronze', name: '시험', gradeName: '브론즈', thumbnailDataUrl: tinyPng, theme: { name: '기본' } }, entitlementId: 'e1', merchantName: '가게' };
    const opener = document.createElement('button');
    await openCollectible(document, item, async () => ({ ok: true, json: async () => ({ collectible: snapshot }) }), opener);
    await settle(3);
    const dialog = document.body.children.find((node) => node.tagName?.toLowerCase() === 'dialog');
    const tiltToggle = [...dialog.querySelectorAll('button')].find((node) => node.textContent.includes('기울여서 보기'));
    tiltToggle.dispatchEvent({ type: 'click' }); // requestPermission()을 부르고 아직 응답을 안 기다린다.
    await settle(1);
    const close = [...dialog.querySelectorAll('button')].find((node) => node.textContent === '도감으로 돌아가기');
    close.dispatchEvent({ type: 'click' }); // 응답 전에 닫는다.
    await settle(1);
    resolvePermission('granted'); // 뒤늦게 허용이 온다.
    await settle(3);
    assert.equal(addedListeners.length, 0, '닫힌 뒤에 뒤늦게 허용이 와도 deviceorientation 리스너를 새로 달면 안 된다');
  } finally { dom.restore(); }
});
