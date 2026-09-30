// 공개 NFT 메타데이터 읽기(Issue #254, D-060). 발행 확정 때 Worker가 고정한 바이트를 그대로 돌려준다.
export type NftMetadataReader = {
  // 시리즈와 토큰이 모두 맞는 스냅샷의 JSON 문자열. 없거나 확정 전이거나 운영자가 내렸으면(asset:) null.
  findTokenMetadata(seriesId: string, tokenId: string): Promise<string | null>;
  // 스냅샷 때 보존한 가게 그림(webp). 없거나 운영자가 내렸으면(image:) null.
  findImage(sha256: string): Promise<Buffer | null>;
};

// Caddy(`infra/lightsail/Caddyfile`)의 경로 정규식과 같은 규칙이다. migration 0036의 nft_series CHECK(`s-` + 32 hex)보다 넓다.
const tokenPath = /^\/nft-metadata\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})\/(0|[1-9][0-9]{0,77})\.json$/;
const imagePath = /^\/nft-metadata\/images\/([0-9a-f]{64})\.webp$/;
// 판이 붙은 기본 도장(바이트 고정, nft-default-stamp.ts).
export const defaultStampPath = '/nft-metadata/default/mascot-stamp-v1.png';

export type NftMetadataRoute =
  | { kind: 'token'; seriesId: string; tokenId: string }
  | { kind: 'image'; sha256: string }
  | { kind: 'default-stamp' };

export function matchNftMetadataRoute(path: string): NftMetadataRoute | undefined {
  if (path === defaultStampPath) return { kind: 'default-stamp' };
  const image = imagePath.exec(path);
  if (image) return { kind: 'image', sha256: image[1]! };
  const token = tokenPath.exec(path);
  // 정적 실증 시리즈는 대소문자와 무관하게 API가 받지 않는다(0036 CHECK와 같다).
  if (token && token[1]!.toLowerCase() !== 'base-sepolia-proof') {
    return { kind: 'token', seriesId: token[1]!, tokenId: token[2]! };
  }
  return undefined;
}
