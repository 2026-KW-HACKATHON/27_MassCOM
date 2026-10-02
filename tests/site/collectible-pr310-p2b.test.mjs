import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { installMiniDom, settle } from '../fixtures/mini-dom.mjs';
import { createProject, createId, cloneProject, cropTransform, livingBoundingBox } from '../../apps/production-web/assets/collectible-model.mjs';
import { renderCollectible, clearCollectibleRenderCache } from '../../apps/production-web/assets/collectible-renderer.mjs';
import { mountCollectibleEditor } from '../../apps/production-web/assets/collectible-editor.mjs';
import { createFakeApi } from '../fixtures/collectible-fake-api.mjs';

// PR #310 리뷰 2차(코덱스 gpt-6.1-sol 재확인): 1차에서 고친 10건 위에 또 나온 P1 1건 + P2 5건을 고친다.
// 1차와 같은 기법을 그대로 쓴다: 편집기 흐름은 mini-dom driver, 실제 서버 검증은 run-collectible-rules.mjs
// 자식 프로세스, canvas 호출 계측은 이 파일 전용 recordCanvasDraws.

const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
// 서버가 실제 PNG 서명·IHDR 치수를 보므로(validateCollectibleMedia) 실제 서버 검증에는 같은 진짜 1×1 PNG를 쓴다.
const realTinyPng = tinyPng;

function runRealServerValidation(project, publish = false) {
  const out = execFileSync('node', ['--experimental-transform-types', new URL('../fixtures/run-collectible-rules.mjs', import.meta.url).pathname], {
    input: JSON.stringify({ project, publish }), encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'],
  });
  return JSON.parse(out);
}

function driver(container) {
  return {
    container,
    get notice() { return container.querySelector('[data-view="notice"]').textContent; },
    control: (name) => container.querySelector(`[data-control="${name}"]`),
    action: (name) => container.querySelector(`[data-action="${name}"]`),
    async click(name, data) {
      const nodes = [...container.querySelectorAll(`[data-action="${name}"]`)];
      const node = data ? nodes.find((item) => item.dataset.id === data) : nodes[0];
      node.dispatchEvent({ type: 'click' }); await settle();
    },
    async change(name, value) { const node = this.control(name); node.value = value; node.dispatchEvent({ type: 'change' }); await settle(); },
    async upload(file) { const node = this.control('photo'); node.files = [file]; node.dispatchEvent({ type: 'change' }); await settle(); },
  };
}
async function mountEditor(api) {
  const container = document.createElement('div');
  const cleanup = mountCollectibleEditor(container, {
    merchantId: 'm1', merchantName: '월계 식당', request: api.request, loadCampaigns: api.listCampaigns, onNotice() {},
  });
  await settle();
  return { ui: driver(container), cleanup };
}

// --- P1: blink는 추가할 때만 포즈를 확인했다. 연결된 뒤 포즈를 바꿔 MASCOT_BLINK 밖으로 나가면 서버가 거절한다 ---
test('(PR #310 리뷰 2차 P1) 마스코트 포즈를 blink와 안 맞게 바꾸면 그 blink living 항목을 지우고, 남은 프로젝트는 실제 서버 검증을 통과한다', async () => {
  const dom = installMiniDom();
  clearCollectibleRenderCache();
  try {
    const api = createFakeApi();
    const { ui, cleanup } = await mountEditor(api);
    try {
      await ui.upload({ type: 'image/png', size: 1000, name: 'p.png', dataUrl: realTinyPng });
      await ui.change('sticker-kind', 'mascot');
      ui.control('sticker-new-pose').value = 'wave';
      await ui.click('sticker-add');
      const stickerId = ui.control('sticker-list').value;
      assert.ok(stickerId, '마스코트 스티커가 만들어져야 한다');

      await ui.change('living-kind', 'blink');
      await ui.change('living-target', stickerId);
      await ui.click('living-add');
      assert.equal(ui.container.querySelectorAll('.ce-living-item').length, 1, 'wave는 blink와 맞아 바로 추가돼야 한다');

      // 포즈를 blink와 안 맞는 'sleep'으로 바꾼다(MASCOT_BLINK에는 sleep·town-map·sky-town-header가 없다).
      const poseField = ui.container.querySelector('[data-sticker="text"][data-role="pose"]');
      assert.equal(poseField.value, 'wave');
      poseField.value = 'sleep'; poseField.dispatchEvent({ type: 'change' }); await settle();
      assert.equal(ui.container.querySelectorAll('.ce-living-item').length, 0, '포즈가 안 맞게 되면 그 blink living 항목을 지워야 한다');
      assert.match(ui.notice, /블링크|blink/, '지운 이유를 알려야 한다');

      await ui.click('draft');
      const saved = api.calls.filter((call) => call.method === 'POST').at(-1).body.project;
      assert.equal(saved.living.items.length, 0, '서버로 보내는 프로젝트에도 blink 항목이 남아 있으면 안 된다');
      // mini-dom의 Image 스텁은 실제 바이트와 무관하게 항상 2×2를 보고한다(fixtures 한계). 이 시험의 관심사
      // (포즈 변경→blink 정리)와 무관한 치수 불일치로 거절되지 않게 실제 1×1 PNG의 진짜 치수로만 맞춰 둔다.
      saved.photo.width = 1; saved.photo.height = 1;
      const result = runRealServerValidation(saved, false);
      assert.equal(result.ok, true, `포즈를 바꾼 뒤 저장한 프로젝트는 실제 서버 검증을 통과해야 한다: ${JSON.stringify(result)}`);
    } finally { cleanup(); }
  } finally { dom.restore(); }
});

// --- P2 #2(모델 livingBoundingBox): region 점에도 cropTransform·붓 반경·sway 동작 범위를 반영해야 한다 ---
test('(PR #310 리뷰 2차 P2 #2) living 영역 상자는 사진 crop 변환·붓 반경·sway 동작 범위를 출력 좌표로 반영한다', () => {
  // 2:1 비정사각 사진, 확대 없음, 이동 없음 → fit-cover로 가로가 잘린다(사진 x=0.75는 출력 x=1.0 쪽 끝).
  const wide = createProject();
  wide.photo = { originalDataUrl: tinyPng, width: 2000, height: 1000 };
  wide.crop = { x: 0, y: 0, zoom: 1 };
  wide.living = { periodMs: 2400, items: [{ id: 'i1', kind: 'bob', target: 'region', gradeIds: ['bronze'], amplitude: 0, pivot: { x: .5, y: .5 }, strokes: [{ x: .75, y: .5 }] }] };
  const box = livingBoundingBox(wide, 'bronze');
  assert.ok(box, '점이 있으면 상자가 있어야 한다');
  // 고치기 전에는 점(x=.75)을 그대로 출력 좌표로 썼다(상자 x ≈ .75-.1 = .65). cropTransform을 타면 사진의
  // x=.75는 출력 x=1.0 쪽으로 옮겨가(비정사각+fit-cover) 상자가 그보다 훨씬 오른쪽에서 시작해야 한다.
  assert.ok(box.x > 0.78, `region 점이 cropTransform을 안 타면 상자가 너무 왼쪽에 남는다. 실제 x=${box.x}`);

  // 정사각 사진 + 점이 pivot과 정확히 같은 자리 → 붓 반경만큼만 상자가 생긴다(패딩 .1 제외). 붓 반경을 안 넣으면
  // 상자 너비가 패딩 두 배(.2)뿐이어야 하는데, 반경(.05)을 더하면 .3에 가까워야 한다.
  const square = createProject();
  square.photo = { originalDataUrl: tinyPng, width: 1000, height: 1000 };
  square.crop = { x: 0, y: 0, zoom: 1 };
  square.living = { periodMs: 2400, items: [{ id: 'i1', kind: 'bob', target: 'region', gradeIds: ['bronze'], amplitude: 0, pivot: { x: .5, y: .5 }, strokes: [{ x: .5, y: .5 }] }] };
  const centered = livingBoundingBox(square, 'bronze');
  assert.ok(centered.w > 0.25, `붓 반경을 포함해야 패딩만보다 상자가 넓다. 실제 w=${centered.w}`);

  // sway 진폭을 크게 주면(pivot에서 먼 점일수록 회전 범위가 커짐) 상자가 더 넓어져야 한다.
  const swaying = createProject();
  swaying.photo = { originalDataUrl: tinyPng, width: 1000, height: 1000 };
  swaying.crop = { x: 0, y: 0, zoom: 1 };
  swaying.living = { periodMs: 2400, items: [{ id: 'i1', kind: 'sway', target: 'region', gradeIds: ['bronze'], amplitude: 100, pivot: { x: .5, y: .5 }, strokes: [{ x: .9, y: .5 }] }] };
  const still = createProject();
  still.photo = swaying.photo; still.crop = swaying.crop;
  still.living = { periodMs: 2400, items: [{ id: 'i1', kind: 'sway', target: 'region', gradeIds: ['bronze'], amplitude: 0, pivot: { x: .5, y: .5 }, strokes: [{ x: .9, y: .5 }] }] };
  const swayBox = livingBoundingBox(swaying, 'bronze'), stillBox = livingBoundingBox(still, 'bronze');
  assert.ok(swayBox.w > stillBox.w, `sway 동작 범위를 반영해야 진폭 100이 진폭 0보다 넓다. sway=${swayBox.w} still=${stillBox.w}`);
});

// --- P2 #3(렌더러 frontFor): 편집기 미리보기가 living 스티커를 정지 포즈로 또 그려 이중으로 보이면 안 된다 ---
function recordCanvasDraws() {
  const calls = [];
  const originalCreateElement = document.createElement.bind(document);
  document.createElement = (tag) => {
    const element = originalCreateElement(tag);
    if (tag === 'canvas') {
      const originalGetContext = element.getContext.bind(element);
      let patched = false;
      element.getContext = (type) => {
        const context = originalGetContext(type);
        if (!patched) { patched = true; context.drawImage = (...args) => { calls.push(args); }; }
        return context;
      };
    }
    return element;
  };
  return { calls, restore: () => { document.createElement = originalCreateElement; } };
}
test('(PR #310 리뷰 2차 P2 #3) 편집기 미리보기는 living 스티커를 정지 포즈로 또 그리지 않는다(이중 노출 방지)', async () => {
  const dom = installMiniDom();
  clearCollectibleRenderCache();
  const recorder = recordCanvasDraws();
  try {
    const sticker = { id: createId('sticker'), kind: 'mascot', text: 'wave', x: .5, y: .5, size: 42, rotation: 0, color: '#fff', order: 0, align: 'center', layouts: {} };
    const withoutLiving = createProject({ name: '정지 스티커만' });
    withoutLiving.photo = { originalDataUrl: tinyPng, width: 512, height: 512 };
    withoutLiving.stickers.push(sticker);

    const beforeB = recorder.calls.length;
    const canvasB = document.createElement('canvas'); canvasB.width = canvasB.height = 256;
    await renderCollectible(canvasB, withoutLiving, 'bronze', { textureSize: 256, staticFrame: true });
    const countWithoutLiving = recorder.calls.length - beforeB;

    const withLiving = cloneProject(withoutLiving);
    withLiving.living.items.push({ id: createId('living'), kind: 'bob', target: sticker.id, gradeIds: ['bronze'], amplitude: 40, pivot: { x: .5, y: .5 } });
    const beforeA = recorder.calls.length;
    const canvasA = document.createElement('canvas'); canvasA.width = canvasA.height = 256;
    await renderCollectible(canvasA, withLiving, 'bronze', { textureSize: 256, staticFrame: true, livingTime: 0, reducedMotion: false });
    const countWithLiving = recorder.calls.length - beforeA;

    // 측정으로 고정한 값(이 시나리오에서): frontFor가 그 스티커를 빼면(고친 뒤) living 오버레이 합성이
    // 늘리는 draw 수와 frontFor에서 뺀 draw 수가 상쇄돼 차이가 0이다. 안 빼고 정지 포즈로 또 그리면(고치기
    // 전, 이중 노출 버그) 그 스티커 레이어의 draw 비용만큼(2) 더 늘어 차이가 2가 된다.
    assert.equal(countWithLiving - countWithoutLiving, 0, `living 스티커가 있으면 frontFor는 그 스티커를 빼야 한다(안 빼면 정지 포즈를 또 그려 이 차이가 2가 된다). 실제 차이: ${countWithLiving - countWithoutLiving}`);
  } finally { recorder.restore(); dom.restore(); }
});

// --- P2 #4(편집기): living 항목의 등급 체크박스에 change 처리기가 없어 체크해도 저장이 안 됐다 ---
test('(PR #310 리뷰 2차 P2 #4) living 항목의 등급 체크박스를 누르면 project.living.items의 gradeIds가 실제로 바뀐다', async () => {
  const dom = installMiniDom();
  clearCollectibleRenderCache();
  try {
    const api = createFakeApi();
    const { ui, cleanup } = await mountEditor(api);
    try {
      await ui.upload({ type: 'image/png', size: 1000, name: 'p.png', dataUrl: 'data:image/png;base64,AAAA' });
      await ui.click('living-add');
      const id = ui.action('living-paint').dataset.id;
      await ui.click('living-paint', id); // 붓 대상을 이 living 영역으로(점을 찍어 빈 영역 저장 차단을 피한다).
      const crop = ui.container.querySelector('[data-view="crop"]');
      crop.dispatchEvent({ type: 'pointerdown', pointerId: 1, clientX: 256, clientY: 256 }); await settle();
      crop.dispatchEvent({ type: 'pointerup', pointerId: 1 }); await settle();

      const checkbox = ui.container.querySelector(`input[data-living-grade="${id}"][data-grade="bronze"]`);
      assert.ok(checkbox, '브론즈 등급 체크박스를 찾아야 한다');
      assert.equal(checkbox.checked, false, '새 living 항목은 처음엔 아무 등급도 안 걸려 있다');
      checkbox.checked = true; checkbox.dispatchEvent({ type: 'change' }); await settle();

      await ui.click('draft');
      const saved = api.calls.filter((call) => call.method === 'POST').at(-1).body.project;
      const item = saved.living.items.find((candidate) => candidate.id === id);
      assert.ok(item?.gradeIds.includes('bronze'), `체크하면 저장되는 프로젝트의 gradeIds에 브론즈가 들어가야 한다. 실제: ${JSON.stringify(item)}`);
    } finally { cleanup(); }
  } finally { dom.restore(); }
});

// --- P2 #5(편집기): 스티커를 추가해도 living 대상 목록이 그 자리에서 안 바뀌어 바로 고를 수 없었다 ---
test('(PR #310 리뷰 2차 P2 #5) 스티커를 추가하면 바로 living 대상 목록에 나타난다', async () => {
  const dom = installMiniDom();
  clearCollectibleRenderCache();
  try {
    const api = createFakeApi();
    const { ui, cleanup } = await mountEditor(api);
    try {
      await ui.upload({ type: 'image/png', size: 1000, name: 'p.png', dataUrl: 'data:image/png;base64,AAAA' });
      await ui.change('sticker-kind', 'text');
      ui.control('sticker-new').value = '안녕';
      await ui.click('sticker-add');
      const options = ui.control('living-target').options.map((option) => ({ value: option.value, text: option.textContent }));
      assert.ok(options.some((option) => option.value !== 'region' && option.text.includes('안녕')),
        `추가한 스티커가 바로 living 대상 목록에 보여야 한다. 실제 목록: ${JSON.stringify(options)}`);
    } finally { cleanup(); }
  } finally { dom.restore(); }
});

// --- P2 #6(뷰어): 동작 줄이기를 끄거나 탭이 다시 보여도 living 재생이 안 돌아왔고, 중복 루프를 걸면 안 된다 ---
test('(PR #310 리뷰 2차 P2 #6) 동작 줄이기를 끄거나 숨긴 탭이 다시 보이면 living 재생이 다시 돌고, 중복 루프는 안 생긴다', async () => {
  const dom = installMiniDom();
  clearCollectibleRenderCache();
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
    assert.equal(rafCalls, 1, '처음 열면 living rAF 루프가 정확히 한 번 걸려야 한다');

    const dialog = document.body.children.find((node) => node.tagName?.toLowerCase() === 'dialog');
    // 이미 living 루프가 도는 중에 "동작 재생"을 눌러도(ensureLoop를 다시 불러도) 중복으로 rAF를 걸면 안 된다.
    const playButton = [...dialog.querySelectorAll('button')].find((node) => node.textContent === '동작 재생' || node.textContent === '동작 정지');
    playButton.dispatchEvent({ type: 'click' }); await settle(2);
    assert.equal(rafCalls, 1, '이미 living 루프가 도는 중에 재생을 눌러도 중복 rAF를 걸면 안 된다(looping 깃발)');

    const reduceCheckbox = [...dialog.querySelectorAll('input')].find((node) => node.parentElement?.textContent?.includes('움직임 줄이기'));
    assert.ok(reduceCheckbox, '동작 줄이기 체크박스를 찾아야 한다');

    reduceCheckbox.checked = true; reduceCheckbox.dispatchEvent({ type: 'change' }); await settle(2);
    assert.equal(rafCalls, 1, '동작 줄이기를 켜면 루프를 멈추기만 하고 새로 걸면 안 된다');

    reduceCheckbox.checked = false; reduceCheckbox.dispatchEvent({ type: 'change' }); await settle(2);
    assert.equal(rafCalls, 2, '동작 줄이기를 끄면 living 루프가 정확히 한 번만 다시 걸려야 한다(중복 없음)');

    document.hidden = true;
    for (const handler of document.listeners.get('visibilitychange') ?? []) handler({ type: 'visibilitychange' });
    await settle(2);
    assert.equal(rafCalls, 2, '탭이 숨겨지면 멈추기만 하고 새로 걸면 안 된다');

    document.hidden = false;
    for (const handler of document.listeners.get('visibilitychange') ?? []) handler({ type: 'visibilitychange' });
    await settle(2);
    assert.equal(rafCalls, 3, '탭이 다시 보이면 living 루프가 정확히 한 번만 다시 걸려야 한다(중복 없음)');
  } finally { dom.restore(); }
});
