// 점주 체험 권한 요청 관리자 화면(#294)의 수락/거절 순서 제어를 순수 로직으로 뗀 모듈. React 없이 시험한다.
// merchant-art/owner-steps.ts의 StepGate를 그대로 쓴다: 한 번에 결정 하나만 진행되고, gate는 렌더마다 새로 만들어지는
// 값이 아니라 화면이 계속 들고 있는 객체라서 "지금 다른 결정이 진행 중인가"는 항상 그 순간의 진짜 상태를 읽는다 — 어느 줄의
// 버튼을 먼저 눌렀는지, 그 버튼을 누른 렌더가 가진 busyId 스냅샷이 무엇이었는지와 무관하다(리뷰 #4).

import { createStepGate, runOwnerStep, type StepGate } from '@/merchant-art/owner-steps';

export type DecideApi = (input: { requestId: string; decision: 'approve' | 'reject' }) => Promise<void>;

export type DecideHandlers = {
  onBegin: (requestId: string) => void;
  onSuccess: () => void;
  onError: (error: unknown) => void;
  /** 성공하든 실패하든 끝에 한 번: 화면의 busy 표시를 내린다. */
  onSettled: () => void;
};

export function createDecideController(decide: DecideApi, gate: StepGate = createStepGate()) {
  return {
    gate,
    /** gate가 이미 진행 중이면(다른 줄의 결정이 떠 있으면) 아무 핸들러도 부르지 않고 조용히 끝난다. */
    decide(request: { id: string }, decision: 'approve' | 'reject', handlers: DecideHandlers): Promise<void> {
      return runOwnerStep(gate, async () => {
        try {
          await decide({ requestId: request.id, decision });
          handlers.onSuccess();
        } finally {
          handlers.onSettled();
        }
      }, {
        onBegin: () => handlers.onBegin(request.id),
        onError: handlers.onError,
      });
    },
  };
}
