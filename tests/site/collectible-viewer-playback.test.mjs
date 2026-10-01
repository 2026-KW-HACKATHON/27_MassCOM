import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installMiniDom, settle } from '../fixtures/mini-dom.mjs';
import { openCollectible } from '../../apps/production-web/assets/collectible-viewer.mjs';
import { particleAt } from '../../apps/production-web/assets/collectible-model.mjs';

// Issue #284 WP2: 뷰어는 loop 모션을 열자마자 자동재생하고, once 모션은 "획득 장면 다시 보기" 버튼으로만 다시 볼 수
// 있으며, 움직임 줄이기면 자동재생하지 않는다. requestAnimationFrame은 mini-dom에서 실제로 콜백을 돌리지 않으므로
// (편집기 시험과 같은 관례), 여기서는 연 직후의 DOM 상태(재생 버튼 문구·다시 보기 버튼 존재)로 확인한다.
const tinyPng = 'data:image/png;base64,iVBORw0KGgo=';
const baseSnapshot = {
  publicationId: 'pub-1', name: '월계 수집품', gradeName: '브론즈', shape: 'circle', theme: { name: '기본' },
  imageDataUrl: tinyPng, thumbnailDataUrl: tinyPng, angle: 0, greeting: '', story: { type: 'none' }, audio: null,
};
const item = (overrides = {}) => ({
  artwork: { publicationId: 'pub-1', gradeId: 'bronze', name: '월계 수집품', gradeName: '브론즈', thumbnailDataUrl: tinyPng, theme: { name: '기본' } },
  entitlementId: 'owned-1', merchantName: '월계 식당', ...overrides,
});
const fetcherFor = (snapshot) => async () => ({ ok: true, json: async () => ({ collectible: snapshot }) });

function findByText(node, text) {
  if (!node) return null;
  if (node.textContent === text) return node;
  for (const child of node.children || []) { const found = findByText(child, text); if (found) return found; }
  return null;
}

async function open(dom, snapshot) {
  const opener = dom.document.createElement('button');
  await openCollectible(dom.document, item(), fetcherFor(snapshot), opener);
  await settle(3);
  return dom.document.body.children.find((node) => node.tagName?.toLowerCase() === 'dialog');
}

test('loop 모션이 있으면 열자마자 자동재생하고(버튼이 "동작 정지") 수동으로도 쓸 수 있다', async () => {
  const dom = installMiniDom();
  try {
    const dialog = await open(dom, { ...baseSnapshot, animation: 'rotate', motions: [{ type: 'rotate', playback: 'loop' }] });
    assert.ok(findByText(dialog, '동작 정지'), 'loop 모션은 열면 바로 재생 중이어야 한다');
    assert.equal(findByText(dialog, '동작 재생'), null);
  } finally { dom.restore(); }
});

test('움직임 줄이기가 켜져 있으면 loop 모션이 있어도 자동재생하지 않는다', async () => {
  const dom = installMiniDom();
  dom.document.defaultView.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  try {
    const dialog = await open(dom, { ...baseSnapshot, animation: 'rotate', motions: [{ type: 'rotate', playback: 'loop' }] });
    assert.ok(findByText(dialog, '동작 재생'), '움직임 줄이기면 정지 화면을 유지한다');
    assert.equal(findByText(dialog, '동작 정지'), null);
  } finally { dom.restore(); }
});

test('once 모션이 있으면 "획득 장면 다시 보기" 버튼이 생기고, 없으면 생기지 않는다', async () => {
  const dom = installMiniDom();
  try {
    const withOnce = await open(dom, { ...baseSnapshot, animation: 'still', motions: [{ type: 'confetti', playback: 'once', particle: 'snow' }] });
    assert.ok(findByText(withOnce, '획득 장면 다시 보기'), 'once 모션이 있으면 다시 보기 버튼이 있어야 한다');

    const dialog2 = await open(dom, { ...baseSnapshot, animation: 'still', motions: [] });
    assert.equal(findByText(dialog2, '획득 장면 다시 보기'), null);
  } finally { dom.restore(); }
});

test('애니메이션이 still이고 loop 모션이 없으면 자동재생하지 않는다(수동 재생 버튼은 그대로 쓸 수 있다)', async () => {
  const dom = installMiniDom();
  try {
    const dialog = await open(dom, { ...baseSnapshot, animation: 'still', motions: [] });
    assert.ok(findByText(dialog, '동작 재생'));
    assert.equal(findByText(dialog, '동작 정지'), null);
  } finally { dom.restore(); }
});

// PR #293 리뷰(Codex gpt-6.1-sol P2): loop 모션의 particle(snow/petals/sparkles)을 안 넘기면 drawVolume이 기본값
// 'confetti'로 그린다. confetti 계열 particle마다 색이 다르므로(collectible-model.mjs PARTICLE_COLORS), 실제로
// 그려지는 마지막 입자 색(캔버스 fillStyle)으로 particle이 그대로 전달됐는지 확인한다.
test('loop confetti 모션은 저장된 particle로 그린다(안 넘기면 기본값 confetti 색이 된다)', async () => {
  const dom = installMiniDom();
  try {
    const dialog = await open(dom, { ...baseSnapshot, animation: 'confetti', motions: [{ type: 'confetti', playback: 'loop', particle: 'petals' }] });
    const canvas = dialog.querySelector('canvas');
    assert.equal(canvas._context.fillStyle, particleAt('petals', 19, 0).color, 'particle이 전달됐다면 petals 색이어야 한다');
    assert.notEqual(canvas._context.fillStyle, particleAt('confetti', 19, 0).color, '기본값 confetti로 되돌아가면 안 된다');
  } finally { dom.restore(); }
});

// PR #293 리뷰(Codex gpt-6.1-sol P2 / Claude sonnet 🟡): find()는 once 모션을 하나만 찾아, 등급에 once 모션이
// 둘이면 두 번째는 영영 재생되지 않았다. "획득 장면 다시 보기"는 Android처럼 once 모션을 전부 순서대로 보여줘야
// 한다. performance.now를 직접 제어해 첫 once 모션(confetti, ONCE_MS.confetti=2000ms) 지속 시간을 넘긴 뒤에도
// 두 번째 once 모션이 실제로 그려지는지 캔버스 fillStyle로 확인한다.
test('"획득 장면 다시 보기"는 once 모션이 여러 개면 전부 순서대로 재생한다(두 번째 once 모션도 재생돼야 한다)', async () => {
  const dom = installMiniDom();
  let now = 1000;
  dom.document.defaultView.performance = { now: () => now };
  try {
    const opener = dom.document.createElement('button');
    const snapshot = {
      ...baseSnapshot, animation: 'still',
      motions: [
        { type: 'confetti', playback: 'once', particle: 'snow' },
        { type: 'confetti', playback: 'once', particle: 'sparkles' },
      ],
    };
    await openCollectible(dom.document, item(), fetcherFor(snapshot), opener);
    await settle(4);
    const dialog = dom.document.body.children.find((node) => node.tagName?.toLowerCase() === 'dialog');
    const canvas = dialog.querySelector('canvas');
    [...dialog.querySelectorAll('button')].find(node => node.textContent === '획득 장면 다시 보기').dispatchEvent({ type: 'click' });
    await settle(4);
    assert.equal(canvas._context.fillStyle, particleAt('snow', 19, 0).color, '첫 once 모션은 snow 파티클로 그려야 한다');

    // 첫 once 모션(ONCE_MS.confetti=2000ms) 지속 시간을 넘긴다. 회전 슬라이더의 change는 once 재생을 멈추지 않고
    // 그 시점의 draw()만 다시 부른다(rotation.addEventListener('change', ...)).
    now += 2200;
    dialog.querySelector('input[aria-label="수집품 회전 각도"]').dispatchEvent({ type: 'change' });
    await settle(4);
    assert.equal(canvas._context.fillStyle, particleAt('sparkles', 19, 0).color, '두 번째 once 모션(sparkles)도 이어서 재생해야 한다(버그였다면 snow 색에서 멈춘다)');
  } finally { dom.restore(); }
});
