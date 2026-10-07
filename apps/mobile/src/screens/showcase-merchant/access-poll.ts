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
  let inFlight = false;
  let generation = 0;
  let timer: unknown;

  function schedule(current: number) {
    timer = timers.setTimeout(() => { void tick(current); }, intervalMs);
  }

  async function tick(current: number) {
    timer = undefined;
    inFlight = true;
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
    } finally {
      inFlight = false;
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
    /**
     * 화면(또는 앱)이 다시 앞으로 왔을 때 간격을 기다리지 않고 지금 바로 한 번 묻는다(리뷰 #2). 같은 generation·in-flight
     * 규칙을 그대로 타므로, 응답이 돌아오기 전에 stop()이 불리면(다시 화면을 벗어나거나 상태가 바뀌면) 그 응답은 버려지고,
     * 이미 요청이 나가 있으면 겹쳐 묻지 않는다.
     */
    pokeNow() {
      if (inFlight) return;
      running = true;
      generation += 1;
      if (timer !== undefined) timers.clearTimeout(timer);
      timer = undefined;
      void tick(generation);
    },
    stop,
    isRunning: () => running,
  };
}

export type ShowcaseScreenStatus = 'loading' | 'denied' | 'error' | 'allowed';
export type ShowcaseAccessStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

type AccessRequestLike = { code: string; status: ShowcaseAccessStatus };

export type PermissionRecheckDecision =
  | { action: 'recheck'; code: string }
  | { action: 'stuck' }
  | { action: 'none' };

/**
 * 권한 요청이 막 APPROVED가 됐는데(최초 조회든 폴링 응답이든) 화면은 아직 allowed가 아니라면 점주 권한을 다시 확인해야 한다
 * (리뷰 #1: 최초 조회가 denied+APPROVED에 머무는 문제). 같은 요청(code)에는 자동 재확인을 한 번만 허용한다: 캠페인 만료·비공개
 * 등으로 재확인 후에도 여전히 거부라면 루프를 멈추고 수동 "다시 확인"으로 넘긴다(`attemptedCode`는 마지막으로 자동 재확인을
 * 시도한 요청의 code를 호출자가 들고 있다가 넘긴다).
 */
export function decidePermissionRecheck(
  request: AccessRequestLike | null | undefined,
  screenStatus: ShowcaseScreenStatus,
  attemptedCode: string | undefined,
): PermissionRecheckDecision {
  if (!request || request.status !== 'APPROVED' || screenStatus === 'allowed') return { action: 'none' };
  if (attemptedCode === request.code) return { action: 'stuck' };
  return { action: 'recheck', code: request.code };
}

/**
 * 점주 체험의 모든 상태에서 뒤로가기를 받아 역할 선택으로 돌아간다. 투어는 자체 종료 동작을 쓴다.
 * 관리자·가게 그림·알림 화면이 열려 있으면 화면 컴포넌트가 그것부터 닫는다.
 */
export function shouldHandleHardwareBack(input: { tour: boolean; adminOpen: boolean; screenStatus: ShowcaseScreenStatus }): boolean {
  return !input.tour;
}
