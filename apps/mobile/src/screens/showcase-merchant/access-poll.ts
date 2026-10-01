// 점주 체험 권한 요청(#294) 화면의 대기 중 폴링을 순수 로직으로 뗀 모듈. React 없이 시험한다. owner-art 화면의
// merchant-art/round-polling.ts와 같은 모양(setTimeout 체인 + 세대 번호)이다: 한 번에 요청 하나만 내보내고, 다음 요청은 이전이
// 끝난 뒤에만 건다. stop() 뒤(화면 이탈·배경 전환·재요청으로 효과가 다시 걸림)에 늦게 돌아온 응답은 세대 번호가 달라 버려진다.

export const ACCESS_POLL_INTERVAL_MS = 5000;

export type PollTimers = {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

type Options<T> = {
  /** 지금 상태를 한 번 읽는다. */
  poll: () => Promise<T>;
  onResult: (result: T) => void;
  onError?: (error: unknown) => void;
  /** 이 응답 뒤에도 계속 물을지. 거절·승인처럼 더는 바뀌지 않을 상태가 되면 false를 돌려 스스로 멈춘다. */
  shouldContinue: (result: T) => boolean;
  intervalMs?: number;
  timers?: PollTimers;
};

const liveTimers: PollTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createAccessPoller<T>(options: Options<T>) {
  const intervalMs = options.intervalMs ?? ACCESS_POLL_INTERVAL_MS;
  const timers = options.timers ?? liveTimers;
  let running = false;
  let generation = 0;
  let timer: unknown;

  function schedule(current: number) {
    timer = timers.setTimeout(() => { void tick(current); }, intervalMs);
  }

  async function tick(current: number) {
    timer = undefined;
    try {
      const result = await options.poll();
      if (current !== generation) return;
      options.onResult(result);
      if (options.shouldContinue(result)) schedule(current);
      else stop();
    } catch (error) {
      if (current !== generation) return;
      options.onError?.(error);
      schedule(current);
    }
  }

  function stop() {
    running = false;
    generation += 1;
    if (timer !== undefined) timers.clearTimeout(timer);
    timer = undefined;
  }

  return {
    start() {
      if (running) return;
      running = true;
      generation += 1;
      schedule(generation);
    },
    stop,
    isRunning: () => running,
  };
}

export type ShowcaseScreenStatus = 'loading' | 'denied' | 'error' | 'allowed';
export type ShowcaseAccessStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

/**
 * 권한 요청이 막 APPROVED가 됐는데(최초 조회든 폴링 응답이든) 화면은 아직 allowed가 아니라면 점주 권한을 다시 확인해야 한다
 * (리뷰 #1: 최초 조회가 denied+APPROVED에 머무는 문제).
 */
export function needsPermissionRecheck(
  requestStatus: ShowcaseAccessStatus | undefined,
  screenStatus: ShowcaseScreenStatus,
): boolean {
  return requestStatus === 'APPROVED' && screenStatus !== 'allowed';
}
