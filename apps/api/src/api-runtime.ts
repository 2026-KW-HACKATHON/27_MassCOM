import type { IncomingMessage, ServerResponse } from 'node:http';

import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from './account-consent.js';
import { developmentHeaderAccountResolver, type AccountResolver, type ResolvedApiDeps } from './api-deps.js';
import { FixedWindowAuthLoginLimiter } from './http/login-limiter.js';
import { authLoginClientKey, requireBearerToken } from './http/request-auth.js';
import { RequestError } from './http/request-error.js';
import { sendJson } from './http/response.js';
import { MerchantAccessError } from './merchant-access.js';
import { SHOWCASE_TEST_VISIT_LIMIT_PER_HOUR } from './showcase/all-access.js';

// 서버 인스턴스마다 한 번 만든다. 제한기·계정 해석 래퍼·동의/스캔 확인은 인스턴스 안에서만 공유하고 모듈 전역에 두지 않는다.
export function createApiRuntime(deps: ResolvedApiDeps) {
  const { merchantAccess, baseAccountResolver, guestTrials, consent } = deps;
  const { trustProxyClientIp } = deps;
  const requireCustomerScan = async (accountId: string, merchantId: string): Promise<void> => {
    if (!merchantAccess) throw new RequestError(503, 'MERCHANT_ACCESS_NOT_CONFIGURED');
    try { await merchantAccess.requirePermission({ accountId, merchantId, permission: 'CONFIRM_VISIT' }); }
    catch (error) {
      if (!(error instanceof MerchantAccessError)) throw error;
      await merchantAccess.requirePermission({ accountId, merchantId, permission: 'REDEEM_COUPON' });
    }
  };
  // 로컬 시연(DEMO 헤더) 배치에서는 체험 세션 Bearer도 받는다(#309). Authorization이 없으면 기존 헤더 해석 그대로이고,
  // 운영·hosted 해석기(Bearer 세션)는 이미 같은 auth_sessions 행으로 체험 세션을 푼다.
  const resolveAccountId: AccountResolver = guestTrials && baseAccountResolver === developmentHeaderAccountResolver
    ? (request) => request.headers.authorization === undefined
      ? baseAccountResolver(request) : guestTrials.resolve(requireBearerToken(request))
    : baseAccountResolver;
  // 로그인 없는 체험 시작의 짧은 폭주 제한: IP당 15분에 20번(#309). 심사장처럼 한 NAT를 여럿이 나눠 써도 막히지 않게 넉넉히 두고,
  // 한 IP의 끝나지 않은 체험 수(30)와 전역 상한(300)은 서비스가 트랜잭션 안에서 따로 지킨다.
  const guestTrialLimiter = new FixedWindowAuthLoginLimiter({ maxAttempts: 20, windowMs: 15 * 60 * 1000 });
  // The receipt lookup needs no login, so it is throttled per client instead (a receipt has 80 bits, this only stops floods).
  const deletionStatusLimiter = new FixedWindowAuthLoginLimiter({ maxAttempts: 30, windowMs: 60_000 });
  // 계정당 5회/시간(#294). IP가 아니라 계정으로 거는 건 승인 전 계정도 로그인은 됐기 때문이다.
  const showcaseAccessRequestLimiter = new FixedWindowAuthLoginLimiter({ maxAttempts: 5, windowMs: 60 * 60 * 1000 });
  // 계정당 60회/시간(#295의 10에서 #333이 올림). 가상 점포 방문이라 점주 쪽 쿨다운은 없지만, 발급 자체를 계정별로 묶어 둔다.
  const showcaseTestVisitLimiter = new FixedWindowAuthLoginLimiter({
    maxAttempts: SHOWCASE_TEST_VISIT_LIMIT_PER_HOUR, windowMs: 60 * 60 * 1000,
  });
  // 방문 후 가게 특징·바라는 점·의견 저장은 계정당 30회/시간(#334). 같은 가게를 고쳐 쓰는 것도 한 번으로 센다.
  const visitorFeedbackWriteLimiter = new FixedWindowAuthLoginLimiter({ maxAttempts: 30, windowMs: 60 * 60 * 1000 });
  // 점포 정보 저장은 점포 수와 무관하게 계정당 30회/시간으로 제한한다(#365).
  const merchantProfileWriteLimiter = new FixedWindowAuthLoginLimiter({ maxAttempts: 30, windowMs: 60 * 60 * 1000 });
  const playFlowWriteLimiter = new FixedWindowAuthLoginLimiter({ maxAttempts: 120, windowMs: 60 * 60 * 1000 });
  const experienceWriteLimiter = new FixedWindowAuthLoginLimiter({ maxAttempts: 120, windowMs: 60_000 });
  const merchantOperationLimiter = new FixedWindowAuthLoginLimiter({ maxAttempts: 120, windowMs: 60 * 60 * 1000 });
  // 실행별 멱등 재시도도 본문·DB 진입 전에 계정별로 센다. 분당 60회는 정상 완료·재시도에 여유를 둔다.
  const playFinishLimiter = new FixedWindowAuthLoginLimiter({ maxAttempts: 60, windowMs: 60_000 });
  const socialWriteLimiter = new FixedWindowAuthLoginLimiter({ maxAttempts: 60, windowMs: 60_000 });
  const coinWriteLimiter = new FixedWindowAuthLoginLimiter({ maxAttempts: 60, windowMs: 60 * 60_000 });
  const roomWriteLimiter = new FixedWindowAuthLoginLimiter({ maxAttempts: 60, windowMs: 60_000 });
  const discoveryEventLimiter = new FixedWindowAuthLoginLimiter({ maxAttempts: 120, windowMs: 60_000 });
  const discoveryMapLimiter = new FixedWindowAuthLoginLimiter({ maxAttempts: 60, windowMs: 60 * 60_000 });
  const requireCurrentPlayConsent = async (accountId: string): Promise<void> => {
    if (!consent) throw new RequestError(503, 'CONSENT_NOT_CONFIGURED');
    const state = await consent.status(accountId);
    if (state.required || state.termsVersion !== CURRENT_TERMS_VERSION || state.privacyVersion !== CURRENT_PRIVACY_VERSION) {
      throw new RequestError(403, 'CONSENT_REQUIRED');
    }
  };
  // IP는 기존 로그인 제한과 같은 메모리 창에만 두고 조회 집계 서비스로 보내지 않는다.
  const merchantDetailViewLimiter = new FixedWindowAuthLoginLimiter({ maxAttempts: 300, windowMs: 60 * 60 * 1000 });
  // Media-bearing collectible writes (create/save/copy/publish parse up to 8 MiB and decode every image) are throttled per store.
  const collectibleWriteLimiter = new FixedWindowAuthLoginLimiter({ maxAttempts: 20, windowMs: 60_000 });
  const consumeDeletionStatus = (request: IncomingMessage, response: ServerResponse): boolean => {
    const decision = deletionStatusLimiter.consume(authLoginClientKey(request, trustProxyClientIp));
    if (decision.allowed) return true;
    response.setHeader('Retry-After', String(decision.retryAfterSeconds));
    sendJson(response, 429, { code: 'DELETION_STATUS_RATE_LIMITED' });
    return false;
  };
  return {
    resolveAccountId, requireCustomerScan, requireCurrentPlayConsent, consumeDeletionStatus, guestTrialLimiter,
    showcaseAccessRequestLimiter, showcaseTestVisitLimiter, visitorFeedbackWriteLimiter,
    merchantProfileWriteLimiter, playFlowWriteLimiter, experienceWriteLimiter, merchantOperationLimiter,
    playFinishLimiter, socialWriteLimiter, coinWriteLimiter, roomWriteLimiter, discoveryEventLimiter,
    discoveryMapLimiter, merchantDetailViewLimiter, collectibleWriteLimiter,
  };
}

export type ApiRuntime = ReturnType<typeof createApiRuntime>;
