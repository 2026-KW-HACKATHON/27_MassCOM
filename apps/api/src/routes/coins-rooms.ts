import {
  decodePathParameter, readJson, requireEmptyBody, requireOnlyKeys, requireString,
} from '../http/request-body.js';
import { RequestError } from '../http/request-error.js';
import { sendJson } from '../http/response.js';
import { isMileageGrade } from '../mileage-rules.js';
import type { RouteContext } from './context.js';

export async function handleCoinsRooms(ctx: RouteContext): Promise<boolean> {
  const { request, response, path, deps, runtime } = ctx;
  const { friends } = deps;
  const { furniture, gradeDraw, coinEconomy, roomCommunity } = deps.experienceServices;
  const { resolveAccountId, requireCurrentPlayConsent, coinWriteLimiter, roomWriteLimiter } = runtime;
  if (path === '/me/furniture' || path === '/me/furniture/purchases') {
    if (!furniture) throw new RequestError(503, 'FURNITURE_NOT_CONFIGURED');
    const accountId = await resolveAccountId(request);
    await requireCurrentPlayConsent(accountId);
    if (request.method === 'GET' && path === '/me/furniture') {
      sendJson(response, 200, await furniture.get(accountId)); return true;
    }
    if (request.method !== 'POST' || path !== '/me/furniture/purchases') throw new RequestError(405, 'METHOD_NOT_ALLOWED');
    const decision = coinWriteLimiter.consume(accountId);
    if (!decision.allowed) throw new RequestError(429, 'FURNITURE_RATE_LIMITED');
    const body = await readJson(request);
    requireOnlyKeys(body, ['itemId', 'requestId']);
    const result = await furniture.purchase({ accountId, itemId: requireString(body, 'itemId'),
      requestId: requireString(body, 'requestId') });
    sendJson(response, result.replayed ? 200 : 201, result); return true;
  }
  if (path === '/shop/draw-pools' || path === '/shop/draws') {
    if (!gradeDraw) throw new RequestError(503, 'GRADE_DRAW_NOT_CONFIGURED');
    const accountId = await resolveAccountId(request);
    await requireCurrentPlayConsent(accountId);
    if (request.method === 'GET' && path === '/shop/draw-pools') {
      sendJson(response, 200, await gradeDraw.getShop(accountId)); return true;
    }
    if (request.method !== 'POST' || path !== '/shop/draws') throw new RequestError(405, 'METHOD_NOT_ALLOWED');
    const decision = coinWriteLimiter.consume(accountId);
    if (!decision.allowed) {
      response.setHeader('Retry-After', String(decision.retryAfterSeconds));
      throw new RequestError(429, 'DRAW_RATE_LIMITED');
    }
    const body = await readJson(request);
    requireOnlyKeys(body, ['grade', 'requestId', 'expectedPoolVersion']);
    const grade = requireString(body, 'grade');
    if (!isMileageGrade(grade)) throw new RequestError(400, 'INVALID_REQUEST');
    const result = await gradeDraw.draw({ accountId, grade, requestId: requireString(body, 'requestId'),
      expectedPoolVersion: requireString(body, 'expectedPoolVersion') });
    sendJson(response, result.replayed ? 200 : 201, result); return true;
  }
  const ownedCoinDetail = path.match(/^\/me\/coins\/([^/]+)\/grades\/([^/]+)\/detail$/);
  if (path === '/coin-shop' || path === '/coin-shop/purchases' || path === '/me/coins' || ownedCoinDetail ||
      /^\/(coin-tickets\/[^/]+\/use|coin-series\/[^/]+\/claim|coin-reroll-tickets\/[^/]+\/use)$/.test(path)) {
    if (!coinEconomy) throw new RequestError(503, 'COIN_ECONOMY_NOT_CONFIGURED');
    const accountId = await resolveAccountId(request);
    await requireCurrentPlayConsent(accountId);
    if (request.method === 'GET' && path === '/coin-shop') {
      sendJson(response, 200, await coinEconomy.getShop(accountId)); return true;
    }
    if (request.method === 'GET' && path === '/me/coins') {
      sendJson(response, 200, await coinEconomy.getCollection(accountId)); return true;
    }
    if (request.method === 'GET' && ownedCoinDetail) {
      sendJson(response, 200, await coinEconomy.getOwnedCoinDetail(accountId,
        decodePathParameter(ownedCoinDetail[1]!), decodePathParameter(ownedCoinDetail[2]!))); return true;
    }
    if (request.method !== 'POST' || path === '/coin-shop' || path === '/me/coins' || ownedCoinDetail) throw new RequestError(405, 'METHOD_NOT_ALLOWED');
    const decision = coinWriteLimiter.consume(accountId);
    if (!decision.allowed) {
      response.setHeader('Retry-After', String(decision.retryAfterSeconds));
      throw new RequestError(429, 'COIN_WRITE_RATE_LIMITED');
    }
    const body = await readJson(request);
    if (path === '/coin-shop/purchases') {
      requireOnlyKeys(body, ['poolId', 'requestId']);
      const requestId = requireString(body, 'requestId');
      if (requestId.length > 100) throw new RequestError(400, 'INVALID_REQUEST');
      const result = await coinEconomy.purchase({ accountId, poolId: requireString(body, 'poolId'), requestId });
      sendJson(response, result.replayed ? 200 : 201, result); return true;
    }
    const reroll = path.match(/^\/coin-reroll-tickets\/([^/]+)\/use$/);
    if (reroll) {
      requireOnlyKeys(body, ['poolId', 'sourceKind', 'sourceId', 'requestId']);
      const result = await coinEconomy.useRerollTicket({ accountId, ticketId: decodePathParameter(reroll[1]!),
        poolId: requireString(body, 'poolId'), sourceKind: requireString(body, 'sourceKind') as 'VISIT' | 'STORE_DRAW' | 'GRADE_DRAW' | 'REROLL',
        sourceId: requireString(body, 'sourceId'), requestId: requireString(body, 'requestId') });
      sendJson(response, result.replayed ? 200 : 201, result); return true;
    }
    requireEmptyBody(body);
    const use = path.match(/^\/coin-tickets\/([^/]+)\/use$/);
    if (use) {
      const result = await coinEconomy.useTicket({ accountId, ticketId: decodePathParameter(use[1]!) });
      sendJson(response, 200, result); return true;
    }
    const claim = path.match(/^\/coin-series\/([^/]+)\/claim$/)!;
    const result = await coinEconomy.claimSeries({ accountId, seriesId: decodePathParameter(claim[1]!) });
    sendJson(response, result.replayed ? 200 : 201, result); return true;
  }
  if (path === '/me/room-publication' || path === '/me/room-visitors' || path.startsWith('/rooms/') || path.startsWith('/room-stamps/')) {
    if (!roomCommunity) throw new RequestError(503, 'ROOM_COMMUNITY_NOT_CONFIGURED');
    const accountId = await resolveAccountId(request);
    const publicationBody = request.method === 'PUT' && path === '/me/room-publication' ? await readJson(request) : undefined;
    if (publicationBody) {
      requireOnlyKeys(publicationBody, ['visible', 'visibility']);
      if (publicationBody.visible !== undefined && typeof publicationBody.visible !== 'boolean') throw new RequestError(400, 'INVALID_REQUEST');
      if (publicationBody.visibility !== undefined && !['PRIVATE','FRIENDS','NEIGHBORS'].includes(String(publicationBody.visibility)))
        throw new RequestError(400, 'INVALID_REQUEST');
    }
    // 공개 철회는 새 동의를 수락하기 전에도 가능해야 한다.
    if (publicationBody?.visible !== false && publicationBody?.visibility !== 'PRIVATE') await requireCurrentPlayConsent(accountId);
    if (request.method === 'GET' && path === '/me/room-publication') {
      sendJson(response, 200, await roomCommunity.getSettings(accountId)); return true;
    }
    if (request.method === 'GET' && path === '/me/room-visitors') {
      sendJson(response, 200, { visitors: await roomCommunity.visitors(accountId) }); return true;
    }
    if (request.method === 'GET' && path === '/rooms/random') {
      const query = new URL(request.url!, 'http://localhost').searchParams;
      if ([...query.keys()].some(key => key !== 'excludeRoomId') || query.getAll('excludeRoomId').length > 1) throw new RequestError(400, 'INVALID_REQUEST');
      const excludeRoomId = query.get('excludeRoomId');
      sendJson(response, 200, await roomCommunity.randomRoom({ accountId, ...(excludeRoomId !== null ? { excludeRoomId } : {}) })); return true;
    }
    if (request.method === 'GET' && path === '/rooms/neighbors') {
      sendJson(response, 200, { rooms: await roomCommunity.neighbors(accountId) }); return true;
    }
    const neighborFriend = path.match(/^\/rooms\/([^/]+)\/friendship$/);
    if (request.method === 'POST' && neighborFriend) {
      if (!friends?.addNeighbor) throw new RequestError(503, 'FRIENDS_NOT_CONFIGURED');
      const decision = roomWriteLimiter.consume(accountId);
      if (!decision.allowed) throw new RequestError(429, 'ROOM_RATE_LIMITED');
      requireEmptyBody(await readJson(request, true));
      const added = await friends.addNeighbor({ accountId, roomId: decodePathParameter(neighborFriend[1]!) });
      sendJson(response, added.created ? 201 : 200, added); return true;
    }
    const roomMatch = path.match(/^\/rooms\/([^/]+)(?:\/(visits|stamps|block))?$/);
    if (request.method === 'GET' && roomMatch && !roomMatch[2]) {
      sendJson(response, 200, await roomCommunity.getRoom({ accountId, roomId: decodePathParameter(roomMatch[1]!) })); return true;
    }
    const decision = roomWriteLimiter.consume(accountId);
    if (!decision.allowed) {
      response.setHeader('Retry-After', String(decision.retryAfterSeconds));
      throw new RequestError(429, 'ROOM_RATE_LIMITED');
    }
    const body = publicationBody ?? await readJson(request);
    if (request.method === 'PUT' && path === '/me/room-publication') {
      requireOnlyKeys(body, ['visible', 'visibility']);
      sendJson(response, 200, await roomCommunity.setVisibility({ accountId,
        ...(typeof body.visible === 'boolean' ? { visible: body.visible } : {}),
        ...(typeof body.visibility === 'string' ? { visibility: body.visibility as 'PRIVATE' | 'FRIENDS' | 'NEIGHBORS' } : {}) })); return true;
    }
    if (request.method === 'POST' && roomMatch) {
      const roomId = decodePathParameter(roomMatch[1]!);
      if (roomMatch[2] === 'stamps') {
        requireOnlyKeys(body, ['kind', 'message']);
        if (body.kind !== 'COZY' && body.kind !== 'COOL' && body.kind !== 'RETURN') throw new RequestError(400, 'INVALID_REQUEST');
        sendJson(response, 201, await roomCommunity.stamp({ accountId, roomId, kind: body.kind,
          ...(body.message !== undefined ? { message: body.message as string } : {}) })); return true;
      }
      requireEmptyBody(body);
      if (roomMatch[2] === 'visits') { sendJson(response, 200, await roomCommunity.visit({ accountId, roomId })); return true; }
      if (roomMatch[2] === 'block') { await roomCommunity.blockRoom({ accountId, roomId }); response.writeHead(204).end(); return true; }
    }
    const stampMatch = path.match(/^\/room-stamps\/([^/]+)(?:\/(reports))?$/);
    if (stampMatch && ((request.method === 'DELETE' && !stampMatch[2]) || (request.method === 'POST' && stampMatch[2]))) {
      requireEmptyBody(body);
      const input = { accountId, stampId: decodePathParameter(stampMatch[1]!) };
      if (request.method === 'DELETE') await roomCommunity.removeStamp(input);
      else await roomCommunity.reportStamp(input);
      response.writeHead(204).end(); return true;
    }
    throw new RequestError(405, 'METHOD_NOT_ALLOWED');
  }
  return false;
}
