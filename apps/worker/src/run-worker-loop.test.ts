import assert from 'node:assert/strict';
import test from 'node:test';

import { installCrashHandlers, parseWorkerLoopSettings } from './run-worker-loop.js';
import { safeErrorFields } from './run-worker.js';

test('반복 설정은 기본값과 허용 범위를 가진다', () => {
  const defaults = parseWorkerLoopSettings({});
  assert.equal(defaults.idleMs, 3_000);
  assert.equal(defaults.jitterMs, 1_000);
  assert.equal(defaults.busyPauseMs, 200);
  assert.deepEqual(defaults.errorBackoff, { initialMs: 1_000, maxMs: 30_000 });
  assert.equal(defaults.heartbeatFile, undefined);

  assert.equal(parseWorkerLoopSettings({ WORKER_IDLE_POLL_MS: '5000' }).idleMs, 5_000);
  for (const raw of ['499', '60001', '1.5', 'abc']) {
    assert.throws(() => parseWorkerLoopSettings({ WORKER_IDLE_POLL_MS: raw }), /WORKER_IDLE_POLL_MS/, raw);
  }
  for (const raw of ['999', '300001', '1.5']) {
    assert.throws(
      () => parseWorkerLoopSettings({ WORKER_ERROR_BACKOFF_MAX_MS: raw }),
      /WORKER_ERROR_BACKOFF_MAX_MS/,
      raw,
    );
  }
});

test('상태 확인 파일은 비어 있거나 절대 경로여야 한다', () => {
  assert.equal(parseWorkerLoopSettings({ WORKER_HEARTBEAT_FILE: '  ' }).heartbeatFile, undefined);
  assert.equal(
    parseWorkerLoopSettings({ WORKER_HEARTBEAT_FILE: '/tmp/mint-worker.heartbeat' }).heartbeatFile,
    '/tmp/mint-worker.heartbeat',
  );
  assert.throws(
    () => parseWorkerLoopSettings({ WORKER_HEARTBEAT_FILE: 'relative/file' }),
    /WORKER_HEARTBEAT_FILE must be an absolute path/,
  );
});

test('로그에는 오류 이름과 코드만 남기고 RPC 주소·연결 문자열이 든 메시지는 남기지 않는다', () => {
  const rpc = Object.assign(new Error('could not fetch https://rpc.example/v2/key-part'), {
    code: 'NETWORK_ERROR',
  });
  assert.deepEqual(safeErrorFields(rpc), { name: 'Error', code: 'NETWORK_ERROR' });

  const db = new Error('connect ECONNREFUSED db.internal:5432');
  assert.deepEqual(safeErrorFields(db), { name: 'Error' });

  assert.deepEqual(safeErrorFields('문자열'), { name: 'NonError' });
});

test('환경변수 검증 메시지는 변수 이름만 담으므로 원인을 알 수 있게 남긴다', () => {
  assert.deepEqual(safeErrorFields(new Error('NFT_METADATA_ORIGIN is required')), {
    name: 'Error',
    message: 'NFT_METADATA_ORIGIN is required',
  });
  assert.deepEqual(safeErrorFields(new Error('WORKER_IDLE_POLL_MS must be an integer between 500 and 60000')), {
    name: 'Error',
    message: 'WORKER_IDLE_POLL_MS must be an integer between 500 and 60000',
  });
});

test('잡히지 않은 예외·거절은 RPC 주소 없이 MINT_WORKER_CRASHED 한 줄을 남기고 종료 코드 1로 끝낸다', (t) => {
  const lines: string[] = [];
  t.mock.method(console, 'log', (line: unknown) => { lines.push(String(line)); });
  const exits: number[] = [];
  const secret = new Error('request failed https://base-sepolia.example/v2/SECRET-API-KEY-1234');
  Object.assign(secret, { code: 'NETWORK_ERROR' });

  const listenersOf = (event: string) => (process as NodeJS.EventEmitter).listeners(event);
  for (const event of ['uncaughtException', 'unhandledRejection']) {
    const before = new Set(listenersOf(event));
    const dispose = installCrashHandlers((code) => { exits.push(code); });
    const added = listenersOf(event).filter((listener) => !before.has(listener));
    assert.equal(added.length, 1, `${event} 리스너가 하나 추가되어야 한다`);
    (added[0] as (error: unknown) => void)(secret);
    dispose();
    assert.equal(listenersOf(event).filter((listener) => !before.has(listener)).length, 0);
  }

  assert.deepEqual(exits, [1, 1]);
  assert.equal(lines.length, 2);
  for (const line of lines) {
    assert.deepEqual(JSON.parse(line), { event: 'MINT_WORKER_CRASHED', name: 'Error', code: 'NETWORK_ERROR' });
    assert.doesNotMatch(line, /SECRET-API-KEY/);
  }
});
