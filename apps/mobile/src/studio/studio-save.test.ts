import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runStudioSave } from './studio-save';

for (const kind of ['공간', '동행']) {
  for (const outcome of ['success', 'failure'] as const) {
    test(`${kind} ${outcome}: blur 뒤 완료해도 busy를 해제하고 응답은 버린다`, async () => {
      let focused = true;
      let generation = 1;
      let busy = true;
      let applied = 0;
      let resolve!: (value: string) => void;
      let reject!: (error: Error) => void;
      const request = generation;
      const done = runStudioSave(() => new Promise<string>((yes, no) => { resolve = yes; reject = no; }), {
        isMounted: () => true,
        canApply: () => focused && request === generation,
        onSuccess: () => { applied++; }, onError: () => { applied++; },
        onSettled: () => { busy = false; },
      });
      focused = false;
      generation++;
      if (outcome === 'success') resolve('저장'); else reject(new Error('실패'));
      await done;
      assert.equal(busy, false);
      assert.equal(applied, 0);
    });
  }
}

test('돌아와 새 조회를 시작한 뒤 옛 저장 응답은 적용하지 않는다', async () => {
  let generation = 1;
  let applied = 0;
  let settled = 0;
  let resolve!: (value: string) => void;
  const request = generation;
  const done = runStudioSave(() => new Promise<string>((yes) => { resolve = yes; }), {
    isMounted: () => true, canApply: () => request === generation,
    onSuccess: () => { applied++; }, onError: () => { applied++; }, onSettled: () => { settled++; },
  });
  generation += 2;
  resolve('옛 응답');
  await done;
  assert.equal(applied, 0);
  assert.equal(settled, 1);
});

test('언마운트 뒤에는 성공·오류·busy 상태를 변경하지 않는다', async () => {
  for (const failed of [false, true]) {
    let mounted = true;
    let updates = 0;
    const done = runStudioSave(async () => { await Promise.resolve(); if (failed) throw new Error('실패'); return '저장'; }, {
      isMounted: () => mounted, canApply: () => true,
      onSuccess: () => { updates++; }, onError: () => { updates++; }, onSettled: () => { updates++; },
    });
    mounted = false;
    await done;
    assert.equal(updates, 0);
  }
});

test('최신 저장의 성공·오류와 완료는 각 한 번 전달한다', async () => {
  for (const failed of [false, true]) {
    const events: string[] = [];
    await runStudioSave(async () => { if (failed) throw new Error('실패'); return '저장'; }, {
      isMounted: () => true, canApply: () => true,
      onSuccess: (value) => { events.push(value); }, onError: () => { events.push('실패'); },
      onSettled: () => { events.push('완료'); },
    });
    assert.deepEqual(events, [failed ? '실패' : '저장', '완료']);
  }
});

test('공간·동행 저장은 같은 수명 제어기를 사용하고 각각 busy를 해제한다', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../screens/studio/index.tsx', import.meta.url), 'utf8');
  assert.equal((source.match(/await runStudioSave\(/g) ?? []).length, 2);
  assert.equal((source.match(/isMounted: \(\) => mounted\.current/g) ?? []).length, 2);
  assert.equal((source.match(/canApply: \(\) => active\.current && request === generation\.current/g) ?? []).length, 2);
  assert.match(source, /onSettled: \(\) => setSaving\(false\)/);
  assert.match(source, /onSettled: \(\) => setAvatarSaving\(false\)/);
});
