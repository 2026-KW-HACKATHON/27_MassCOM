import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installMiniDom } from '../fixtures/mini-dom.mjs';
import { createProject } from '../../apps/production-web/assets/collectible-model.mjs';
import { renderCollectible, renderPublishedCollectible } from '../../apps/production-web/assets/collectible-renderer.mjs';

test('저장본과 편집본은 같은 회전 속도·정지·한 번 재생 각도를 사용한다', async () => {
  const dom = installMiniDom();
  try {
    const project = createProject(); project.rotationSpeed = 2;
    project.motion = [{ id: 'rotate', type: 'rotate', gradeIds: ['prism'], playback: 'loop' }];
    const snapshot = { shape: 'circle', gradeId: 'prism', angle: 0, thickness: 8, rotationSpeed: 2, animation: 'rotate', imageDataUrl: 'data:image/png;base64,AAAA' };
    for (const options of [{ time: 2250 }, { time: 2250, staticFrame: true }, { time: 9000, playback: 'once' }, { angle: 45, time: 9000, rotationTime: 0 }]) {
      const scales = [];
      for (const render of [canvas => renderCollectible(canvas, project, 'prism', options), canvas => renderPublishedCollectible(canvas, snapshot, options)]) {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
        const values = []; canvas.getContext('2d').scale = x => values.push(x);
        await render(canvas); scales.push(values.at(-1));
      }
      assert.equal(scales[0], scales[1], '실제 캔버스 가로 투영은 편집본·저장본에서 일치한다');
      const elapsed = options.staticFrame ? 0 : (options.rotationTime ?? Math.min(options.time, options.playback === 'once' ? 3999 : Infinity));
      const angle = (options.angle ?? 0) + elapsed / 75 * 2;
      assert.ok(Math.abs(scales[0] - Math.max(.025, Math.abs(Math.cos(angle * Math.PI / 180)))) < 1e-12);
    }
  } finally { dom.restore(); }
});
