import assert from 'node:assert/strict';
import { test } from 'node:test';

// Issue #284 WP2: 서버(collectible-project-rules.ts의 mascotBlink)와 웹 model.mjs(MASCOT_BLINK)는 서로 import하지
// 않는 쌍둥이 구현이라, 한쪽만 고치면 living의 blink 항목이 두 곳에서 다르게 검증될 수 있다. 값이 같은지 직접 맞춘다.
test('server mascotBlink and web MASCOT_BLINK list the exact same poses', async () => {
  // production-web은 별도 패키지(.mjs, 타입 선언 없음)라 동적 import를 그대로 캐스트한다.
  // @ts-expect-error - sibling app module has no type declarations
  const model = (await import('../../production-web/assets/collectible-model.mjs')) as { MASCOT_BLINK: readonly string[]; MASCOT_POSES: readonly string[] };
  // mascotBlink는 모듈 밖으로 내보내지 않으므로, 같은 입력(blink 포즈 vs 아닌 포즈)에 대한 검증 결과로 간접 확인한다.
  const { validateCollectibleProject } = await import('./collectible-project-rules.js');
  const { photoProject } = await import('./collectible-project-test-support.js');

  assert.ok(model.MASCOT_BLINK.length > 0, 'blink art has landed; MASCOT_BLINK must not be empty');
  assert.ok(model.MASCOT_BLINK.every((pose) => model.MASCOT_POSES.includes(pose)));

  for (const pose of model.MASCOT_POSES) {
    const project = photoProject();
    project.stickers = [{ id: 'face-1', kind: 'mascot', text: pose, x: .5, y: .5, size: 40, rotation: 0, color: '#ffffff', order: 0, align: 'center', layouts: {} }];
    project.living = { periodMs: 2000, items: [{ id: 'living-1', kind: 'blink', target: 'face-1', gradeIds: ['custom'], amplitude: 10, pivot: { x: .5, y: .5 } }] };
    const expectBlinkAllowed = model.MASCOT_BLINK.includes(pose);
    if (expectBlinkAllowed) {
      assert.doesNotThrow(() => validateCollectibleProject(project), pose);
    } else {
      assert.throws(() => validateCollectibleProject(project), { code: 'COLLECTIBLE_INVALID_PROJECT' }, pose);
    }
  }
});
