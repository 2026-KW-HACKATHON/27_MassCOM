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
