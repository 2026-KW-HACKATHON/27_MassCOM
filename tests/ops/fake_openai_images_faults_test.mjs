// 가짜 OpenAI 이미지 서버의 오류 주입(503과 FAKE_OPENAI_FAIL_COUNT) 시험(Issue #256). 컨테이너 리허설이 "한 번 재시도하면 성공"과
// "계속 실패"를 가르는 데 쓴다. 실제 클라이언트와의 맞물림은 apps/api/src/fake-openai-images.test.ts가 이미 확인한다.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createFakeOpenAiImagesServer, fakeServerOptionsFromEnv } from '../../scripts/fake-openai-images.mjs';

async function start(t, env) {
  const logs = [];
  const server = createFakeOpenAiImagesServer(
    fakeServerOptionsFromEnv({ FAKE_OPENAI_DELAY_MS: '0', ...env }), (line) => logs.push(line),
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const base = `http://127.0.0.1:${server.address().port}`;
  const draft = async () => fetch(`${base}/v1/images/generations`, {
    method: 'POST',
    headers: { authorization: 'Bearer fake-local-key', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'draft-model', prompt: 'a round rubber-stamp emblem' }),
  });
  return { logs, draft };
}

test('unavailable answers 503 without Retry-After and without an error code', async (t) => {
  const { draft, logs } = await start(t, { FAKE_OPENAI_FAIL: 'unavailable' });
  const response = await draft();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('retry-after'), null);
  const body = await response.json();
  assert.equal(body.error.code, null);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /generations model=draft-model prompt=\d+ chars -> 503$/);
});

test('FAKE_OPENAI_FAIL_COUNT fails only the first N requests and then answers normally', async (t) => {
  const { draft, logs } = await start(t, { FAKE_OPENAI_FAIL: 'rate_limit', FAKE_OPENAI_FAIL_COUNT: '2' });
  const first = await draft();
  assert.equal(first.status, 429);
  assert.equal(first.headers.get('retry-after'), '1');
  assert.equal((await draft()).status, 429);
  const third = await draft();
  assert.equal(third.status, 200);
  const body = await third.json();
  assert.equal(typeof body.data[0].b64_json, 'string');
  assert.equal((await draft()).status, 200);
  assert.deepEqual(logs.map((line) => line.endsWith(' -> 429')), [true, true, false, false]);
});

test('without FAKE_OPENAI_FAIL_COUNT the failure never stops', async (t) => {
  const { draft } = await start(t, { FAKE_OPENAI_FAIL: 'server_error' });
  for (let attempt = 0; attempt < 3; attempt++) assert.equal((await draft()).status, 500);
});

test('FAKE_OPENAI_FAIL_COUNT only counts requests on the failing path', async (t) => {
  const { draft } = await start(t, {
    FAKE_OPENAI_FAIL: 'unavailable', FAKE_OPENAI_FAIL_PATH: 'edits', FAKE_OPENAI_FAIL_COUNT: '1',
  });
  // 시안(generations)은 오류 경로가 아니라 횟수에 들지 않는다.
  assert.equal((await draft()).status, 200);
  assert.equal((await draft()).status, 200);
});

test('FAKE_OPENAI_FAIL_COUNT rejects values that are not a positive integer', () => {
  for (const bad of ['0', '-1', '1.5', 'many', '1001']) {
    assert.throws(() => fakeServerOptionsFromEnv({ FAKE_OPENAI_FAIL_COUNT: bad }), /FAKE_OPENAI_FAIL_COUNT/, bad);
  }
  assert.equal(fakeServerOptionsFromEnv({ FAKE_OPENAI_FAIL_COUNT: '1000' }).failCount, 1000);
  assert.equal(fakeServerOptionsFromEnv({}).failCount, undefined);
});
