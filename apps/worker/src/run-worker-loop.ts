import { writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createConfiguredWorker } from './run-worker.js';
import { abortableSleep, runWorkerLoop } from './worker-loop.js';

export type WorkerLoopSettings = {
  idleMs: number;
  jitterMs: number;
  busyPauseMs: number;
  errorBackoff: { initialMs: number; maxMs: number };
  /** 비어 있으면 상태 확인 파일을 쓰지 않는다. */
  heartbeatFile: string | undefined;
};

export function parseWorkerLoopSettings(
  environment: Record<string, string | undefined>,
): WorkerLoopSettings {
  const idleMs = boundedInteger(environment.WORKER_IDLE_POLL_MS, 3_000, 'WORKER_IDLE_POLL_MS', 500, 60_000);
  const errorMaxMs = boundedInteger(
    environment.WORKER_ERROR_BACKOFF_MAX_MS,
    30_000,
    'WORKER_ERROR_BACKOFF_MAX_MS',
    1_000,
    300_000,
  );
  const heartbeatFile = environment.WORKER_HEARTBEAT_FILE?.trim() || undefined;
  if (heartbeatFile !== undefined && !isAbsolute(heartbeatFile)) {
    throw new Error('WORKER_HEARTBEAT_FILE must be an absolute path');
  }
  return {
    idleMs,
    jitterMs: Math.floor(idleMs / 3),
    busyPauseMs: 200,
    errorBackoff: { initialMs: 1_000, maxMs: errorMaxMs },
    heartbeatFile,
  };
}

function boundedInteger(
  raw: string | undefined,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(raw ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

// ethers·pg 오류 메시지에는 RPC 주소(키 포함 가능)나 연결 문자열이 들어갈 수 있어 이름과 코드만 남긴다.
// 환경변수 검증 메시지("NAME is required", "NAME must be ...")는 변수 이름만 담으므로 원인 파악을 위해 남긴다.
const configMessage = /^[A-Z][A-Z0-9_]+ (is required|must )[^\r\n]*$/;

export function safeErrorFields(error: unknown): { name: string; code?: string; message?: string } {
  if (!(error instanceof Error)) return { name: 'NonError' };
  const code = (error as Error & { code?: unknown }).code;
  return {
    name: error.name,
    ...(typeof code === 'string' ? { code } : {}),
    ...(configMessage.test(error.message) ? { message: error.message } : {}),
  };
}

function log(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event, ...fields }));
}

export async function runWorkerLoopFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const settings = parseWorkerLoopSettings(environment);
  // 설정·keystore 오류는 여기서 던진다. 다시 띄워도 같은 결과이므로 반복하지 않고 프로세스를 끝낸다.
  const worker = await createConfiguredWorker(environment);

  const stop = new AbortController();
  let signalCount = 0;
  const onSignal = (name: string) => {
    signalCount += 1;
    if (signalCount > 1) process.exit(130);
    log('MINT_WORKER_STOPPING', { signal: name });
    stop.abort();
  };
  process.on('SIGTERM', () => onSignal('SIGTERM'));
  process.on('SIGINT', () => onSignal('SIGINT'));

  let heartbeatWarned = false;
  const heartbeat = (): void => {
    if (!settings.heartbeatFile) return;
    writeFile(settings.heartbeatFile, String(Date.now())).catch((error: unknown) => {
      if (heartbeatWarned) return;
      heartbeatWarned = true;
      log('MINT_WORKER_HEARTBEAT_WRITE_FAILED', safeErrorFields(error));
    });
  };

  log('MINT_WORKER_LOOP_STARTED', {
    idleMs: settings.idleMs,
    heartbeat: Boolean(settings.heartbeatFile),
  });
  heartbeat();
  try {
    await runWorkerLoop({
      runOnce: () => worker.runOnce(),
      signal: stop.signal,
      sleep: abortableSleep,
      idleMs: settings.idleMs,
      jitterMs: settings.jitterMs,
      busyPauseMs: settings.busyPauseMs,
      errorBackoff: settings.errorBackoff,
      onHealthy: (processed) => {
        heartbeat();
        if (processed) log('MINT_WORKER_PROCESSED_ONE_JOB');
      },
      onError: (error, nextDelayMs) => {
        log('MINT_WORKER_ITERATION_FAILED', { ...safeErrorFields(error), retryInMs: nextDelayMs });
      },
    });
  } finally {
    await worker.close();
    log('MINT_WORKER_LOOP_STOPPED');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await runWorkerLoopFromEnvironment();
  } catch (error) {
    log('MINT_WORKER_LOOP_FAILED', safeErrorFields(error));
    process.exitCode = 1;
  }
}
