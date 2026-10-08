import assert from 'node:assert/strict';
import { test } from 'node:test';

import { listen, send, walletService, webHeaders } from './http-test-support.js';
import { createApiServer, developmentHeaderAccountResolver } from './server-test-support.js';

// 리팩터링 안전망: 서비스를 하나도 연결하지 않은 서버에서 (메서드, URL)마다 어떤 상태·코드가 나오는지 지금 모습 그대로 고정한다.
// 서비스 계열마다 *_NOT_CONFIGURED 코드가 달라서, 경로가 엉뚱한 처리기로 가거나 순서가 바뀌면 여기서 드러난다.
// request.url 전체로 맞추는 경로(쿼리가 붙으면 404)와 path로 맞추는 경로(쿼리가 붙어도 통과)의 차이, 405와 404의 차이도 그대로 적는다.

const account = { 'x-account-id': 'acct' };
const robots = 'noindex, nofollow';
const sha = 'a'.repeat(64);

type Row = {
  method: string;
  url: string;
  status: number;
  code?: string;
  headers?: Record<string, string>;
  body?: string;
  responseHeaders?: Record<string, string | undefined>;
};

const row = (method: string, url: string, status: number, code?: string, extra: Partial<Row> = {}): Row =>
  ({ method, url, status, ...(code !== undefined ? { code } : {}), ...extra });
const accountRow = (method: string, url: string, status: number, code?: string, extra: Partial<Row> = {}): Row =>
  row(method, url, status, code, { headers: account, ...extra });
const webRow = (method: string, url: string, status: number, code?: string, extra: Partial<Row> = {}): Row =>
  row(method, url, status, code, { headers: webHeaders, ...extra });
const configured = (code: string, rows: readonly (readonly [string, string])[], make = accountRow): Row[] =>
  rows.map(([method, url]) => make(method, url, 503, code));
const notFound = (rows: readonly (readonly [string, string])[], make = accountRow): Row[] =>
  rows.map(([method, url]) => make(method, url, 404, 'NOT_FOUND'));

const inventory: Row[] = [
  // 공통
  row('GET', '/health', 200),
  row('GET', '/health?probe=1', 404, 'NOT_FOUND'),
  row('POST', '/health', 404, 'NOT_FOUND'),
  row('GET', '/', 404, 'NOT_FOUND'),
  row('GET', '/no/such/route', 404, 'NOT_FOUND'),

  // 실제 점포 탐색(real-world-http): 접두사만 맞으면 서비스가 없을 때 503, 처리기는 서비스 확인을 가장 먼저 한다.
  ...configured('REAL_WORLD_NOT_CONFIGURED', [
    ['POST', '/v1/discovery/search'], ['GET', '/v1/discovery/merchants/m1'], ['GET', `/v1/discovery/photos/${sha}`],
    ['POST', '/v1/discovery/places/search'], ['POST', '/v1/discovery/walking-routes'], ['POST', '/v1/discovery/game-content'],
    ['POST', '/v1/discovery/events'], ['POST', '/v1/discovery/merchants/m1/reports'], ['DELETE', '/v1/discovery/anything'],
    ['GET', '/api/web/v1/merchant/merchants/m1/real-world-profile'], ['PUT', '/api/web/v1/admin/merchants/m1/real-world-profile'],
    ['GET', '/api/web/v1/anything'],
  ]),
  accountRow('GET', '/v1/discovery', 404, 'NOT_FOUND'),
  accountRow('GET', '/api/web/v1', 404, 'NOT_FOUND'),

  // 웹 로그인 흐름: 출처(host)를 가장 먼저 보고, 그 다음 서비스 유무
  webRow('GET', '/api/web/auth/start', 503, 'WEB_AUTH_NOT_CONFIGURED'),
  row('GET', '/api/web/auth/start', 403, 'WEB_ORIGIN_FORBIDDEN'),
  row('GET', '/api/web/auth/start', 403, 'WEB_ORIGIN_FORBIDDEN', { headers: { host: 'www.masscom.kr' } }),
  row('GET', '/api/web/auth/start', 403, 'WEB_ORIGIN_FORBIDDEN', { headers: { host: 'evil.example' } }),
  webRow('POST', '/api/web/auth/start', 404, 'NOT_FOUND'),
  webRow('GET', '/api/web/auth/callback', 503, 'WEB_AUTH_NOT_CONFIGURED', { responseHeaders: { 'x-robots-tag': undefined } }),
  row('GET', '/api/web/auth/callback', 403, 'WEB_ORIGIN_FORBIDDEN'),
  webRow('POST', '/api/web/auth/callback', 404, 'NOT_FOUND'),
  webRow('GET', '/api/web/collection', 503, 'WEB_COLLECTION_NOT_CONFIGURED', { responseHeaders: { 'x-robots-tag': undefined } }),
  row('GET', '/api/web/collection', 403, 'WEB_ORIGIN_FORBIDDEN'),
  webRow('POST', '/api/web/collection', 404, 'NOT_FOUND'),
  webRow('GET', '/api/web/badges', 503, 'WEB_BADGES_NOT_CONFIGURED', { responseHeaders: { 'x-robots-tag': undefined } }),
  webRow('GET', '/api/web/collectibles/c1', 503, 'COLLECTIBLE_PROJECTS_NOT_CONFIGURED'),
  accountRow('GET', '/collectibles/c1', 503, 'COLLECTIBLE_PROJECTS_NOT_CONFIGURED'),
  accountRow('POST', '/collectibles/c1', 404, 'NOT_FOUND'),
  accountRow('GET', '/collectibles/a/b', 404, 'NOT_FOUND'),

  // 웹 동의: 405는 출처 검사보다 먼저, POST 출처·본문 형식 검사는 서비스 유무보다 먼저
  row('DELETE', '/api/web/consent', 405, 'METHOD_NOT_ALLOWED'),
  webRow('PUT', '/api/web/consent', 405, 'METHOD_NOT_ALLOWED'),
  webRow('GET', '/api/web/consent', 503, 'WEB_CONSENT_NOT_CONFIGURED', { responseHeaders: { 'x-robots-tag': undefined } }),
  row('GET', '/api/web/consent', 403, 'WEB_ORIGIN_FORBIDDEN'),
  webRow('POST', '/api/web/consent', 503, 'WEB_CONSENT_NOT_CONFIGURED'),
  row('POST', '/api/web/consent', 403, 'ORIGIN_FORBIDDEN', { headers: { ...webHeaders, origin: 'https://evil.example' } }),
  row('POST', '/api/web/consent', 403, 'ORIGIN_FORBIDDEN', { headers: { ...webHeaders, 'content-type': 'text/plain' } }),
  row('POST', '/api/web/consent', 403, 'ORIGIN_FORBIDDEN', { headers: { host: 'masscom.kr', 'content-type': 'application/json' } }),

  // 웹 관리자·점주: 접두사로 묶이고, 서비스가 없으면 x-robots-tag를 붙인 503
  webRow('GET', '/api/web/admin/me', 503, 'WEB_ADMIN_NOT_CONFIGURED', { responseHeaders: { 'x-robots-tag': robots } }),
  webRow('POST', '/api/web/admin/merchants', 503, 'WEB_ADMIN_NOT_CONFIGURED', { responseHeaders: { 'x-robots-tag': robots } }),
  webRow('GET', '/api/web/admin/auth/start', 503, 'WEB_ADMIN_NOT_CONFIGURED'),
  webRow('POST', '/api/web/admin/coin-pools', 503, 'WEB_ADMIN_NOT_CONFIGURED'),
  webRow('GET', '/api/web/admin/room-reports', 503, 'WEB_ADMIN_NOT_CONFIGURED'),
  webRow('GET', '/api/web/admin/anything', 503, 'WEB_ADMIN_NOT_CONFIGURED'),
  row('GET', '/api/web/admin/me', 403, 'WEB_ORIGIN_FORBIDDEN', { responseHeaders: { 'x-robots-tag': undefined } }),
  webRow('GET', '/api/web/admin', 404, 'NOT_FOUND'),
  webRow('GET', '/api/web/merchant/me', 503, 'WEB_MERCHANT_NOT_CONFIGURED', { responseHeaders: { 'x-robots-tag': robots } }),
  webRow('GET', '/api/web/merchant/auth/start', 503, 'WEB_MERCHANT_NOT_CONFIGURED'),
  webRow('GET', '/api/web/merchant/merchants/m1/profile', 503, 'WEB_MERCHANT_NOT_CONFIGURED'),
  webRow('PUT', '/api/web/merchant/merchants/m1/profile', 503, 'WEB_MERCHANT_NOT_CONFIGURED'),
  webRow('GET', '/api/web/merchant/merchants/m1/campaigns', 503, 'WEB_MERCHANT_NOT_CONFIGURED'),
  webRow('POST', '/api/web/merchant/merchants/m1/claim-slots', 503, 'WEB_MERCHANT_NOT_CONFIGURED'),
  row('GET', '/api/web/merchant/me', 403, 'WEB_ORIGIN_FORBIDDEN', { responseHeaders: { 'x-robots-tag': undefined } }),
  webRow('GET', '/api/web/merchant', 404, 'NOT_FOUND'),
  webRow('GET', '/api/web/unknown', 404, 'NOT_FOUND'),

  // 웹 로그아웃·계정 삭제 접수: 메서드 → 출처 → 출처 헤더 → 서비스 순서
  webRow('GET', '/api/web/logout', 405, 'METHOD_NOT_ALLOWED'),
  row('POST', '/api/web/logout', 403, 'WEB_ORIGIN_FORBIDDEN'),
  row('POST', '/api/web/logout', 403, 'ORIGIN_FORBIDDEN', { headers: { host: 'masscom.kr' } }),
  webRow('POST', '/api/web/logout', 503, 'WEB_AUTH_NOT_CONFIGURED', { responseHeaders: { 'x-robots-tag': undefined } }),
  ...['/api/web/account-deletion-intake', '/api/web/account-deletion-intake/cancel', '/api/web/account-deletion-status'].flatMap((url) => [
    webRow('GET', url, 405, 'METHOD_NOT_ALLOWED'),
    webRow('POST', url, 503, 'WEB_DELETION_INTAKE_NOT_CONFIGURED', { responseHeaders: { 'x-robots-tag': undefined } }),
    row('POST', url, 403, 'WEB_ORIGIN_FORBIDDEN'),
    row('POST', url, 403, 'ORIGIN_FORBIDDEN', { headers: { ...webHeaders, origin: 'https://evil.example' } }),
    row('POST', url, 403, 'ORIGIN_FORBIDDEN', { headers: { ...webHeaders, 'content-type': 'text/plain' } }),
  ]),
  // 시연 전용 삭제 접수는 서비스가 없으면 경로 자체가 없다.
  ...notFound([
    ['POST', '/account-deletion-intake'], ['GET', '/account-deletion-intake'], ['POST', '/account-deletion-intake/cancel'],
    ['POST', '/account-deletion-status'],
  ]),

  // 로그인·세션: request.url 전체 일치
  accountRow('POST', '/auth/google', 503, 'ACCOUNT_AUTH_NOT_CONFIGURED'),
  accountRow('POST', '/auth/google?x=1', 404, 'NOT_FOUND'),
  accountRow('GET', '/auth/google', 404, 'NOT_FOUND'),
  accountRow('POST', '/auth/guest-trial', 404, 'NOT_FOUND'),
  accountRow('POST', '/auth/logout', 503, 'ACCOUNT_AUTH_NOT_CONFIGURED'),
  accountRow('POST', '/auth/reauthenticate', 503, 'ACCOUNT_AUTH_NOT_CONFIGURED'),
  accountRow('GET', '/auth/logout', 404, 'NOT_FOUND'),

  // 가게 탐색
  accountRow('GET', '/merchants/m1/collectible-preview', 503, 'COLLECTIBLE_PREVIEW_NOT_CONFIGURED'),
  accountRow('POST', '/merchants/m1/collectible-preview', 404, 'NOT_FOUND'),
  accountRow('POST', '/merchants/m1/views', 503, 'MERCHANT_DETAIL_VIEWS_NOT_CONFIGURED'),
  accountRow('GET', '/merchants/m1/views', 404, 'NOT_FOUND'),
  accountRow('GET', '/merchants', 503, 'MERCHANT_CATALOG_NOT_CONFIGURED'),
  accountRow('GET', '/merchants?limit=1', 404, 'NOT_FOUND'),
  accountRow('POST', '/merchants', 404, 'NOT_FOUND'),
  accountRow('GET', '/collection', 503, 'COLLECTION_NOT_CONFIGURED'),
  accountRow('GET', '/collection?x=1', 404, 'NOT_FOUND'),
  accountRow('GET', '/recommendations', 503, 'RECOMMENDATIONS_NOT_CONFIGURED'),
  accountRow('GET', '/recommendations?x=1', 404, 'NOT_FOUND'),

  // 도감 경험: 접두사 일치라 메서드·꼬리와 무관하게 같은 503
  ...configured('EXPERIENCE_NOT_CONFIGURED', [
    ['GET', '/me/experience'], ['PATCH', '/me/experience/equipment'], ['PATCH', '/me/experience/wishlist'], ['POST', '/me/experience'],
    ['GET', '/me/experienceX'], ['GET', '/me/friends/f1/experience'], ['DELETE', '/me/friends/f1/experience'],
  ]),

  // 알림: 접두사 일치
  ...configured('NOTIFICATIONS_NOT_CONFIGURED', [
    ['GET', '/api/notifications'], ['GET', '/api/notifications/preferences'], ['PATCH', '/api/notifications/preferences'],
    ['POST', '/api/notifications/devices'], ['DELETE', '/api/notifications/devices'], ['POST', '/api/notifications/n1/read'],
    ['GET', '/api/notificationsX'],
  ]),

  // 놀이·꾸미기 스튜디오: request.url 전체 일치(쿼리가 붙으면 404)
  ...configured('PLAY_NOT_CONFIGURED', [
    ['GET', '/me/play'], ['POST', '/me/play/runs'], ['POST', '/me/play/runs/r1/finish'], ['POST', '/me/play/events'],
    ['GET', '/me/studio'], ['PUT', '/me/studio'], ['GET', '/friends/f1/studio'],
  ]),
  ...notFound([
    ['POST', '/me/play'], ['GET', '/me/play?x=1'], ['GET', '/me/play/runs'], ['POST', '/me/play/runs/r1'], ['DELETE', '/me/studio'],
    ['POST', '/friends/f1/studio'], ['GET', '/me/studio?x=1'],
  ]),

  // 가구·등급 뽑기·가게 코인·방 커뮤니티: path 기준이라 메서드와 무관하게 서비스 확인이 먼저
  ...configured('FURNITURE_NOT_CONFIGURED', [
    ['GET', '/me/furniture'], ['POST', '/me/furniture/purchases'], ['DELETE', '/me/furniture'], ['GET', '/me/furniture?x=1'],
  ]),
  ...configured('GRADE_DRAW_NOT_CONFIGURED', [
    ['GET', '/shop/draw-pools'], ['POST', '/shop/draws'], ['PUT', '/shop/draw-pools'], ['GET', '/shop/draws'],
  ]),
  ...configured('COIN_ECONOMY_NOT_CONFIGURED', [
    ['GET', '/coin-shop'], ['POST', '/coin-shop/purchases'], ['GET', '/me/coins'], ['POST', '/coin-tickets/t1/use'],
    ['POST', '/coin-series/s1/claim'], ['POST', '/coin-reroll-tickets/t1/use'], ['GET', '/coin-tickets/t1/use'], ['POST', '/coin-shop'],
  ]),
  ...notFound([['POST', '/coin-tickets/t1'], ['POST', '/coin-series/s1'], ['GET', '/coin-shop/purchases/x']]),
  ...configured('ROOM_COMMUNITY_NOT_CONFIGURED', [
    ['GET', '/me/room-publication'], ['PUT', '/me/room-publication'], ['GET', '/me/room-visitors'], ['GET', '/rooms/random'],
    ['GET', '/rooms/neighbors'], ['GET', '/rooms/r1'], ['POST', '/rooms/r1/visits'], ['POST', '/rooms/r1/stamps'],
    ['POST', '/rooms/r1/block'], ['POST', '/rooms/r1/friendship'], ['DELETE', '/room-stamps/s1'], ['POST', '/room-stamps/s1/reports'],
    ['GET', '/rooms/x/y/z'],
  ]),
  ...notFound([['GET', '/rooms'], ['GET', '/room-stamps'], ['GET', '/me/room-publicationX']]),

  // 계정·친구·동의·소셜
  ...configured('CUSTOMER_IDENTITY_NOT_CONFIGURED', [['POST', '/customer/identity-tokens'], ['POST', '/customer/identity-tokens/revoke']]),
  ...notFound([['GET', '/customer/identity-tokens'], ['POST', '/customer/identity-tokens/other']]),
  ...configured('BADGE_REWARDS_NOT_CONFIGURED', [['GET', '/me/badges'], ['POST', '/me/badges/rewards/1/open']]),
  ...notFound([['GET', '/me/badges/rewards/1/open']]),
  ...configured('CONSENT_NOT_CONFIGURED', [['GET', '/me/consent'], ['POST', '/me/consent']]),
  ...notFound([['PUT', '/me/consent'], ['GET', '/me/consent?x=1']]),
  ...configured('SOCIAL_NOT_CONFIGURED', [
    ['GET', '/me/social'], ['GET', '/me/mail'], ['GET', '/me/mail/m1'], ['POST', '/me/mail/m1/read'], ['POST', '/me/friends/f1/gifts'],
    ['POST', '/me/gifts/g1/receive'], ['POST', '/me/friends/f1/messages'], ['POST', '/me/friends/f1/meal-invitations'],
    ['POST', '/me/meal-invitations/i1/respond'], ['POST', '/me/push-tokens'], ['DELETE', '/me/push-tokens'],
  ]),
  ...configured('FRIENDS_NOT_CONFIGURED', [
    ['GET', '/me/friends'], ['POST', '/me/friends'], ['DELETE', '/me/friends/f1'], ['POST', '/me/friend-code/rotate'], ['PUT', '/me/profile'],
  ]),
  ...notFound([['GET', '/me/friends/f1'], ['PUT', '/me/friends'], ['GET', '/me/profile'], ['GET', '/me/friend-code/rotate']]),
  ...configured('STORE_TICKETS_NOT_CONFIGURED', [['GET', '/me/store-tickets'], ['POST', '/me/store-tickets/t1/open']]),
  ...notFound([['POST', '/me/store-tickets']]),
  ...configured('MILEAGE_SHOP_NOT_CONFIGURED', [
    ['GET', '/shop'], ['GET', '/shop/history'], ['GET', '/shop/history?cursor=c1'], ['POST', '/shop/rerolls'], ['PUT', '/shop/avatar'],
    ['PUT', '/shop/clothing'],
  ]),
  ...notFound([['GET', '/shop?x=1'], ['GET', '/shop/rerolls'], ['POST', '/shop/avatar'], ['GET', '/shop/clothing'], ['POST', '/shop']]),
  ...configured('VISITOR_FEEDBACK_NOT_CONFIGURED', [['GET', '/me/merchant-feedback/m1'], ['PUT', '/me/merchant-feedback/m1']]),
  ...notFound([['POST', '/me/merchant-feedback/m1']]),

  // 점주 앱(모바일) 경로: 권한 서비스가 없으면 계정 확인 전에 503
  ...configured('MERCHANT_ACCESS_NOT_CONFIGURED', [
    ['GET', '/merchant/merchants/m1/context'], ['POST', '/merchant/merchants/m1/claim-slots'],
    ['POST', '/merchant/merchants/m1/customer-identities/resolve'], ['POST', '/merchant/merchants/m1/coupons/lookup'],
    ['POST', '/merchant/merchants/m1/coupons/c1/redeem'], ['GET', '/merchant/merchants/m1/recent-visits'],
    ['GET', '/merchant/merchants/m1/recent-coupon-redemptions'], ['POST', '/merchant/merchants/m1/visits/v1/cancel'],
    ['POST', '/merchant/merchants/m1/coupons/c1/undo-redeem'], ['GET', '/merchant/merchants/m1/overview'],
    ['GET', '/merchant/merchants/m1/visitor-feedback'], ['POST', '/merchant/merchants/m1/claim-slots/s1/reissue'],
    ['GET', '/merchant/merchants/m1/art'], ['DELETE', '/merchant/merchants/m1/art'], ['POST', '/merchant/merchants/m1/art/rounds'],
    ['GET', '/merchant/merchants/m1/art/rounds/r1'], ['POST', '/merchant/merchants/m1/art/rounds/r1/choose'],
    ['POST', '/merchant/merchants/m1/art/rounds/r1/apply'],
  ]),
  ...notFound([
    ['GET', '/merchant/merchants/m1/context?x=1'], ['PATCH', '/merchant/merchants/m1/art'], ['GET', '/merchant/merchants/m1/art/rounds'],
    ['GET', '/merchant/merchants/m1/art/rounds/r1/choose'], ['GET', '/merchant/merchants/m1/unknown'],
    ['POST', '/merchant/merchants/m1/context'],
  ]),
  ...configured('CLAIM_SLOT_SERVICE_NOT_CONFIGURED', [['POST', '/claim-slots/redeem'], ['POST', '/claim-slots/preview']]),
  ...notFound([['GET', '/claim-slots/redeem']]),

  // 지갑: 서비스는 항상 있어 계정 확인과 본문 읽기가 실제로 돈다
  row('POST', '/wallet/challenges', 401, 'ACCOUNT_REQUIRED'),
  accountRow('POST', '/wallet/challenges', 400, 'INVALID_JSON_BODY'),
  row('POST', '/wallet/verify', 401, 'ACCOUNT_REQUIRED'),
  accountRow('POST', '/wallet/verify', 400, 'INVALID_JSON_BODY'),
  row('GET', '/wallets/active-binding', 401, 'ACCOUNT_REQUIRED'),
  accountRow('DELETE', '/wallets/w1/binding', 400, 'INVALID_JSON_BODY'),
  accountRow('GET', '/wallets/w1/binding', 404, 'NOT_FOUND'),
  ...configured('MINT_REQUEST_SERVICE_NOT_CONFIGURED', [['POST', '/entitlements/e1/mint'], ['GET', '/mint-jobs/j1']]),
  ...notFound([['GET', '/entitlements/e1/mint'], ['POST', '/mint-jobs/j1']]),
  ...configured('ACCOUNT_DELETION_NOT_CONFIGURED', [['POST', '/account-deletion-requests']]),
  ...configured('CAMPAIGN_ENROLLMENT_SERVICE_NOT_CONFIGURED', [['POST', '/campaigns/c1/enrollments']]),
  ...notFound([['GET', '/campaigns/c1/enrollments']]),

  // 공개 NFT 메타데이터: 404에도 CORS를 연다
  accountRow('GET', '/nft-metadata/nothing', 404, 'NOT_FOUND', { responseHeaders: { 'access-control-allow-origin': '*' } }),
  accountRow('HEAD', '/nft-metadata/nothing', 404, undefined, { responseHeaders: { 'access-control-allow-origin': '*' } }),
  accountRow('POST', '/nft-metadata/nothing', 404, 'NOT_FOUND', { responseHeaders: { 'access-control-allow-origin': undefined } }),
  accountRow('GET', `/nft-metadata/images/${sha}.webp`, 503, 'NFT_METADATA_NOT_CONFIGURED',
    { responseHeaders: { 'access-control-allow-origin': '*' } }),

  // 공개 가게 그림
  accountRow('GET', `/merchant-art/${sha}.webp`, 503, 'AI_ART_NOT_CONFIGURED'),
  ...notFound([['POST', `/merchant-art/${sha}.webp`], ['GET', '/merchant-art/short.webp']]),

  // 시연 전용: 서비스가 없으면 경로 자체가 없다
  ...notFound([
    ['GET', '/showcase/access-requests/mine'], ['POST', '/showcase/access-requests'], ['GET', '/showcase/admin/access-requests'],
    ['POST', '/showcase/admin/access-requests/r1/approve'], ['POST', '/showcase/admin/access-requests/r1/reject'],
    ['POST', '/showcase/test-visits'], ['GET', '/showcase/other'],
  ]),
];

test('서비스를 연결하지 않은 서버의 (메서드, URL)별 상태·코드와 응답 헤더를 그대로 고정한다', async (t) => {
  const port = await listen(t, createApiServer(walletService(), developmentHeaderAccountResolver));
  const mismatches: unknown[] = [];
  for (const entry of inventory) {
    const result = await send(port, entry.method, entry.url, {
      headers: entry.headers ?? {},
      ...(entry.body !== undefined ? { body: entry.body } : {}),
    });
    const actual: Record<string, unknown> = { status: result.status };
    const expected: Record<string, unknown> = { status: entry.status };
    if (entry.code !== undefined) {
      actual.code = (result.json as { code?: string } | undefined)?.code;
      expected.code = entry.code;
    }
    for (const [name, value] of Object.entries(entry.responseHeaders ?? {})) {
      actual[name] = result.headers[name];
      expected[name] = value;
    }
    try { assert.deepEqual(actual, expected); } catch { mismatches.push({ request: `${entry.method} ${entry.url}`, actual, expected }); }
  }
  assert.deepEqual(mismatches, []);
});

test('인벤토리가 서비스 계열마다 서로 다른 코드를 다룬다(경로가 엉뚱한 처리기로 가면 코드가 달라진다)', () => {
  const codes = new Set(inventory.filter((entry) => entry.status === 503).map((entry) => entry.code));
  assert.ok(codes.size >= 35, `distinct 503 codes: ${codes.size}`);
  assert.ok(inventory.length >= 250, `inventory rows: ${inventory.length}`);
});
