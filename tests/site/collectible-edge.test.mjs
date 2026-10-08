import test from 'node:test';
import assert from 'node:assert/strict';
import { collectibleEdgeGrooves, collectibleEdgeContrast } from '../../apps/production-web/assets/collectible-edge.mjs';
import { installMiniDom } from '../fixtures/mini-dom.mjs';
import { renderPublishedCollectible } from '../../apps/production-web/assets/collectible-renderer.mjs';

const groovesAt = (shape, size, thickness, angle) => collectibleEdgeGrooves(shape, size, Math.max(.025, Math.abs(Math.cos(angle * Math.PI / 180))), Math.sin(angle * Math.PI / 180) * thickness * size / 512);

for (const shape of ['circle', 'stamp', 'serrated']) {
  test(`${shape}: 고정 둘레 홈은 얇고 두꺼운 코인에서 같은 위치를 유지한다`, () => {
    const thin = groovesAt(shape, 256, 4, 60), thick = groovesAt(shape, 256, 48, 60);
    assert.ok(thin.length > 12);
    assert.deepEqual(thin.map(({ slot, x, y }) => ({ slot, x, y })), thick.map(({ slot, x, y }) => ({ slot, x, y })));
    assert.ok(thick.every(groove => groove.backX > groove.frontX));
    assert.ok(groovesAt(shape, 256, 48, -60).every(groove => groove.backX < groove.frontX));
    assert.equal(groovesAt(shape, 256, 48, 0).length, 0);
    assert.equal(groovesAt(shape, 256, 48, 180).length, 0);
  });

  test(`${shape}: 작은 화면·수직 옆면·회전 뒷면의 홈은 2px 이상 떨어진다`, () => {
    for (const size of [96, 160, 256, 512]) for (const thickness of [1, 4, 8, 48]) for (const angle of [-150, -90, -60, 30, 60, 90, 150]) {
      const grooves = groovesAt(shape, size, thickness, angle);
      assert.ok(grooves.length <= 144);
      for (let i = 0; i < grooves.length; i++) {
        const point = grooves[i];
        assert.ok([point.x, point.y, point.frontX, point.backX].every(Number.isFinite));
        assert.ok(Math.abs(point.y) <= size * .46 + 1e-8);
        for (const next of grooves.slice(i + 1)) assert.ok(Math.hypot(point.x - next.x, point.y - next.y) >= 2 - 1e-8);
      }
    }
  });
}

test('1px 미만 옆면은 홈을 생략하거나 낮은 대비로 표시한다', () => {
  assert.equal(collectibleEdgeGrooves('circle', 160, .5, .35).length, 0);
  assert.ok(collectibleEdgeContrast(.5).opacity < collectibleEdgeContrast(2).opacity);
  assert.ok(Math.abs(collectibleEdgeContrast(48).opacity - .41) < 1e-8);
  assert.deepEqual(collectibleEdgeContrast(-2), collectibleEdgeContrast(2));
});

test('유리 우표·톱니의 게시본은 홈 레이어에서 정면을 지운 뒤 합성한다', async () => {
  const dom = installMiniDom(), canvases = [];
  const createElement = dom.document.createElement.bind(dom.document);
  dom.document.createElement = tag => {
    const element = createElement(tag);
    if (tag !== 'canvas') return element;
    const record = { element, operations: [] }; canvases.push(record);
    let context;
    element.getContext = () => context ??= new Proxy({ canvas: element }, {
      get(target, key) {
        if (key in target) return target[key];
        if (key === 'createLinearGradient') return () => ({ addColorStop() {} });
        return (...args) => record.operations.push({ method: key, composite: target.globalCompositeOperation, strokeStyle: target.strokeStyle, args });
      },
      set(target, key, value) { target[key] = value; return true; },
    });
    return element;
  };
  try {
    for (const shape of ['stamp', 'serrated']) for (const angle of [-70, 70, 110]) {
      canvases.length = 0;
      const canvas = dom.document.createElement('canvas'); canvas.width = canvas.height = 400;
      await renderPublishedCollectible(canvas, { shape, gradeId: 'prism', thickness: 48, imageDataUrl: 'data:image/png;base64,glass', backImageDataUrl: 'data:image/png;base64,back', effects: [{ type: 'glass', target: 'surface', strength: 100 }] }, { angle });
      const reedLayer = canvases.find(record => record.operations.some(operation => operation.method === 'stroke' && typeof operation.strokeStyle === 'string' && operation.strokeStyle.startsWith('rgba(10,17,32,')));
      assert.ok(reedLayer, '옆면 홈 레이어가 실제 게시 렌더 경로에 있다');
      const fill = reedLayer.operations.filter(operation => operation.method === 'fill').at(-1);
      assert.equal(fill.composite, 'destination-out', '반투명 정면에 의존하지 않고 홈 레이어에서 정면을 명시적으로 지운다');
      const erasedOutline = reedLayer.operations.slice(reedLayer.operations.findLastIndex(operation => operation.method === 'beginPath'));
      assert.ok(erasedOutline.filter(operation => operation.method === 'lineTo').length > 40);
      assert.ok(canvases[0].operations.some(operation => operation.method === 'drawImage' && operation.args[0] === reedLayer.element), '차감한 레이어가 최종 canvas에 합성된다');
    }
  } finally { dom.restore(); }
});
