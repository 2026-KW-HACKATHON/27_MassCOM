import type { ApiDeps } from './api-deps.js';
import { createApiServer as createApiServerFromDeps } from './server.js';

// 시험 전용: 서버 모듈 전체를 다시 내보내되 createApiServer만 옛 위치 인자 모양으로 덮어쓴다(지역 선언이 export *보다 우선한다).
// 위치 인자로 서비스 몇 개만 채워 서버를 만들던 시험들이 import 줄만 이쪽으로 향하면 호출은 그대로 쓰이게 한다. 운영 코드는 가져오지 않는다.
export * from './server.js';

export function createApiServer(
  service: ApiDeps['service'],
  baseAccountResolver: ApiDeps['baseAccountResolver'],
  merchantCatalog?: ApiDeps['merchantCatalog'],
  merchantAccess?: ApiDeps['merchantAccess'],
  claimSlots?: ApiDeps['claimSlots'],
  collection?: ApiDeps['collection'],
  recommendations?: ApiDeps['recommendations'],
  mintRequests?: ApiDeps['mintRequests'],
  accountDeletions?: ApiDeps['accountDeletions'],
  requireReauthentication?: ApiDeps['requireReauthentication'],
  campaignEnrollments?: ApiDeps['campaignEnrollments'],
  authSessions?: ApiDeps['authSessions'],
  authLoginLimiter?: ApiDeps['authLoginLimiter'],
  trustProxyClientIp: ApiDeps['trustProxyClientIp'] = false,
  webAuth?: ApiDeps['webAuth'],
  webWwwEnabled: ApiDeps['webWwwEnabled'] = false,
  customerIdentities?: ApiDeps['customerIdentities'],
  admin?: ApiDeps['admin'],
  deletionIntake?: ApiDeps['deletionIntake'],
  staffRegistration?: ApiDeps['staffRegistration'],
  badges?: ApiDeps['badges'],
  friends?: ApiDeps['friends'],
  merchantArt?: ApiDeps['merchantArt'],
  showcaseDeletionIntake?: ApiDeps['showcaseDeletionIntake'],
  deletionProcessing?: ApiDeps['deletionProcessing'],
  reversals?: ApiDeps['reversals'],
  consent?: ApiDeps['consent'],
  nftMetadata?: ApiDeps['nftMetadata'],
  collectibleProjects?: ApiDeps['collectibleProjects'],
  mileageShop?: ApiDeps['mileageShop'],
  accessRequests?: ApiDeps['accessRequests'],
  guestTrials?: ApiDeps['guestTrials'],
  merchantOverview?: ApiDeps['merchantOverview'],
  visitorFeedback?: ApiDeps['visitorFeedback'],
  collectiblePreview?: ApiDeps['collectiblePreview'],
  merchantDetailViews?: ApiDeps['merchantDetailViews'],
  adminFunnel?: ApiDeps['adminFunnel'],
  play?: ApiDeps['play'],
  merchantProfile?: ApiDeps['merchantProfile'],
  experienceServices: ApiDeps['experienceServices'] = {},
  storeTickets?: ApiDeps['storeTickets'],
  social?: ApiDeps['social'],
) {
  return createApiServerFromDeps({
    service, baseAccountResolver, merchantCatalog, merchantAccess, claimSlots, collection, recommendations,
    mintRequests, accountDeletions, requireReauthentication, campaignEnrollments, authSessions, authLoginLimiter,
    trustProxyClientIp, webAuth, webWwwEnabled, customerIdentities, admin, deletionIntake, staffRegistration,
    badges, friends, merchantArt, showcaseDeletionIntake, deletionProcessing, reversals, consent, nftMetadata,
    collectibleProjects, mileageShop, accessRequests, guestTrials, merchantOverview, visitorFeedback,
    collectiblePreview, merchantDetailViews, adminFunnel, play, merchantProfile, experienceServices, storeTickets,
    social,
  });
}
