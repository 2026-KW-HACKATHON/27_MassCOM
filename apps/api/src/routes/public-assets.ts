import { decodePathParameter, readJson, requireEmptyBody, requireNumber } from '../http/request-body.js';
import { RequestError } from '../http/request-error.js';
import { sendBinary, sendJson } from '../http/response.js';
import { DEFAULT_STAMP_V1_PNG } from '../nft-default-stamp.js';
import { matchNftMetadataRoute } from '../nft-metadata.js';
import type { RouteContext } from './context.js';

// 토큰 메타데이터·가게 그림은 하루만 캐시한다: 운영자가 거부 목록으로 내리면 늦어도 하루 안에 사라진다(Issue #254).
// 판이 붙은 기본 도장만 바이트가 영원히 같아 immutable이다.
const nftMetadataCacheControl = 'public, max-age=86400';

type MerchantArtRoute =
  | { kind: 'state' | 'create' | 'reset' }
  | { kind: 'get' | 'choose' | 'apply'; roundId: string };

// 가게 그림 경로표. 알 수 없는 경로·메서드는 undefined라 다른 경로처럼 404로 떨어진다. roundId는 아직 디코딩하지 않은 값이고
// 인증 뒤에 디코딩한 다음 서비스가 UUID를 검사한다.
function matchMerchantArtRoute(method: string | undefined, tail: string): MerchantArtRoute | undefined {
  if (tail === '') {
    return method === 'GET' ? { kind: 'state' } : method === 'DELETE' ? { kind: 'reset' } : undefined;
  }
  if (tail === '/rounds') return method === 'POST' ? { kind: 'create' } : undefined;
  const round = tail.match(/^\/rounds\/([^/]+)(?:\/(choose|apply))?$/);
  if (!round) return undefined;
  const roundId = round[1]!;
  if (round[2] === undefined) return method === 'GET' ? { kind: 'get', roundId } : undefined;
  return method === 'POST' ? { kind: round[2] as 'choose' | 'apply', roundId } : undefined;
}

export async function handlePublicAssets(ctx: RouteContext): Promise<boolean> {
  const { request, response, path, deps, runtime } = ctx;
  const { merchantAccess, merchantArt, nftMetadata } = deps;
  const { resolveAccountId } = runtime;
  // 공개 NFT 메타데이터(Issue #254, D-060): 발행 확정 때 고정한 바이트 그대로 하루 캐시한다(거부 목록이 하루 안에 반영; 기본 도장만 immutable). 지갑·탐색기가 다른 출처에서
  // 읽으므로 404에도 CORS를 연다. 확정 전·없는 토큰은 404라 체인에서 보이는 것 이상을 알려 주지 않는다.
  if (path.startsWith('/nft-metadata/') && (request.method === 'GET' || request.method === 'HEAD')) {
    response.setHeader('access-control-allow-origin', '*');
    const route = matchNftMetadataRoute(path);
    if (!route) throw new RequestError(404, 'NOT_FOUND');
    if (route.kind === 'default-stamp') {
      sendBinary(response, DEFAULT_STAMP_V1_PNG, 'image/png', 'public, max-age=31536000, immutable');
      return true;
    }
    if (!nftMetadata) throw new RequestError(503, 'NFT_METADATA_NOT_CONFIGURED');
    if (route.kind === 'image') {
      const image = await nftMetadata.findImage(route.sha256);
      if (!image) throw new RequestError(404, 'NOT_FOUND');
      sendBinary(response, image, 'image/webp', nftMetadataCacheControl);
      return true;
    }
    const metadata = await nftMetadata.findTokenMetadata(route.seriesId, route.tokenId);
    if (!metadata) throw new RequestError(404, 'NOT_FOUND');
    const body = Buffer.from(metadata, 'utf8');
    response.setHeader('cache-control', nftMetadataCacheControl);
    response.setHeader('content-length', String(body.length));
    response.writeHead(200);
    response.end(body);
    return true;
  }

  // 현재 적용된 가게 그림. 파일 이름이 내용의 sha256이라 바뀌지 않으므로 오래 캐시한다. JSON만 내는 서버에서 이 경로만 이진 응답이다.
  const publicArtMatch = request.method === 'GET' ? path.match(/^\/merchant-art\/([0-9a-f]{64})\.webp$/) : null;
  if (publicArtMatch) {
    if (!merchantArt) throw new RequestError(503, 'AI_ART_NOT_CONFIGURED');
    const image = await merchantArt.getPublicImage(publicArtMatch[1]!);
    if (!image) throw new RequestError(404, 'NOT_FOUND');
    sendBinary(response, image, 'image/webp', 'public, max-age=31536000, immutable');
    return true;
  }

  // 사장님 AI 가게 그림(D-048): 기존 고객 Bearer 인증 + 가게 멤버십의 MANAGE_ART 권한.
  const artMatch = path.match(/^\/merchant\/merchants\/([^/]+)\/art(\/.*)?$/);
  const artRoute = artMatch ? matchMerchantArtRoute(request.method, artMatch[2] ?? '') : undefined;
  if (artMatch && artRoute) {
    if (!merchantAccess) throw new RequestError(503, 'MERCHANT_ACCESS_NOT_CONFIGURED');
    const accountId = await resolveAccountId(request);
    const merchantId = decodePathParameter(artMatch[1]!);
    await merchantAccess.requirePermission({ accountId, merchantId, permission: 'MANAGE_ART' });
    if (!merchantArt) throw new RequestError(503, 'AI_ART_NOT_CONFIGURED');
    const roundId = 'roundId' in artRoute ? decodePathParameter(artRoute.roundId) : '';
    if (artRoute.kind === 'state') {
      sendJson(response, 200, await merchantArt.getState(merchantId, accountId));
    } else if (artRoute.kind === 'create') {
      requireEmptyBody(await readJson(request, true));
      sendJson(response, 202, await merchantArt.createRound({ merchantId, accountId }));
    } else if (artRoute.kind === 'get') {
      sendJson(response, 200, await merchantArt.getRound({ merchantId, roundId }));
    } else if (artRoute.kind === 'choose') {
      const body = await readJson(request);
      if (Object.keys(body).some(key => key !== 'index')) throw new RequestError(400, 'INVALID_REQUEST');
      const index = requireNumber(body, 'index');
      if (index < 0 || index > 3) throw new RequestError(400, 'INVALID_REQUEST');
      sendJson(response, 202, await merchantArt.chooseDraft({ merchantId, roundId, index, accountId }));
    } else if (artRoute.kind === 'apply') {
      requireEmptyBody(await readJson(request, true));
      sendJson(response, 200, await merchantArt.apply({ merchantId, roundId, accountId }));
    } else {
      requireEmptyBody(await readJson(request, true));
      await merchantArt.reset({ merchantId, accountId });
      sendJson(response, 200, { status: 'RESET' });
    }
    return true;
  }
  return false;
}
