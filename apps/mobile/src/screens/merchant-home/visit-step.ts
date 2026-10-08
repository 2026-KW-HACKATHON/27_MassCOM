/** 발급 결과를 우선하며, 촬영 중에는 고객 식별 전 단계에 머문다. */
export function merchantStepFor(state: { scanning: boolean; identified: boolean; issued: boolean }): 1 | 2 | 3 {
  if (state.issued) return 3;
  if (state.scanning) return 1;
  return state.identified ? 2 : 1;
}

export function claimSecondsRemaining(expiresAt: string, now = Date.now()): number {
  const expiry = Date.parse(expiresAt);
  return Number.isFinite(expiry) ? Math.max(0, Math.ceil((expiry - now) / 1000)) : 0;
}

/** 점주 체험 단계 카드의 네 단계(Issue #412). 누를 수 없는 안내이며 "단계 n/4"로 읽힌다. */
export const merchantDemoSteps = ['① 내 체험 가게가 열렸어요', '② 손님이 되어 QR 보여주기', '③ 방문 코드 발급', '④ 오늘·현황에서 확인'] as const;

/**
 * 카드의 단계는 라벨이 말하는 일에 맞춘다. 화면이 처음 열려 아무 고객도 없으면 ①, 고객 QR을 찍거나 만드는 중이면 ②,
 * 고객이 식별돼 "방문 코드 발급"을 누를 차례이거나 코드가 발급됐으면 ③, 손님이 방문을 확정한 뒤 처음 화면으로 돌아오면 ④(현황에서 확인)다.
 * `capturing`은 카메라 촬영 중이거나 시연 손님 QR을 만드는 중이다. ④는 점주 화면이 열린 채 다른 기기의 손님이 확정하는 두 기기 흐름에서만 켜진다:
 * 한 기기 1인 2역은 역할을 바꿀 때 화면이 다시 열려 확정 답을 쥐고 있지 않다(D-091).
 */
export function merchantCardStep(step: 1 | 2 | 3, capturing: boolean, visitConfirmed: boolean): 1 | 2 | 3 | 4 {
  if (step === 1) return capturing ? 2 : visitConfirmed ? 4 : 1;
  return 3;
}
