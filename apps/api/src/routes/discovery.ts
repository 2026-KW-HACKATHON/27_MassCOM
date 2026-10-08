import { authLoginClientKey } from '../http/request-auth.js';
import { decodePathParameter, readJson } from '../http/request-body.js';
import { RequestError } from '../http/request-error.js';
import { sendJson } from '../http/response.js';
import { isDetailViewSource } from '../merchant-discovery.js';
import type { RouteContext } from './context.js';

export async function handleDiscovery(ctx: RouteContext): Promise<boolean> {
  const { request, response, path, deps, runtime } = ctx;
  const { merchantCatalog, collection, collectiblePreview, merchantDetailViews } = deps;
  const trustProxyClientIp = deps.trustProxyClientIp ?? false;
  const { resolveAccountId, merchantDetailViewLimiter } = runtime;
  const collectiblePreviewMatch = path.match(/^\/merchants\/([^/]+)\/collectible-preview$/);
  if (request.method === 'GET' && collectiblePreviewMatch) {
    if (!collectiblePreview) throw new RequestError(503, 'COLLECTIBLE_PREVIEW_NOT_CONFIGURED');
    const merchantId = decodePathParameter(collectiblePreviewMatch[1]!);
    const preview = await collectiblePreview.preview(merchantId);
    response.setHeader('cache-control', 'public, max-age=300');
    sendJson(response, 200, preview);
    return true;
  }
  const merchantDetailViewMatch = path.match(/^\/merchants\/([^/]+)\/views$/);
  if (request.method === 'POST' && merchantDetailViewMatch) {
    if (!merchantDetailViews) throw new RequestError(503, 'MERCHANT_DETAIL_VIEWS_NOT_CONFIGURED');
    const merchantId = decodePathParameter(merchantDetailViewMatch[1]!);
    const body = await readJson(request);
    if (!isDetailViewSource(body.source)) throw new RequestError(400, 'VIEW_SOURCE_INVALID');
    if (Object.keys(body).some(key => key !== 'source')) throw new RequestError(400, 'INVALID_REQUEST');
    const decision = merchantDetailViewLimiter.consume(authLoginClientKey(request, trustProxyClientIp));
    if (!decision.allowed) {
      response.setHeader('Retry-After', String(decision.retryAfterSeconds));
      sendJson(response, 429, { code: 'VIEW_RATE_LIMITED' });
      return true;
    }
    await merchantDetailViews.record(merchantId, body.source);
    response.writeHead(204).end();
    return true;
  }
  if (request.method === 'GET' && request.url === '/merchants') {
    if (!merchantCatalog) {
      throw new RequestError(503, 'MERCHANT_CATALOG_NOT_CONFIGURED');
    }
    sendJson(response, 200, { merchants: await merchantCatalog.listPublicMerchants() });
    return true;
  }

  if (request.method === 'GET' && request.url === '/collection') {
    if (!collection) {
      throw new RequestError(503, 'COLLECTION_NOT_CONFIGURED');
    }
    const accountId = await resolveAccountId(request);
    sendJson(response, 200, await collection.getCollection(accountId));
    return true;
  }
  return false;
}
