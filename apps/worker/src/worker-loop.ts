export type WorkerLoopOptions = {
  /** 대기 작업 한 건을 처리했으면 true, 처리할 작업이 없으면 false. 예외는 반복이 처리한다. */
  runOnce: () => Promise<boolean>;
  /** 중지 신호. 신호가 오면 처리 중인 한 건을 끝낸 뒤 반복을 마친다. */
  signal: AbortSignal;
  /** 신호가 오면 일찍 끝나야 하는 대기. */
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  /** 처리할 작업이 없을 때 쉬는 기본 시간. */
  idleMs: number;
  /** 유휴 대기에 더하는 0 이상 이 값 미만의 무작위 시간(여러 프로세스의 동시 조회를 흩뜨림). */
  jitterMs?: number;
  /** 작업을 연속으로 처리할 때 사이에 두는 짧은 쉼. 같은 작업을 곧바로 되풀이하는 오류가 RPC·DB를 두드리지 않게 한다. */
  busyPauseMs?: number;
  errorBackoff: { initialMs: number; maxMs: number };
  random?: () => number;
  /** 한 번 성공적으로 확인했을 때(처리했든 비었든) 부른다. 상태 확인 신호로 쓴다. */
  onHealthy?: (processed: boolean) => void;
  /** 처리 중 예외가 났을 때 부른다. 다음 시도까지의 대기 시간을 함께 넘긴다. */
  onError?: (error: unknown, nextDelayMs: number) => void;
};

/**
 * 대기 작업을 계속 처리한다. 작업이 있으면 쉬지 않고(짧은 쉼만) 이어서 처리해 밀린 것을 비우고, 없으면
 * 유휴 시간만큼 쉰다. 예외가 나면 늘어나는 간격으로 다시 시도한다. 한 번에 한 건만 처리하므로 같은
 * 민터의 nonce 순서를 지킨다.
 */
export async function runWorkerLoop(options: WorkerLoopOptions): Promise<void> {
  const random = options.random ?? Math.random;
  const jitterMs = options.jitterMs ?? 0;
  const busyPauseMs = options.busyPauseMs ?? 0;
  let consecutiveErrors = 0;

  while (!options.signal.aborted) {
    let processed: boolean;
    try {
      processed = await options.runOnce();
    } catch (error) {
      const delay = Math.min(
        options.errorBackoff.maxMs,
        options.errorBackoff.initialMs * 2 ** Math.min(consecutiveErrors, 30),
      );
      consecutiveErrors += 1;
      options.onError?.(error, delay);
      await options.sleep(delay, options.signal);
      continue;
    }

    consecutiveErrors = 0;
    options.onHealthy?.(processed);
    if (options.signal.aborted) return;
    if (processed) {
      if (busyPauseMs > 0) await options.sleep(busyPauseMs, options.signal);
    } else {
      await options.sleep(options.idleMs + Math.floor(random() * jitterMs), options.signal);
    }
  }
}

/** 신호가 오면 일찍 깨어나는 `setTimeout`. */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', wake);
      resolve();
    }, ms);
    function wake() {
      clearTimeout(timer);
      resolve();
    }
    signal.addEventListener('abort', wake, { once: true });
  });
}
