import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installMiniDom, settle } from '../fixtures/mini-dom.mjs';
import { openCollectible } from '../../apps/production-web/assets/collectible-viewer.mjs';

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
