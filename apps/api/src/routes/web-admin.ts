import { parseSuggestedHour } from '../course-rules.js';
import { AdminError, type AdminCampaignDraftInput, type MerchantInput } from '../postgres/admin.js';
import type { PublishCoinPoolInput, PublishCoinSeriesInput } from '../coin-economy.js';
import { authLoginClientKey, requireWebCookie } from '../http/request-auth.js';
import {
  decodePathParameter, readJson, requireEmptyBody, requireNumber, requireOnlyKeys, requirePositiveInteger, requireString,
} from '../http/request-body.js';
import { RequestError } from '../http/request-error.js';
import { sendJson } from '../http/response.js';
import { resolveWebOrigin } from '../web-origin.js';
import { WebSessionError, freshWebSessionMs } from '../web-session.js';
import type { RouteContext } from './context.js';

export async function handleWebAdmin(ctx: RouteContext): Promise<boolean> {
  const { request, response, path, deps, runtime } = ctx;
  const { webAuth, admin, authLoginLimiter, staffRegistration, deletionProcessing, adminFunnel, play, campaignBenefits } = deps;
  const { trustProxyClientIp } = deps;
  const { webWwwEnabled } = deps;
  const { realWorld, coinEconomy, roomCommunity } = deps.experienceServices;
  const { roomWriteLimiter, coinWriteLimiter } = runtime;
  if (path.startsWith('/api/web/admin/')) {
    const origin = resolveWebOrigin(request.headers.host, webWwwEnabled);
    response.setHeader('x-robots-tag', 'noindex, nofollow');
    if (!webAuth || !admin) throw new RequestError(503, 'WEB_ADMIN_NOT_CONFIGURED');
    if (path === '/api/web/admin/auth/start' && request.method === 'GET') {
      if (authLoginLimiter) {
        const decision = authLoginLimiter.consume(authLoginClientKey(request, trustProxyClientIp));
        if (!decision.allowed) {
          response.setHeader('Retry-After', String(decision.retryAfterSeconds));
          sendJson(response, 429, { code: 'LOGIN_RATE_LIMITED' });
          return true;
        }
      }
      const started = await webAuth.start(origin, '/admin/');
      response.setHeader('set-cookie', `web_auth_state=${started.state}; Path=/api/web/auth; Max-Age=300; HttpOnly; Secure; SameSite=Lax`);
      response.setHeader('location', started.location);
      response.writeHead(302).end();
      return true;
    }
    if (request.method !== 'GET') {
      if (request.headers.origin !== origin ||
          !/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '')) {
        throw new RequestError(403, 'ADMIN_CSRF_FORBIDDEN');
      }
    }
    const accountId = await webAuth.resolveSession(requireWebCookie(request, 'web_session'), origin);
    if (!(await admin.isAdmin(accountId))) throw new AdminError('ADMIN_FORBIDDEN');
    const benefitMatch = path.match(/^\/api\/web\/admin\/campaigns\/([^/]+)\/(benefit|benefit\/pause|benefit-status)$/);
    if (benefitMatch) {
      if (!campaignBenefits) throw new RequestError(503, 'CAMPAIGN_BENEFITS_NOT_CONFIGURED');
      const campaignId = decodePathParameter(benefitMatch[1]!);
      if (benefitMatch[2] === 'benefit-status' && request.method === 'GET') {
        sendJson(response, 200, await campaignBenefits.getBenefitStatus({ accountId, campaignId }));
      } else if (benefitMatch[2] === 'benefit' && request.method === 'POST') {
        const body = await readJson(request);
        requireOnlyKeys(body, ['title', 'detail', 'validDays', 'unitExtraCostWon', 'maxUses', 'consentDocumentRef', 'consent']);
        sendJson(response, 201, await campaignBenefits.createBenefit({
          adminAccountId: accountId, campaignId, title: requireString(body, 'title'),
          detail: requireString(body, 'detail', true), validDays: requirePositiveInteger(body, 'validDays'),
          unitExtraCostWon: requirePositiveInteger(body, 'unitExtraCostWon'), maxUses: requirePositiveInteger(body, 'maxUses'),
          consentDocumentRef: body.consentDocumentRef, consent: body.consent,
        }));
      } else if (benefitMatch[2] === 'benefit/pause' && request.method === 'POST') {
        requireEmptyBody(await readJson(request));
        sendJson(response, 200, await campaignBenefits.pauseBenefit({ adminAccountId: accountId, campaignId }));
      } else throw new RequestError(404, 'NOT_FOUND');
      return true;
    }
    if (path === '/api/web/admin/courses' || /^\/api\/web\/admin\/courses\/[^/]+\/(check|publish|pause)$/.test(path)) {
      if (!deps.courses) throw new RequestError(503, 'COURSES_NOT_CONFIGURED');
      if (path === '/api/web/admin/courses' && request.method === 'GET') {
        sendJson(response, 200, { courses: await deps.courses.adminList(accountId) }); return true;
      }
      if (request.method !== 'POST') throw new RequestError(405, 'METHOD_NOT_ALLOWED');
      const decision = coinWriteLimiter.consume(accountId);
      if (!decision.allowed) {
        response.setHeader('Retry-After', String(decision.retryAfterSeconds));
        throw new RequestError(429, 'COURSE_WRITE_RATE_LIMITED');
      }
      const body = await readJson(request);
      if (path === '/api/web/admin/courses') {
        sendJson(response, 201, { course: await deps.courses.adminCreate(accountId, body) }); return true;
      }
      const action = path.match(/^\/api\/web\/admin\/courses\/([^/]+)\/(check|publish|pause)$/)!;
      const id = decodePathParameter(action[1]!);
      if (action[2] === 'check') {
        requireOnlyKeys(body, ['suggestedHour']);
        sendJson(response, 200, { course: await deps.courses.adminCheck(accountId, id, parseSuggestedHour(body.suggestedHour)) });
      } else {
        requireEmptyBody(body);
        sendJson(response, 200, { course: action[2] === 'publish'
          ? await deps.courses.adminPublish(accountId, id) : await deps.courses.adminPause(accountId, id) });
      }
      return true;
    }
    if (path === '/api/web/admin/room-reports' && request.method === 'GET') {
      if (!roomCommunity) throw new RequestError(503, 'ROOM_COMMUNITY_NOT_CONFIGURED');
      sendJson(response, 200, { reports: await roomCommunity.listReports(accountId) }); return true;
    }
    const roomModeration = path.match(/^\/api\/web\/admin\/room-stamps\/([^/]+)\/hide$/);
    if (roomModeration && request.method === 'POST') {
      if (!roomCommunity) throw new RequestError(503, 'ROOM_COMMUNITY_NOT_CONFIGURED');
      const decision = roomWriteLimiter.consume(accountId);
      if (!decision.allowed) throw new RequestError(429, 'ROOM_RATE_LIMITED');
      requireEmptyBody(await readJson(request));
      await roomCommunity.moderateStamp({ actorAccountId: accountId, stampId: decodePathParameter(roomModeration[1]!) });
      response.writeHead(204).end(); return true;
    }
    if (request.method === 'POST' && path.startsWith('/api/web/admin/coin-')) {
      if (!coinEconomy) throw new RequestError(503, 'COIN_ECONOMY_NOT_CONFIGURED');
      const decision = coinWriteLimiter.consume(accountId);
      if (!decision.allowed) {
        response.setHeader('Retry-After', String(decision.retryAfterSeconds));
        throw new RequestError(429, 'COIN_WRITE_RATE_LIMITED');
      }
      const body = await readJson(request);
      if (path === '/api/web/admin/coin-pools') {
        requireOnlyKeys(body, ['merchantId', 'eventName', 'grade', 'price', 'purchaseStartsAt', 'purchaseEndsAt',
          'useExpiresAt', 'perAccountLimit', 'issuanceCap', 'entries']);
        sendJson(response, 201, await coinEconomy.publishPool({ ...body, actorAccountId: accountId } as PublishCoinPoolInput));
        return true;
      }
      if (path === '/api/web/admin/coin-series') {
        requireOnlyKeys(body, ['merchantId', 'title', 'endsAt', 'baseCoins', 'prismCoins', 'baseCoupon', 'prismCoupon', 'consentDocumentRef', 'consent']);
        sendJson(response, 201, await coinEconomy.publishSeries({ ...body, actorAccountId: accountId } as PublishCoinSeriesInput));
        return true;
      }
      if (path === '/api/web/admin/coin-tickets/grant') {
        requireOnlyKeys(body, ['accountId', 'poolId', 'requestId']);
        sendJson(response, 201, await coinEconomy.grantTicket({ actorAccountId: accountId,
          accountId: requireString(body, 'accountId'), poolId: requireString(body, 'poolId'), requestId: requireString(body, 'requestId') }));
        return true;
      }
      if (path === '/api/web/admin/coin-reroll-tickets/grant') {
        requireOnlyKeys(body, ['accountId', 'grade', 'requestId']);
        const result = await coinEconomy.grantRerollTicket({ actorAccountId: accountId,
          accountId: requireString(body, 'accountId'), grade: requireString(body, 'grade') as 'NORMAL' | 'SILVER',
          requestId: requireString(body, 'requestId') });
        sendJson(response, result.replayed ? 200 : 201, result); return true;
      }
      const pause = path.match(/^\/api\/web\/admin\/coin-pools\/([^/]+)\/pause$/);
      if (pause) {
        requireEmptyBody(body);
        sendJson(response, 200, await coinEconomy.pausePool({ actorAccountId: accountId, poolId: decodePathParameter(pause[1]!) }));
        return true;
      }
    }
    if (path === '/api/web/admin/me' && request.method === 'GET') {
      sendJson(response, 200, { admin: true });
      return true;
    }
    if (path === '/api/web/admin/funnel' && request.method === 'GET') {
      if (!adminFunnel) throw new RequestError(503, 'ADMIN_FUNNEL_NOT_CONFIGURED');
      const values = new URL(request.url!, 'http://localhost').searchParams.getAll('days');
      const rawDays = values[0];
      const days = rawDays === undefined ? 30 : Number(rawDays);
      if (values.length > 1 || (rawDays !== undefined && !/^\d+$/.test(rawDays)) ||
          !Number.isInteger(days) || days < 7 || days > 90) {
        throw new RequestError(400, 'FUNNEL_DAYS_INVALID');
      }
      sendJson(response, 200, await adminFunnel.funnel(days));
      return true;
    }
    if (path === '/api/web/admin/play/metrics' && request.method === 'GET') {
      if (!play) throw new RequestError(503, 'PLAY_NOT_CONFIGURED');
      const values = new URL(request.url!, 'http://localhost').searchParams.getAll('days');
      const days = values.length ? Number(values[0]) : 30;
      if (values.length > 1 || (values.length === 1 && !/^\d+$/.test(values[0]!)) ||
          !Number.isInteger(days) || days < 7 || days > 90) {
        throw new RequestError(400, 'PLAY_METRICS_DAYS_INVALID');
      }
      sendJson(response, 200, await play.aggregate(days));
      return true;
    }
    if (path === '/api/web/admin/operations-status' && request.method === 'GET') {
      if (!admin.operationsStatus) throw new RequestError(503, 'WEB_ADMIN_NOT_CONFIGURED');
      sendJson(response, 200, await admin.operationsStatus(accountId));
      return true;
    }
    if (path === '/api/web/admin/campaign-drafts') {
      if (request.method === 'GET') {
        if (!admin.listCampaignDrafts) throw new RequestError(503, 'WEB_ADMIN_NOT_CONFIGURED');
        sendJson(response, 200, { drafts: await admin.listCampaignDrafts(accountId) });
        return true;
      }
      if (request.method === 'POST') {
        if (!admin.createCampaignDraft) throw new RequestError(503, 'WEB_ADMIN_NOT_CONFIGURED');
        const body = await readJson(request);
        if (Object.keys(body).some(key => !['merchantId', 'title', 'startsAt', 'endsAt',
          'enrollmentCapacity', 'rewardGoals', 'purpose'].includes(key)) || !Array.isArray(body.rewardGoals)) {
          throw new RequestError(400, 'INVALID_REQUEST');
        }
        const input: AdminCampaignDraftInput = {
          merchantId: requireString(body, 'merchantId'), title: requireString(body, 'title'),
          startsAt: requireString(body, 'startsAt'), endsAt: requireString(body, 'endsAt'),
          enrollmentCapacity: requirePositiveInteger(body, 'enrollmentCapacity'),
          rewardGoals: body.rewardGoals as AdminCampaignDraftInput['rewardGoals'],
          // 목적은 선택이다. 없으면 목적 없는 옛 캠페인과 똑같이 만들고, 있으면 service가 모양·메뉴를 검사한다.
          ...(body.purpose === undefined ? {} : { purpose: body.purpose as NonNullable<AdminCampaignDraftInput['purpose']> }),
        };
        sendJson(response, 201, { draft: await admin.createCampaignDraft(accountId, input) });
        return true;
      }
    }
    // 계정 삭제 요청 처리(#194, D-052): 웹 로그인으로 접수된 요청만 운영자가 처리한다. 화면에는 마스킹한 계정 표지만 나간다.
    if (path === '/api/web/admin/account-deletion-intakes' && request.method === 'GET') {
      if (!deletionProcessing) throw new RequestError(503, 'WEB_ADMIN_NOT_CONFIGURED');
      sendJson(response, 200, { intakes: await deletionProcessing.list({ kind: 'admin', accountId }) });
      return true;
    }
    const deletionActionMatch = path.match(/^\/api\/web\/admin\/account-deletion-intakes\/([^/]+)\/(process|reject)$/);
    if (deletionActionMatch && request.method === 'POST') {
      if (!deletionProcessing) throw new RequestError(503, 'WEB_ADMIN_NOT_CONFIGURED');
      const body = await readJson(request);
      const intakeId = decodePathParameter(deletionActionMatch[1]!);
      const operator = { kind: 'admin' as const, accountId };
      if (deletionActionMatch[2] === 'process') {
        requireEmptyBody(body);
        sendJson(response, 200, { intake: await deletionProcessing.process(operator, intakeId) });
      } else {
        if (Object.keys(body).some(key => key !== 'reason')) throw new RequestError(400, 'INVALID_REQUEST');
        sendJson(response, 200, { intake: await deletionProcessing.reject(operator, intakeId, requireString(body, 'reason')) });
      }
      return true;
    }
    if (path === '/api/web/admin/account-deletions/reconcile' && request.method === 'POST') {
      if (!deletionProcessing) throw new RequestError(503, 'WEB_ADMIN_NOT_CONFIGURED');
      requireEmptyBody(await readJson(request));
      sendJson(response, 200, await deletionProcessing.reconcile({ kind: 'admin', accountId }));
      return true;
    }
    const couponListMatch = path.match(/^\/api\/web\/admin\/merchants\/([^/]+)\/coupons$/);
    if (couponListMatch && request.method === 'GET') {
      if (!admin.listMerchantCoupons) throw new RequestError(503, 'WEB_ADMIN_NOT_CONFIGURED');
      sendJson(response, 200, { coupons: await admin.listMerchantCoupons(accountId, decodePathParameter(couponListMatch[1]!)) });
      return true;
    }
    const couponVoidMatch = path.match(/^\/api\/web\/admin\/coupons\/([^/]+)\/void$/);
    if (couponVoidMatch && request.method === 'POST') {
      if (!admin.voidCoupon) throw new RequestError(503, 'WEB_ADMIN_NOT_CONFIGURED');
      const body = await readJson(request);
      if (Object.keys(body).some(key => key !== 'reason' && key !== 'note')) throw new RequestError(400, 'INVALID_REQUEST');
      sendJson(response, 200, await admin.voidCoupon(accountId, decodePathParameter(couponVoidMatch[1]!),
        { reason: body.reason, note: body.note }));
      return true;
    }
    const staffMatch = path.match(/^\/api\/web\/admin\/merchants\/([^/]+)\/staff$/);
    if (staffMatch && staffRegistration) {
      const merchantId = decodePathParameter(staffMatch[1]!);
      if (request.method === 'GET') {
        sendJson(response, 200, { staff: await staffRegistration.list(accountId, merchantId) });
        return true;
      }
      if (request.method === 'POST') {
        const body = await readJson(request);
        await staffRegistration.approve(accountId, merchantId, requireString(body, 'code'));
        sendJson(response, 200, { status: 'APPROVED' });
        return true;
      }
    }
    const revokeMatch = path.match(/^\/api\/web\/admin\/merchants\/([^/]+)\/staff\/([^/]+)\/revoke$/);
    if (revokeMatch && request.method === 'POST' && staffRegistration) {
      await readJson(request);
      await staffRegistration.revoke(accountId, decodePathParameter(revokeMatch[1]!), decodePathParameter(revokeMatch[2]!));
      sendJson(response, 200, { status: 'REVOKED' });
      return true;
    }
    // 실제 점포 운영 시작(#246, D-054): 공개·점주·보상 혜택·캠페인 공개. 참조 번호만 받고 개인정보는 받지 않는다.
    const publishMatch = path.match(/^\/api\/web\/admin\/merchants\/([^/]+)\/publish$/);
    if (publishMatch && request.method === 'POST') {
      if (!admin.publishMerchant) throw new RequestError(503, 'WEB_ADMIN_NOT_CONFIGURED');
      const body = await readJson(request);
      requireOnlyKeys(body, ['expectedVersion', 'consentDocumentRef']);
      const merchantId = decodePathParameter(publishMatch[1]!);
      const expectedVersion = requireNumber(body, 'expectedVersion');
      const existing = (await admin.listMerchants(accountId)).find(merchant => merchant.id === merchantId);
      if (!existing) throw new AdminError('ADMIN_MERCHANT_NOT_FOUND');
      if (existing.publishedAt === null) {
        if (!realWorld) throw new RequestError(503, 'REAL_WORLD_NOT_CONFIGURED');
        const view = await realWorld.profile(accountId, merchantId);
        if (view.version !== expectedVersion) throw new AdminError('ADMIN_VERSION_CONFLICT');
        if (!['location', 'schedule', 'menu', 'photo'].every(key => view.readiness.some(item => item.key === key && item.ready)) ||
            !view.profile.visitInstructions.trim()) throw new AdminError('ADMIN_MERCHANT_NOT_READY');
      }
      sendJson(response, 200, { merchant: await admin.publishMerchant(accountId, merchantId,
        expectedVersion, body.consentDocumentRef) });
      return true;
    }
    const ownersMatch = path.match(/^\/api\/web\/admin\/merchants\/([^/]+)\/owners$/);
    if (ownersMatch && request.method === 'GET') {
      if (!admin.listOwners) throw new RequestError(503, 'WEB_ADMIN_NOT_CONFIGURED');
      sendJson(response, 200, { owners: await admin.listOwners(accountId, decodePathParameter(ownersMatch[1]!)) });
      return true;
    }
    const ownerChangeMatch = path.match(/^\/api\/web\/admin\/merchants\/([^/]+)\/members\/([^/]+)\/(promote|demote)-owner$/);
    if (ownerChangeMatch && request.method === 'POST') {
      if (!admin.promoteOwner || !admin.demoteOwner) throw new RequestError(503, 'WEB_ADMIN_NOT_CONFIGURED');
      // 점주 권한은 가게 그림 같은 비용 권한까지 여는 변경이라, 삭제 접수(D-053 (8))처럼 10분 안에 한 로그인만 받는다.
      const session = await webAuth.resolveSessionWithAge(requireWebCookie(request, 'web_session'), origin);
      if (session.accountId !== accountId || session.ageMs > freshWebSessionMs) {
        throw new WebSessionError('WEB_SESSION_REAUTH_REQUIRED');
      }
      const body = await readJson(request);
      const merchantId = decodePathParameter(ownerChangeMatch[1]!);
      const target = decodePathParameter(ownerChangeMatch[2]!);
      if (ownerChangeMatch[3] === 'promote') {
        requireOnlyKeys(body, ['verificationDocumentRef']);
        sendJson(response, 200, { member: await admin.promoteOwner(accountId, merchantId, target,
          body.verificationDocumentRef) });
      } else {
        requireOnlyKeys(body, ['reason', 'verificationDocumentRef']);
        sendJson(response, 200, { member: await admin.demoteOwner(accountId, merchantId, target,
          { reason: body.reason, verificationDocumentRef: body.verificationDocumentRef }) });
      }
      return true;
    }
    if (path === '/api/web/admin/reward-offers') {
      if (request.method === 'GET') {
        if (!admin.listRewardOffers) throw new RequestError(503, 'WEB_ADMIN_NOT_CONFIGURED');
        sendJson(response, 200, { offers: await admin.listRewardOffers(accountId) });
        return true;
      }
      if (request.method === 'POST') {
        if (!admin.createRewardOffer) throw new RequestError(503, 'WEB_ADMIN_NOT_CONFIGURED');
        const body = await readJson(request);
        requireOnlyKeys(body, ['merchantId', 'milestone', 'title', 'detail', 'validDays', 'issuanceCap',
          'consentDocumentRef', 'consent']);
        sendJson(response, 201, { offer: await admin.createRewardOffer(accountId, {
          merchantId: body.merchantId, milestone: body.milestone, title: body.title, detail: body.detail,
          validDays: body.validDays, issuanceCap: body.issuanceCap, consentDocumentRef: body.consentDocumentRef,
          consent: body.consent,
        }) });
        return true;
      }
    }
    const offerPauseMatch = path.match(/^\/api\/web\/admin\/reward-offers\/([^/]+)\/pause$/);
    if (offerPauseMatch && request.method === 'POST') {
      if (!admin.pauseRewardOffer) throw new RequestError(503, 'WEB_ADMIN_NOT_CONFIGURED');
      requireEmptyBody(await readJson(request));
      sendJson(response, 200, await admin.pauseRewardOffer(accountId, decodePathParameter(offerPauseMatch[1]!)));
      return true;
    }
    if (path === '/api/web/admin/campaigns' && request.method === 'GET') {
      if (!admin.listCampaigns) throw new RequestError(503, 'WEB_ADMIN_NOT_CONFIGURED');
      const campaigns = await admin.listCampaigns(accountId);
      sendJson(response, 200, { campaigns, generatedAt: new Date().toISOString() });
      return true;
    }
    const campaignExtendMatch = path.match(/^\/api\/web\/admin\/campaigns\/([^/]+)\/extend$/);
    if (campaignExtendMatch && request.method === 'POST') {
      if (!admin.extendCampaign) throw new RequestError(503, 'WEB_ADMIN_NOT_CONFIGURED');
      const body = await readJson(request);
      requireOnlyKeys(body, ['days', 'expectedEndsAt']);
      if ((body.days !== 30 && body.days !== 90) || typeof body.expectedEndsAt !== 'string' ||
          !Number.isFinite(Date.parse(body.expectedEndsAt)) ||
          new Date(body.expectedEndsAt).toISOString() !== body.expectedEndsAt) {
        throw new AdminError('ADMIN_INVALID_INPUT');
      }
      sendJson(response, 200, await admin.extendCampaign(
        accountId, decodePathParameter(campaignExtendMatch[1]!), body.days, body.expectedEndsAt,
      ));
      return true;
    }
    const campaignActionMatch = path.match(/^\/api\/web\/admin\/campaigns\/([^/]+)\/(publish|pause)$/);
    if (campaignActionMatch && request.method === 'POST') {
      if (!admin.publishCampaign || !admin.pauseCampaign) throw new RequestError(503, 'WEB_ADMIN_NOT_CONFIGURED');
      requireEmptyBody(await readJson(request));
      const campaignId = decodePathParameter(campaignActionMatch[1]!);
      sendJson(response, 200, campaignActionMatch[2] === 'publish'
        ? await admin.publishCampaign(accountId, campaignId) : await admin.pauseCampaign(accountId, campaignId));
      return true;
    }
    if (path === '/api/web/admin/merchants') {
      if (request.method === 'GET') {
        sendJson(response, 200, { merchants: await admin.listMerchants(accountId) });
        return true;
      }
      if (request.method === 'POST') {
        const body = await readJson(request);
        sendJson(response, 201, { merchant: await admin.createMerchant(accountId, adminMerchantInput(body)) });
        return true;
      }
    }
    const editMatch = path.match(/^\/api\/web\/admin\/merchants\/([^/]+)$/);
    if (editMatch && request.method === 'PATCH') {
      const body = await readJson(request);
      sendJson(response, 200, { merchant: await admin.updateMerchant(
        accountId, decodePathParameter(editMatch[1]!), requireNumber(body, 'expectedVersion'), adminMerchantInput(body),
      ) });
      return true;
    }
    const hideMatch = path.match(/^\/api\/web\/admin\/merchants\/([^/]+)\/hide$/);
    if (hideMatch && request.method === 'POST') {
      const body = await readJson(request);
      sendJson(response, 200, { merchant: await admin.hideMerchant(
        accountId, decodePathParameter(hideMatch[1]!), requireNumber(body, 'expectedVersion'),
      ) });
      return true;
    }
    throw new RequestError(404, 'NOT_FOUND');
  }
  return false;
}

function adminMerchantInput(body: Record<string, unknown>): MerchantInput {
  if (Object.keys(body).some(key => !['name', 'story', 'roadAddress', 'minimumSpendWon', 'menuItems', 'businessHours',
    'neighborhood', 'category', 'expectedVersion'].includes(key))) {
    throw new RequestError(400, 'INVALID_REQUEST');
  }
  return {
    name: requireString(body, 'name'), story: requireString(body, 'story', true),
    roadAddress: requireString(body, 'roadAddress'), minimumSpendWon: requireNumber(body, 'minimumSpendWon'),
    ...(body.menuItems === undefined ? {} : { menuItems: body.menuItems as NonNullable<MerchantInput['menuItems']> }),
    ...(body.businessHours === undefined ? {} : { businessHours: body.businessHours as string }),
    // 동네·업종 검사는 서비스(merchant-profile-rules)가 한다. 키가 없으면 그대로 둔다(옛 관리자 웹 호환).
    ...(body.neighborhood === undefined ? {} : { neighborhood: body.neighborhood as string | null }),
    ...(body.category === undefined ? {} : { category: body.category as string | null }),
  };
}
