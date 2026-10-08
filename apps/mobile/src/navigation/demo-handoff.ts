import { canShowTestVisitSection } from './showcase-entry';

/**
 * 시연 "1인 2역"(Issue #412): 한 사람이 점주 화면과 손님 화면을 오가며 방문을 끝까지 해 보도록, 서버가 방금 발급한 값을
 * 두 화면 사이에서만 넘긴다. 메모리에만 두고 한 번 읽으면 지운다. URL·로그·저장소에는 쓰지 않으며 손으로 입력하지도 않는다(D-091, D-065와 대비).
 * 값은 넘긴 계정에 묶인다: 다른 계정이 읽으려 하면 아무것도 받지 못하고 값은 지워진다(notifications/pending-target.ts와 같은 방식).
 * 로그아웃·계정 전환·세션 무효화에서는 auth-provider가 `clearDemoHandoff()`로 비운다.
 * - 'claim': 점주가 발급한 방문 코드 → 손님 방문 인증 화면이 받는다.
 * - 'identity': 손님의 2분 식별 QR → 점주 방문 확인 화면이 받는다.
 */
export type DemoHandoffKind = 'claim' | 'identity';

let pending: { kind: DemoHandoffKind; accountId: string; token: string; expiresAtMs: number } | undefined;

/** 시연 앱·로컬 개발 빌드(웹은 scheme으로 같은 판정)에서만 연다. 운영 앱에는 단추도, 넘김도 없다. */
export function canUseDemoHandoff(packageId: string | null | undefined): boolean {
  return canShowTestVisitSection(packageId);
}

export function setDemoHandoff(handoff: { kind: DemoHandoffKind; accountId: string; token: string; expiresAt: string }): void {
  const expiresAtMs = Date.parse(handoff.expiresAt);
  pending = handoff.token && handoff.accountId && Number.isFinite(expiresAtMs)
    ? { kind: handoff.kind, accountId: handoff.accountId, token: handoff.token, expiresAtMs } : undefined;
}

/**
 * 같은 계정이고 종류가 맞고 아직 만료 전이면 값을 돌려주고 비운다. 만료된 값은 버린다. 다른 계정이 읽으면 값을 비우고 아무것도 주지 않는다.
 * 같은 계정의 다른 종류는 그 종류를 받을 화면을 위해 건드리지 않는다.
 */
export function takeDemoHandoff(kind: DemoHandoffKind, accountId: string, now = Date.now()): string | undefined {
  const value = pending;
  if (!value) return undefined;
  if (value.accountId !== accountId) { pending = undefined; return undefined; }
  if (value.kind !== kind) return undefined;
  pending = undefined;
  return value.expiresAtMs > now ? value.token : undefined;
}

/** 로그아웃·계정 전환·세션 무효화에서 넘기던 값을 버린다. */
export function clearDemoHandoff(): void {
  pending = undefined;
}
