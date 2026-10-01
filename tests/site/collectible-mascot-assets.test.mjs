import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProductionServer, MASCOT_POSE_FILES, MASCOT_BLINK_FILES } from '../../apps/production-web/server.mjs';
import { MASCOT_POSES, MASCOT_BLINK } from '../../apps/production-web/assets/collectible-model.mjs';

// Issue #284 WP2: 마스코트 스티커·뒷면 도장은 apps/mobile/assets/images/mascot/v2의 승인된 그림을
// apps/production-web/assets/mascot/로 복사해 쓴다. server.mjs의 HTTP import-crawl 시험은 .mjs/.css import만
// 따라가고 이미지 URL은 보지 않으므로, 여기서 모든 마스코트 파일이 실제로 200을 돌려주는지 따로 확인한다.
test('server.mjs의 마스코트 파일 목록은 model.mjs MASCOT_POSES·MASCOT_BLINK와 정확히 같다', () => {
  assert.deepEqual([...MASCOT_POSE_FILES].sort(), [...MASCOT_POSES].sort());
  assert.deepEqual([...MASCOT_BLINK_FILES].sort(), [...MASCOT_BLINK].sort());
});

test('모든 마스코트 포즈·눈 깜빡임 프레임은 제작기·뒷면·고객 페이지 경로 모두에서 200을 돌려준다', async () => {
  const server = createProductionServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const files = [...MASCOT_POSE_FILES, ...MASCOT_BLINK_FILES.map((name) => `${name}-blink`)];
    for (const prefix of ['/assets/', '/app/assets/', '/merchant/assets/']) {
      for (const pose of files) {
        const response = await fetch(`${base}${prefix}mascot/${pose}.png`);
        assert.equal(response.status, 200, `${prefix}mascot/${pose}.png`);
        assert.equal(response.headers.get('content-type'), 'image/png');
        const bytes = new Uint8Array(await response.arrayBuffer());
        assert.ok(bytes.length > 0, `${prefix}mascot/${pose}.png should not be empty`);
        assert.deepEqual([...bytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${prefix}mascot/${pose}.png should be a real PNG`);
      }
    }
    // 눈 감은 프레임이 없는 포즈(sky-town-header·sleep·town-map)는 -blink 경로가 없어야 한다.
    for (const pose of MASCOT_POSE_FILES.filter((name) => !MASCOT_BLINK_FILES.includes(name))) {
      assert.equal((await fetch(`${base}/assets/mascot/${pose}-blink.png`)).status, 404, pose);
    }
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
